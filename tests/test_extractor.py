import pytest
import fitz
from src.extractor import extract_text_from_pdf, extract_text_from_image

def test_missing_file_returns_error():
    res = extract_text_from_pdf("does_not_exist.pdf")
    assert res["needs_review"] is True
    assert res["confidence"] == 0.0
    
def test_missing_image_returns_error():
    res = extract_text_from_image("does_not_exist.png")
    assert res["needs_review"] is True
    assert res["confidence"] == 0.0

def test_extract_text_pdf(tmp_path):
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text(fitz.Point(50, 50), "Hello from PDF extractor testing with enough words to bypass heuristic.")
    pdf_path = tmp_path / "test.pdf"
    doc.save(str(pdf_path))
    doc.close()
    
    res = extract_text_from_pdf(str(pdf_path))
    assert res["needs_review"] is False
    assert "Hello from PDF extractor testing" in res["text"]
    assert res["confidence"] == 100.0
