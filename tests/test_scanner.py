from pathlib import Path
from src.config import TidyConfig
from src.scanner import scan_directory, scan_files, determine_file_category


def test_scan_directory(tmp_path):
    f1 = tmp_path / "invoice.pdf"
    f1.write_text("dummy invoice")

    f2 = tmp_path / "sub" / "code.py"
    f2.parent.mkdir(parents=True, exist_ok=True)
    f2.write_text("print('hello')")

    cfg = TidyConfig(input_dir=tmp_path)
    records = scan_directory(cfg)

    assert len(records) == 2
    filenames = {r.filename for r in records}
    assert "invoice.pdf" in filenames
    assert "code.py" in filenames

    for r in records:
        assert r.sha256 != ""
        assert r.file_id != ""


def test_determine_file_category():
    assert determine_file_category(".pdf") == "document"
    assert determine_file_category(".png") == "image"
    assert determine_file_category(".py") == "code"
    assert determine_file_category(".json") == "data"
    assert determine_file_category(".zip") == "archive"
    assert determine_file_category(".mp3") == "media"
