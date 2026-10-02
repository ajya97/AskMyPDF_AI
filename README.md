# Pdf_Bot

Upload PDFs (notes, textbooks, papers) and ask questions. Answers come only from your PDFs, and every answer shows the page it used.

## Setup

1. Use **Python 3.11 or 3.12** (some AI libraries do not support newer versions yet).
2. Create and activate a virtual environment:
   ```
   python -m venv .venv
   .venv\Scripts\activate        # Windows
   source .venv/bin/activate     # macOS / Linux
   ```
3. Install dependencies: `pip install -r requirements.txt`
4. Copy `.env.example` to `.env` and put your OpenRouter key in `LLM_API_KEY` (free key: https://openrouter.ai/keys).
5. Run: `python app.py` and open http://127.0.0.1:5000

The first PDF takes longer because the embedding model (about 400 MB) is downloaded once.

## Notes

- PDFs must contain selectable text. Scanned image PDFs need OCR first.
- The library lives in memory: restarting the app clears it.
- Optional settings in `.env`: `LLM_MODEL`, `EMBEDDING_MODEL`, `HOST`, `PORT`.

## Structure

```
app.py            Flask server and API
src/              PDF loading, chunking, vector store, RAG chain
templates/        index.html (single page: library + chat)
static/css, js/   style.css, app.js
```
