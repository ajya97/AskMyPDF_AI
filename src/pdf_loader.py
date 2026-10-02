from langchain_community.document_loaders import PyPDFLoader


def load_pdf(file_path):
    """Return one LangChain Document per PDF page."""
    return PyPDFLoader(file_path).load()
