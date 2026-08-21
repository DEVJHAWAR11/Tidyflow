"""Universal text and content extractor for PDFs, plain text, code, Office docs, and images."""

from __future__ import annotations

import logging
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF
from tqdm import tqdm

from .models import FileRecord
from .utils import normalize_ocr_text, redact_secrets

logger = logging.getLogger(__name__)

# Text-based file extensions
PLAIN_TEXT_EXTENSIONS: set[str] = {
    ".txt", ".md", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml",
    ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".scss",
    ".rs", ".go", ".cpp", ".c", ".h", ".hpp", ".java", ".kt", ".dart",
    ".sh", ".bash", ".zsh", ".rb", ".php", ".sql", ".ini", ".cfg", ".toml",
    ".log", ".diff", ".patch",
}


def extract_all_text(
    records: list[FileRecord],
    *,
    max_text_bytes: int = 4096,
) -> int:
    """
    Extract text content from all non-skipped records according to their file type.
    Returns the total number of records from which text was successfully extracted.
    """
    processable = [r for r in records if not r.skipped]
    extracted_count = 0

    for rec in tqdm(processable, desc="Extracting text", unit="file"):
        try:
            ext = rec.extension.lower()

            # 1. PDF Documents
            if ext == ".pdf":
                if _extract_pdf_text(rec, max_chars=max_text_bytes):
                    extracted_count += 1

            # 2. Plain Text / Code / Data
            elif ext in PLAIN_TEXT_EXTENSIONS:
                if _extract_plain_text(rec, max_bytes=max_text_bytes):
                    extracted_count += 1

            # 3. Office Documents
            elif ext in {".docx", ".xlsx", ".pptx"}:
                if _extract_office_text(rec, max_bytes=max_text_bytes):
                    extracted_count += 1

        except Exception as exc:
            msg = f"Text extraction failed for {rec.filename}: {exc}"
            logger.debug(msg)
            rec.processing_errors.append(msg)

    logger.info("Direct text extracted from %d files", extracted_count)
    return extracted_count


# ---------------------------------------------------------------------------
# PDF Text Extraction
# ---------------------------------------------------------------------------

def _extract_pdf_text(rec: FileRecord, *, max_chars: int = 4096) -> bool:
    """Extract direct text from PDF; marks for OCR fallback if text is sparse/scanned."""
    try:
        doc = fitz.open(rec.abs_path)
        if len(doc) == 0:
            doc.close()
            return False

        full_text_parts: list[str] = []
        for page_idx in range(min(5, len(doc))):
            page_text = doc[page_idx].get_text("text").strip()
            if page_text:
                full_text_parts.append(page_text)

        doc.close()
        combined = " ".join(full_text_parts).strip()

        # If substantial direct text is found
        if len(combined) >= 20:
            redacted = redact_secrets(combined[:max_chars])
            rec.extracted_text_raw = redacted
            rec.extracted_text_normalized = normalize_ocr_text(redacted)
            rec.ocr_confidence = 1.0
            rec.extraction_source = "pdf_text"
            return True
        else:
            # Sparse text (scanned PDF page) — keep raw text empty to trigger OCR pass
            rec.extracted_text_raw = ""
            rec.extracted_text_normalized = ""
            return False

    except Exception as exc:
        rec.processing_errors.append(f"PyMuPDF error: {exc}")
        return False


# ---------------------------------------------------------------------------
# Plain Text & Code Extraction
# ---------------------------------------------------------------------------

def _extract_plain_text(rec: FileRecord, *, max_bytes: int = 4096) -> bool:
    """Read first 2-4 KB of plain text/code files safely with secret redaction."""
    try:
        with open(rec.abs_path, "rb") as f:
            chunk = f.read(max_bytes)

        text = chunk.decode("utf-8", errors="replace").strip()
        if not text:
            return False

        redacted = redact_secrets(text)
        rec.extracted_text_raw = redacted
        rec.extracted_text_normalized = normalize_ocr_text(redacted)
        rec.ocr_confidence = 1.0
        rec.extraction_source = "direct_text"
        return True

    except Exception as exc:
        rec.processing_errors.append(f"Plain text read error: {exc}")
        return False


# ---------------------------------------------------------------------------
# Office Documents Extraction (DOCX, XLSX, PPTX via XML parser)
# ---------------------------------------------------------------------------

def _extract_office_text(rec: FileRecord, *, max_bytes: int = 4096) -> bool:
    """Extract text from OpenXML Office documents (.docx, .xlsx, .pptx)."""
    try:
        ext = rec.extension.lower()
        extracted_chunks: list[str] = []

        with zipfile.ZipFile(rec.abs_path, "r") as z:
            if ext == ".docx":
                # Word document text in word/document.xml
                if "word/document.xml" in z.namelist():
                    xml_content = z.read("word/document.xml")
                    tree = ET.fromstring(xml_content)
                    # Extract all text nodes (<w:t>)
                    for elem in tree.iter():
                        if elem.tag.endswith("}t") and elem.text:
                            extracted_chunks.append(elem.text)

            elif ext == ".xlsx":
                # Shared strings in xl/sharedStrings.xml
                if "xl/sharedStrings.xml" in z.namelist():
                    xml_content = z.read("xl/sharedStrings.xml")
                    tree = ET.fromstring(xml_content)
                    for elem in tree.iter():
                        if elem.tag.endswith("}t") and elem.text:
                            extracted_chunks.append(elem.text)

            elif ext == ".pptx":
                # Slide text in ppt/slides/slide*.xml
                slide_files = sorted([n for n in z.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml")])
                for slide_name in slide_files[:5]:
                    xml_content = z.read(slide_name)
                    tree = ET.fromstring(xml_content)
                    for elem in tree.iter():
                        if elem.tag.endswith("}t") and elem.text:
                            extracted_chunks.append(elem.text)

        combined = " ".join(extracted_chunks).strip()
        if not combined:
            return False

        redacted = redact_secrets(combined[:max_bytes])
        rec.extracted_text_raw = redacted
        rec.extracted_text_normalized = normalize_ocr_text(redacted)
        rec.ocr_confidence = 0.95
        rec.extraction_source = "office_doc"
        return True

    except Exception as exc:
        logger.debug("Office doc extraction note: %s", exc)
        return False
