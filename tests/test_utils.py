from pathlib import Path
from src.utils import (
    compute_sha256,
    format_file_size,
    get_app_data_dir,
    get_resource_path,
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


def test_make_file_id_tells_identical_files_apart():
    sha = "a" * 64
    first = make_file_id(sha, "invoice.txt")
    copy = make_file_id(sha, "invoice (1).txt")
    assert first != copy
    assert len(first) == len(copy) == 12
    assert make_file_id(sha, "invoice.txt") == first  # stable across scans


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


def test_get_resource_path():
    p = get_resource_path("config.yaml")
    assert isinstance(p, Path)
    assert p.name == "config.yaml"


def test_get_app_data_dir():
    app_dir = get_app_data_dir()
    assert isinstance(app_dir, Path)
    assert app_dir.exists()
    assert "TidyFlow" in app_dir.name or "tidyflow" in app_dir.name



def test_password_exports_are_secret_files(tmp_path):
    def write(name, text="x"):
        p = tmp_path / name
        p.write_text(text)
        return p

    # Browser / password-manager exports by name
    assert is_secret_file(write("passwords.csv"))
    assert is_secret_file(write("passwords-firefox.csv"))
    assert is_secret_file(write("Chrome Passwords.csv"))
    assert is_secret_file(write("logins.json"))
    assert is_secret_file(write("vault.kdbx"))
    # A saved-logins table under any name
    assert is_secret_file(write("export (3).csv", '"url","username","password","httpRealm"\n"https://a.b","me","hunter2",""\n'))
    assert is_secret_file(write("bitwarden.csv", "folder,favorite,type,name,notes,login_uri,login_username,login_password\n"))
    # Ordinary files that merely mention passwords stay organizable
    assert not is_secret_file(write("sales.csv", "date,amount,region\n1,2,3\n"))
    assert not is_secret_file(write("notes.txt", "remember to change my password next week\n"))
    assert not is_secret_file(write("passport_scan.pdf"))


def test_rename_suggestions_must_add_meaning():
    from src.utils import rename_adds_meaning

    # Real descriptions of the contents
    assert rename_adds_meaning("17888540262516764872853557150737.jpg", "ai_2027_astra_metr_forecast.jpg")
    assert rename_adds_meaning("3.jpeg", "react_module_02_dev_environment.jpeg")
    assert rename_adds_meaning("Screenshot_2026-08-14-12-35-37-50_2675013a7ce.jpg", "invoice_app_screenshot_2026-08-14.jpg")
    # Only reformatted, or padded with words that say nothing
    assert not rename_adds_meaning("Screenshot_2026-08-14-10-51-11-86_a9d71e.jpg", "screenshot_2026-08-14_10-51-11.jpg")
    assert not rename_adds_meaning("WhatsApp Image 2026-10-06 at 08.38.53.jpeg", "whatsapp_image_2026-10-06_08-38-53.jpeg")
    assert not rename_adds_meaning("ChatGPT Image Aug 17, 2026, 02_22_17 PM.png", "chatgpt_image_2026_08_17_142217.png")
    assert not rename_adds_meaning("881133195532564_signed.pdf", "signed_document_881133195532564.pdf")
