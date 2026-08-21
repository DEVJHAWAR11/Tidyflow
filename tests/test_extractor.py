from pathlib import Path
import fitz
from src.extractor import extract_all_text
from src.models import FileRecord


def test_extract_pdf_text(tmp_path):
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text(fitz.Point(50, 50), "Hello from PDF extractor testing with sufficient words for direct text.")
    pdf_path = tmp_path / "test.pdf"
    doc.save(str(pdf_path))
    doc.close()

    rec = FileRecord(
        file_id="pdf1",
        abs_path=pdf_path,
        rel_path=Path("test.pdf"),
        filename="test.pdf",
        extension=".pdf",
        file_size_bytes=pdf_path.stat().st_size,
        file_category="document",
    )

    count = extract_all_text([rec])
    assert count == 1
    assert "Hello from PDF extractor" in (rec.extracted_text_raw or "")
    assert rec.extraction_source == "pdf_text"
    assert rec.ocr_confidence == 1.0


def test_extract_plain_text(tmp_path):
    txt_path = tmp_path / "script.py"
    txt_path.write_text("import os\n\ndef organize_files():\n    print('organizing')\n")

    rec = FileRecord(
        file_id="code1",
        abs_path=txt_path,
        rel_path=Path("script.py"),
        filename="script.py",
        extension=".py",
        file_size_bytes=txt_path.stat().st_size,
        file_category="code",
    )

    count = extract_all_text([rec])
    assert count == 1
    assert "def organize_files" in (rec.extracted_text_raw or "")
    assert rec.extraction_source == "direct_text"
