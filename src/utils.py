"""Shared utilities — hashing, secret detection, secret redaction, text normalization, collisions."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

# ---------------------------------------------------------------------------
# Hashing & File IDs
# ---------------------------------------------------------------------------

def compute_sha256(file_path: Path | str, *, chunk_size: int = 65_536) -> str:
    """Return the hex-encoded SHA-256 digest of *file_path*."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(chunk_size):
            h.update(chunk)
    return h.hexdigest()


def make_file_id(sha256_hex: str, rel_path: str | Path = "") -> str:
    """Generate a stable 12-character file ID from the content hash and the file's location.

    The path is part of the ID because identical files (duplicates, empty files) must still be
    told apart: the UI, the AI batches and the applier all look files up by ID.
    """
    if not sha256_hex:
        return "unknown_file"
    if not rel_path:
        return sha256_hex[:12]
    return hashlib.sha256(f"{sha256_hex}:{Path(rel_path).as_posix()}".encode("utf-8")).hexdigest()[:12]


# ---------------------------------------------------------------------------
# Text Normalization
# ---------------------------------------------------------------------------

_NOISE_RE = re.compile(r"(?<!\w)[^\w\s](?!\w)")
_WHITESPACE_RE = re.compile(r"\s+")


def normalize_ocr_text(raw: str) -> str:
    """Lowercase, strip isolated punctuation noise, and collapse whitespace."""
    if not raw:
        return ""
    text = raw.lower()
    text = _NOISE_RE.sub(" ", text)
    text = _WHITESPACE_RE.sub(" ", text).strip()
    return text


# ---------------------------------------------------------------------------
# Secret & Credential Detection / Redaction
# ---------------------------------------------------------------------------

_SECRET_PATTERNS: list[re.Pattern[str]] = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"AIza[0-9A-Za-z\-_]{35,}",                      # Google API key
        r"sk-[A-Za-z0-9]{20,}",                           # OpenAI / DeepSeek key
        r"ghp_[A-Za-z0-9]{36,}",                          # GitHub PAT
        r"github_pat_[A-Za-z0-9_]{50,}",                  # GitHub Fine-grained PAT
        r"-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----",  # PEM private keys
        r"password\s*[:=]\s*['\"][^\s'\"]+['\"]?",        # password = "..."
        r"token\s*[:=]\s*['\"][^\s'\"]+['\"]?",           # token = "..."
        r"secret\s*[:=]\s*['\"][^\s'\"]+['\"]?",          # secret = "..."
        r"api[_-]?key\s*[:=]\s*['\"][^\s'\"]+['\"]?",     # api_key = "..."
        r"https?://[^\s:]+:[^\s@]+@[^\s]+",               # URL with basic auth
        r"[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",  # user:pass@host
    ]
]

SECRET_FILENAMES: set[str] = {
    ".env", ".env.local", ".env.production", "key.properties", "local.properties",
    "google-services.json", "GoogleService-Info.plist", "id_rsa", "id_ed25519",
}

SECRET_EXTENSIONS: set[str] = {
    ".keystore", ".jks", ".pem", ".p12", ".pfx", ".key", ".crt",
    # Password manager vaults and exports
    ".kdbx", ".kdb", ".1pux", ".1pif", ".psafe3",
}
# Browser and password-manager exports ("passwords.csv", "Chrome Passwords.csv", "logins.json").
_CREDENTIAL_NAME_RE = re.compile(r"(^|[^a-z])(passwords?|passwd|credentials?|logins?)([^a-z]|$)", re.IGNORECASE)
_CREDENTIAL_DATA_EXTS = {".csv", ".tsv", ".txt", ".json", ".xml", ".xlsx", ".xls"}
_CREDENTIAL_HEADER_RE = re.compile(r"(?<![a-z])password(?![a-z])", re.IGNORECASE)
_CREDENTIAL_PARTNER_RE = re.compile(r"(?<![a-z])(user ?name|login|e-?mail|url|uri|website|hostname|origin)(?![a-z])", re.IGNORECASE)

UNSAFE_COPY_EXTENSIONS: set[str] = {
    ".exe", ".bat", ".cmd", ".ps1", ".sh", ".msi", ".dll", ".so", ".dylib",
    ".keystore", ".jks", ".pem", ".p12", ".pfx", ".env",
}


def text_contains_secrets(text: str) -> bool:
    """Return True if text appears to contain API keys, passwords, or credentials."""
    if not text:
        return False
    for pat in _SECRET_PATTERNS:
        if pat.search(text):
            return True
    return False


def redact_secrets(text: str) -> str:
    """Scrub sensitive credentials, passwords, and tokens with [REDACTED]."""
    if not text:
        return ""
    result = text
    for pat in _SECRET_PATTERNS:
        result = pat.sub("[REDACTED]", result)
    return result


# Words that describe nothing about a file's contents, so adding them doesn't make a name clearer.
_FILLER_NAME_WORDS = {
    "image", "img", "photo", "picture", "pic", "screenshot", "screen", "shot", "file", "document", "doc",
    "copy", "new", "final", "untitled", "scan", "scanned", "jpeg", "jpg", "png", "pdf", "the", "and", "for",
}


def _name_words(name: str) -> set[str]:
    stem = Path(name).stem.lower()
    return {w for w in re.split(r"[^a-z]+", stem) if len(w) >= 3}


def rename_adds_meaning(original: str, suggested: str) -> bool:
    """True when a suggested name adds at least one real word, not just new formatting of the old name."""
    return bool(_name_words(suggested) - _name_words(original) - _FILLER_NAME_WORDS)


def is_secret_file(path: Path) -> bool:
    """Return True if the file holds credentials or secrets: by name, extension, or a password-table header."""
    if path.name.lower() in {n.lower() for n in SECRET_FILENAMES}:
        return True
    ext = path.suffix.lower()
    if ext in SECRET_EXTENSIONS:
        return True
    if ext in _CREDENTIAL_DATA_EXTS and _CREDENTIAL_NAME_RE.search(path.stem):
        return True
    if ext in {".csv", ".tsv", ".txt"}:
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                header = f.readline(2048)
        except OSError:
            return False
        return looks_like_credential_table(header)
    return False


def looks_like_credential_table(text: str) -> bool:
    """True when the first line reads like a saved-logins export header (a password column next to a login/url one)."""
    first_line = (text or "").lstrip().split("\n", 1)[0][:2048]
    return bool(_CREDENTIAL_HEADER_RE.search(first_line) and _CREDENTIAL_PARTNER_RE.search(first_line))


def is_safe_to_copy(path: Path) -> bool:
    """Return True if the file is safe to copy (not an executable binary or private key)."""
    return path.suffix.lower() not in UNSAFE_COPY_EXTENSIONS


# ---------------------------------------------------------------------------
# Filename Collision Resolution
# ---------------------------------------------------------------------------

def resolve_filename_collision(dest_dir: Path, filename: str, sha256_hex: str) -> Path:
    """
    Return a collision-free destination path inside *dest_dir*.
    If a file with the same name exists, append ``_<sha256[:8]>`` before extension.
    """
    dest = dest_dir / filename
    if not dest.exists():
        return dest
    stem = dest.stem
    suffix = dest.suffix
    new_name = f"{stem}_{sha256_hex[:8]}{suffix}"
    return dest_dir / new_name


_UNSAFE_LABEL_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def choose_destination(dest_dir: Path, filename: str, sha256_hex: str, source_folder: str = "") -> tuple[Path, bool]:
    """Pick where a file lands inside *dest_dir* when organizing flattens folders.

    Returns (path, already_there). A file with the same name and the same contents is already there.
    A different file with the same name gets a readable label instead of a hash: the folder it came
    from ("photo (Trip).jpg"), or else a number ("photo (2).jpg"), like Finder does.
    """
    stem, suffix = Path(filename).stem, Path(filename).suffix
    candidates = [filename]
    label = _UNSAFE_LABEL_CHARS.sub("", source_folder).strip()[:40].strip()
    if label:
        candidates.append(f"{stem} ({label}){suffix}")
    candidates += [f"{stem} ({n}){suffix}" for n in range(2, 1000)]

    for name in candidates:
        path = dest_dir / name
        if not path.exists():
            return path, False
        try:
            if path.is_file() and compute_sha256(path) == sha256_hex:
                return path, True
        except OSError:
            continue
    # 1000 files sharing one name: fall back to the content hash, which cannot clash with a different file.
    return dest_dir / f"{stem}_{sha256_hex[:8]}{suffix}", False


# ---------------------------------------------------------------------------
# Truncation & Formatting
# ---------------------------------------------------------------------------

def truncate(text: str, max_len: int = 500) -> str:
    """Truncate text to max_len characters, appending ellipsis if needed."""
    if not text or len(text) <= max_len:
        return text or ""
    return text[:max_len - 1] + "…"


def format_file_size(nbytes: int | float) -> str:
    """Format bytes into a human-readable size string (KB, MB, GB)."""
    size = float(nbytes)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024.0:
            return f"{size:.1f} {unit}" if unit != "B" else f"{int(size)} B"
        size /= 1024.0
    return f"{size:.1f} PB"


# ---------------------------------------------------------------------------
# Resource & App Data Path Resolution (PyInstaller & Dev Support)
# ---------------------------------------------------------------------------

def get_resource_path(relative_path: Path | str) -> Path:
    """
    Get absolute path to resource, works for dev and for PyInstaller bundle.
    On macOS .app bundles, data files are located in Contents/Resources.
    """
    import sys
    rel = Path(relative_path)

    # 1. Check PyInstaller sys._MEIPASS and macOS Contents/Resources
    if hasattr(sys, "_MEIPASS"):
        base = Path(sys._MEIPASS)
        # Direct check in _MEIPASS
        if (base / rel).exists():
            return base / rel
        # Check in Contents/Resources (standard macOS bundle layout)
        res_candidate = base.parent / "Resources" / rel
        if res_candidate.exists():
            return res_candidate
        # Fallback to _MEIPASS path even if not yet created
        return base / rel

    # 2. Check relative to sys.executable if frozen
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).parent
        if (exe_dir / rel).exists():
            return exe_dir / rel
        res_candidate = exe_dir.parent / "Resources" / rel
        if res_candidate.exists():
            return res_candidate

    # 3. Development: relative to project root
    project_root = Path(__file__).resolve().parent.parent
    candidate = project_root / rel
    if candidate.exists():
        return candidate

    # 4. Fallback: relative to src package
    src_dir = Path(__file__).resolve().parent
    candidate_src = src_dir / rel
    if candidate_src.exists():
        return candidate_src

    return candidate



def get_app_data_dir() -> Path:
    """
    Get standard OS user data directory for TidyFlow database and user config.
    macOS: ~/Library/Application Support/TidyFlow
    Windows: %APPDATA%/TidyFlow
    Linux: ~/.local/share/tidyflow
    """
    import os
    import sys

    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support" / "TidyFlow"
    elif sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) / "TidyFlow" if appdata else Path.home() / "AppData" / "Roaming" / "TidyFlow"
    else:
        xdg_data = os.environ.get("XDG_DATA_HOME")
        base = Path(xdg_data) / "tidyflow" if xdg_data else Path.home() / ".local" / "share" / "tidyflow"

    base.mkdir(parents=True, exist_ok=True)
    return base

