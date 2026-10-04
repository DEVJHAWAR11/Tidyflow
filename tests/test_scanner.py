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


def test_scan_skips_hidden_files_and_bundle_contents(tmp_path):
    (tmp_path / "report.pdf").write_text("real document")
    (tmp_path / ".localized").write_text("")
    (tmp_path / "._report.pdf").write_text("resource fork")
    app = tmp_path / "Some App.app" / "Contents" / "Frameworks" / "Sparkle.framework"
    app.mkdir(parents=True)
    (app / "Autoupdate").write_text("binary")
    (tmp_path / "Some App.app" / "Contents" / "CodeResources").write_text("plist")

    records = scan_directory(TidyConfig(input_dir=tmp_path))

    assert {r.filename for r in records} == {"report.pdf"}
