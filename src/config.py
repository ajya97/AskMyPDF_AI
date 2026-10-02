"""Central configuration for Pdf_Bot."""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

APP_NAME = "AskMyPDF AI"

# --- LLM (OpenRouter) -------------------------------------------------------
LLM_API_KEY = (os.getenv("LLM_API_KEY") or "").strip()
LLM_MODEL = os.getenv("LLM_MODEL", "openrouter/free")

# --- Embeddings -------------------------------------------------------------
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-mpnet-base-v2")

# --- Text splitting / retrieval --------------------------------------------
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150
RETRIEVER_K = 4

# --- Uploads ----------------------------------------------------------------
UPLOAD_DIR = str(BASE_DIR / "data" / "uploads")
MAX_UPLOAD_MB = 50
MAX_DOCUMENTS = 20
MAX_QUESTION_LENGTH = 2000
