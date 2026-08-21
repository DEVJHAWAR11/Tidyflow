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


def make_file_id(sha256_hex: str) -> str:
    """Generate a stable 12-character file ID from SHA-256."""
    return sha256_hex[:12] if sha256_hex else "unknown_file"


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
}

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


def is_secret_file(path: Path) -> bool:
    """Return True if the file name or extension represents credentials or secrets."""
    if path.name.lower() in {n.lower() for n in SECRET_FILENAMES}:
        return True
    if path.suffix.lower() in SECRET_EXTENSIONS:
        return True
    return False


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
