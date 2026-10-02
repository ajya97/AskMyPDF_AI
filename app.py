"""Pdf_Bot - chat with your PDFs.

Run:  python app.py   then open http://127.0.0.1:5000
"""
import hashlib
import logging
import os
import threading
import uuid

from flask import Flask, jsonify, redirect, render_template, request
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

from src.config import (
    APP_NAME,
    LLM_API_KEY,
    MAX_DOCUMENTS,
    MAX_QUESTION_LENGTH,
    MAX_UPLOAD_MB,
    UPLOAD_DIR,
)
from src.pdf_to_vector import PdfProcessingError, pdf_to_chunks
from src.rag_chain import LLMConfigError, generate_answer, retrieve
from src.vector_store import create_vector_store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(APP_NAME)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024 + 1024 * 1024  # file + form overhead
app.config["JSON_AS_ASCII"] = False

os.makedirs(UPLOAD_DIR, exist_ok=True)

# Shared state. Run a single process (the built-in server is fine).
lock = threading.RLock()
vector_store = None  # created lazily so the app starts fast
documents = {}       # doc_id -> {filename, pages, chunks, ids, hash}


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def fail(message, status=400, **extra):
    return jsonify({"success": False, "message": message, **extra}), status


def get_store():
    """Return the shared vector store, creating it on first use (call with lock held)."""
    global vector_store
    if vector_store is None:
        vector_store = create_vector_store()
    return vector_store


def summary():
    """Library snapshot sent to the browser (call with lock held)."""
    docs = [
        {"id": k, "filename": v["filename"], "pages": v["pages"], "chunks": v["chunks"]}
        for k, v in documents.items()
    ]
    return {
        "success": True,
        "documents": docs,
        "total_pages": sum(d["pages"] for d in docs),
        "total_chunks": sum(d["chunks"] for d in docs),
        "llm_ready": bool(LLM_API_KEY),
        "max_documents": MAX_DOCUMENTS,
        "max_upload_mb": MAX_UPLOAD_MB,
    }


def remove_file(path):
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except OSError:
        log.warning("Could not delete temporary file %s", path)


def clean_stale_uploads():
    """Uploaded files are temporary; drop anything left over from a crashed run."""
    for name in os.listdir(UPLOAD_DIR):
        if name != ".gitkeep":
            remove_file(os.path.join(UPLOAD_DIR, name))


def display_name(raw):
    name = os.path.basename((raw or "").replace("\\", "/")).strip()
    return name[:150] or "document.pdf"


clean_stale_uploads()


# ----------------------------------------------------------------------------
# Pages
# ----------------------------------------------------------------------------
@app.get("/")
def home():
    return render_template("index.html", app_name=APP_NAME)


@app.get("/chat")
def chat():
    # Old URL: upload and chat now live on one page.
    return redirect("/", code=302)


@app.get("/health")
def health():
    return jsonify({"status": "ok", "llm_ready": bool(LLM_API_KEY)})


# ----------------------------------------------------------------------------
# API
# ----------------------------------------------------------------------------
@app.post("/upload")
def upload_pdf():
    file = request.files.get("file")
    if file is None:
        return fail("No PDF file was uploaded.")
    if not file.filename:
        return fail("Please choose a PDF file.")

    name = display_name(file.filename)
    if not name.lower().endswith(".pdf"):
        return fail("Only PDF files are supported.")

    with lock:
        if len(documents) >= MAX_DOCUMENTS:
            return fail(f"Library is full ({MAX_DOCUMENTS} PDFs). Remove one to add another.", 409)

    doc_id = uuid.uuid4().hex
    pdf_path = os.path.join(UPLOAD_DIR, f"{doc_id}.pdf")

    try:
        file.save(pdf_path)

        with open(pdf_path, "rb") as fh:
            header = fh.read(5)
            fh.seek(0)
            digest = hashlib.sha256(fh.read()).hexdigest()

        if header != b"%PDF-":
            return fail("This file is not a valid PDF.")

        with lock:
            for existing in documents.values():
                if existing["hash"] == digest:
                    return fail(f"\u201c{existing['filename']}\u201d is already in your library.", 409)

        # Slow part (reading + embedding) happens outside the lock.
        chunks, ids, page_count = pdf_to_chunks(pdf_path, doc_id, name)

        with lock:
            get_store().add_documents(chunks, ids=ids)
            documents[doc_id] = {
                "filename": name,
                "pages": page_count,
                "chunks": len(chunks),
                "ids": ids,
                "hash": digest,
            }
            snapshot = summary()

        snapshot.update(
            message="PDF added to your library.",
            id=doc_id,
            filename=name,
            pages=page_count,
            chunks=len(chunks),
        )
        return jsonify(snapshot)

    except PdfProcessingError as exc:
        return fail(str(exc), 422)
    except Exception:
        log.exception("Upload failed")
        return fail("Something went wrong while processing this PDF. Please try again.", 500)
    finally:
        remove_file(pdf_path)


@app.get("/documents")
def list_documents():
    with lock:
        return jsonify(summary())


@app.delete("/documents/<doc_id>")
def delete_document(doc_id):
    try:
        with lock:
            doc = documents.pop(doc_id, None)
            if doc is None:
                return fail("Document not found.", 404)
            if vector_store is not None and doc["ids"]:
                vector_store.delete(ids=doc["ids"])
            return jsonify(summary())
    except Exception:
        log.exception("Delete failed")
        return fail("Could not remove this document.", 500)


@app.post("/reset")
def reset_all():
    global vector_store
    try:
        with lock:
            if vector_store is not None:
                try:
                    vector_store.delete_collection()
                except Exception:
                    log.exception("Could not drop collection")
            vector_store = None
            documents.clear()
            return jsonify(summary())
    except Exception:
        log.exception("Reset failed")
        return fail("Could not clear the library.", 500)


@app.post("/ask")
def ask_question():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return fail("No request data received.")

    question = data.get("question")
    question = question.strip() if isinstance(question, str) else ""
    if not question:
        return fail("Please enter a question.")
    if len(question) > MAX_QUESTION_LENGTH:
        return fail(f"Questions are limited to {MAX_QUESTION_LENGTH} characters.")

    try:
        with lock:
            if not documents:
                return fail("Add a PDF to your library first.", 400)
            docs = retrieve(get_store(), question)

        result = generate_answer(docs, question)  # network call: keep outside the lock
        return jsonify({"success": True, **result})

    except LLMConfigError as exc:
        return fail(str(exc), 503, code="llm_not_configured")
    except Exception:
        log.exception("Ask failed")
        return fail("The AI service could not answer right now. Please try again.", 502)


# ----------------------------------------------------------------------------
# Errors (always JSON for API calls)
# ----------------------------------------------------------------------------
@app.errorhandler(RequestEntityTooLarge)
def too_large(_):
    return fail(f"This file is larger than the {MAX_UPLOAD_MB} MB limit.", 413)


@app.errorhandler(HTTPException)
def http_error(exc):
    if request.path.startswith(("/upload", "/ask", "/documents", "/reset")):
        return fail(exc.description or "Request failed.", exc.code or 500)
    return exc


if __name__ == "__main__":
    app.run(
        debug=False,
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "5000")),
        threaded=True,
    )
