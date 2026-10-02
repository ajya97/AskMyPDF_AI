from src.pdf_loader import load_pdf
from src.text_splitter import split_documents


class PdfProcessingError(Exception):
    """Raised with a message that is safe to show to the user."""


def pdf_to_chunks(path, doc_id, filename):
    """Read a PDF and return (chunks, ids, page_count).

    Every chunk is tagged with the document id, file name and page number so
    answers can cite their sources and a document can be removed later.
    """
    try:
        pages = load_pdf(path)
    except Exception as exc:  # corrupt, encrypted without password, etc.
        raise PdfProcessingError(
            "This PDF could not be read. It may be corrupted or password-protected."
        ) from exc

    page_total = len(pages)
    pages = [p for p in pages if p.page_content and p.page_content.strip()]
    if not pages:
        raise PdfProcessingError(
            "No selectable text found. Scanned PDFs need OCR before they can be used."
        )

    chunks = [c for c in split_documents(pages) if c.page_content.strip()]
    if not chunks:
        raise PdfProcessingError("No selectable text found in this PDF.")

    ids = []
    for index, chunk in enumerate(chunks):
        page = chunk.metadata.get("page")
        chunk.metadata = {
            "doc_id": doc_id,
            "filename": filename,
            "page": int(page) + 1 if isinstance(page, int) else 0,
        }
        ids.append(f"{doc_id}:{index}")

    return chunks, ids, page_total
