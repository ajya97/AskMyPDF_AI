"""Retrieval-augmented answering: question -> relevant chunks -> LLM -> answer."""
from langchain_core.output_parsers import StrOutputParser

from src.config import LLM_API_KEY, LLM_MODEL
from src.prompts import NOT_FOUND_MESSAGE, RAG_PROMPT
from src.retriever import get_retriever


class LLMConfigError(Exception):
    """The LLM API key is missing."""


def get_llm():
    if not LLM_API_KEY:
        raise LLMConfigError("LLM_API_KEY is not set. Add it to the .env file and restart the app.")

    from langchain_openrouter import ChatOpenRouter

    return ChatOpenRouter(model=LLM_MODEL, api_key=LLM_API_KEY, temperature=0, max_retries=2)


def format_docs(docs):
    """Join retrieved chunks into one context string, labelled by file and page."""
    parts = []
    for doc in docs:
        meta = doc.metadata or {}
        label = f"[{meta.get('filename', 'document')}, page {meta.get('page', '?')}]"
        parts.append(f"{label}\n{doc.page_content}")
    return "\n\n".join(parts)


def collect_sources(docs):
    """Unique (filename, page) pairs, sorted by file then page."""
    seen, sources = set(), []
    for doc in docs:
        meta = doc.metadata or {}
        key = (meta.get("filename", "document"), meta.get("page", 0))
        if key in seen:
            continue
        seen.add(key)
        sources.append({"filename": key[0], "page": key[1]})
    return sorted(sources, key=lambda s: (s["filename"].lower(), s["page"]))


def retrieve(vector_store, question):
    return get_retriever(vector_store).invoke(question)


def generate_answer(docs, question):
    """Run the LLM on already-retrieved chunks. Returns {answer, sources}."""
    if not docs:
        return {"answer": NOT_FOUND_MESSAGE, "sources": []}

    chain = RAG_PROMPT | get_llm() | StrOutputParser()
    answer = (chain.invoke({"context": format_docs(docs), "question": question}) or "").strip()

    if not answer or NOT_FOUND_MESSAGE.lower() in answer.lower():
        return {"answer": answer or NOT_FOUND_MESSAGE, "sources": []}
    return {"answer": answer, "sources": collect_sources(docs)}
