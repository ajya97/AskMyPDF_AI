"""One shared in-memory Chroma collection that holds the chunks of every PDF."""
from langchain_chroma import Chroma

from src.embeddings import get_embeddings

COLLECTION_NAME = "pdf_bot"


def create_vector_store():
    return Chroma(
        collection_name=COLLECTION_NAME,
        embedding_function=get_embeddings(),
    )
