from pathlib import Path
from src.utils import (
    compute_sha256,
    format_file_size,
    is_safe_to_copy,
    is_secret_file,
    make_file_id,
    normalize_ocr_text,
    redact_secrets,
    resolve_filename_collision,
    text_contains_secrets,
    truncate,
)


def test_compute_sha256(tmp_path):
    f = tmp_path / "test.txt"
    f.write_text("TidyFlow Unit Test")
    sha = compute_sha256(f)
    assert len(sha) == 64
    assert make_file_id(sha) == sha[:12]


def test_normalize_ocr_text():
    raw = "  INVOICE #1234 -- Total:  $500.00 !  "
    norm = normalize_ocr_text(raw)
    assert "invoice" in norm
    assert "1234" in norm
    assert "500.00" in norm


def test_secret_detection_and_redaction():
    secret_text = "Here is my openai key: sk-1234567890abcdef1234567890 and password = supersecret"
    assert text_contains_secrets(secret_text) is True

    redacted = redact_secrets(secret_text)
    assert "sk-" not in redacted or "[REDACTED]" in redacted
    assert "[REDACTED]" in redacted


def test_secret_and_unsafe_files():
    assert is_secret_file(Path(".env")) is True
    assert is_secret_file(Path("id_rsa")) is True
    assert is_secret_file(Path("report.pdf")) is False

    assert is_safe_to_copy(Path("report.pdf")) is True
    assert is_safe_to_copy(Path("malware.exe")) is False


def test_filename_collision_resolution(tmp_path):
    dest_dir = tmp_path / "dest"
    dest_dir.mkdir()

    # First file doesn't exist yet
    path1 = resolve_filename_collision(dest_dir, "invoice.pdf", "a1b2c3d4e5f6")
    assert path1.name == "invoice.pdf"

    # Create the file
    path1.write_text("existing")

    # Second file with same name
    path2 = resolve_filename_collision(dest_dir, "invoice.pdf", "a1b2c3d4e5f6")
    assert path2.name == "invoice_a1b2c3d4.pdf"


def test_format_file_size():
    assert format_file_size(500) == "500 B"
    assert format_file_size(2048) == "2.0 KB"
    assert format_file_size(5 * 1024 * 1024) == "5.0 MB"
