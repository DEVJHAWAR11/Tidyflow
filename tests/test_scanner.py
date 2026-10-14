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


def test_oversized_files_are_kept_with_unique_ids(tmp_path):
    (tmp_path / "a.dmg").write_bytes(b"a" * 4096)
    (tmp_path / "b.dmg").write_bytes(b"b" * 4096)
    (tmp_path / "passwords.csv").write_text("url,username,password\n")

    records = scan_directory(TidyConfig(input_dir=tmp_path, max_file_size_mb=0.001))
    by_name = {r.filename: r for r in records}

    # Too big to read, but still organized by name, each with its own id.
    assert by_name["a.dmg"].too_large and not by_name["a.dmg"].skipped
    assert by_name["a.dmg"].file_id and by_name["a.dmg"].file_id != by_name["b.dmg"].file_id
    assert by_name["passwords.csv"].skipped
