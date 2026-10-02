from src.config import RETRIEVER_K


def get_retriever(vector_store):
    return vector_store.as_retriever(
        search_type="mmr",
        search_kwargs={
            "k": RETRIEVER_K,
            "fetch_k": 12,
            "lambda_mult": 0.5,
        },
    )
