"""Sharp, on-demand file previews for the review cards.

The scan keeps only small 200px thumbnails (for images and PDFs) so the review list stays light.
A card asks for a large preview of one file when it is about to be shown; it is made once,
cached on disk by the file's contents and size, and served as a plain image.

macOS uses Quick Look, the same previews Finder shows, so slides, documents and videos get one
too. Everywhere else PDFs and images are rendered here and other files keep their icon.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image

from .utils import get_app_data_dir

logger = logging.getLogger(__name__)

PREVIEW_SIZES = (320, 640, 960)
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tif", ".tiff", ".heic"}
# Kinds Quick Look can draw. Asking about anything else (a .torrent, say) makes it wait out its timeout.
_QUICKLOOK_EXTS = _IMAGE_EXTS | {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".key", ".pages", ".numbers",
    ".rtf", ".txt", ".md", ".csv", ".html", ".htm", ".svg", ".heif", ".psd", ".ai", ".eps",
    ".mp4", ".mov", ".m4v", ".avi", ".epub",
}
# Previews run in worker threads; a few at a time keeps swiping smooth and the machine quiet.
_slots = threading.BoundedSemaphore(3)


def preview_cache_dir() -> Path:
    return get_app_data_dir() / "cache" / "previews"


def get_preview(path: Path, sha256: str, size: int, *, use_quicklook: bool | None = None) -> Path | None:
    """Return a cached WebP preview of ``path`` at most ``size`` px on its long side, or None if none can be made."""
    size = min(PREVIEW_SIZES, key=lambda s: abs(s - size))
    cache_dir = preview_cache_dir()
    out = cache_dir / f"{sha256[:32]}_{size}.webp"
    if out.exists():
        return out
    missing = cache_dir / f"{sha256[:32]}_{size}.none"
    if missing.exists():
        return None  # tried before and nothing could preview this file

    if use_quicklook is None:
        use_quicklook = sys.platform == "darwin" and shutil.which("qlmanage") is not None

    with _slots:
        if out.exists():  # made by another request while this one waited
            return out
        img = None
        try:
            if use_quicklook and path.suffix.lower() in _QUICKLOOK_EXTS:
                img = _quicklook(path, size)
            if img is None:
                img = _render_locally(path, size)
            cache_dir.mkdir(parents=True, exist_ok=True)
            if img is None:
                missing.touch()
                return None
            img.thumbnail((size, size), Image.Resampling.LANCZOS)
            tmp = out.with_suffix(".tmp")
            img.save(tmp, "WEBP", quality=82, method=4)
            tmp.replace(out)  # never serve a half-written file
            return out
        except Exception as exc:
            logger.debug("Preview failed for %s: %s", path.name, exc)
            return None
        finally:
            if img is not None:
                img.close()


def _quicklook(path: Path, size: int) -> Image.Image | None:
    """Ask macOS Quick Look for a thumbnail; None when it has no preview for this kind of file."""
    with tempfile.TemporaryDirectory(prefix="tidyflow-ql-") as tmp:
        try:
            subprocess.run(
                ["qlmanage", "-t", "-s", str(size), "-o", tmp, str(path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=6,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return None
        made = next(Path(tmp).glob("*.png"), None)
        if made is None:
            return None
        with Image.open(made) as im:
            return im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")


def _render_locally(path: Path, size: int) -> Image.Image | None:
    """First page of a PDF, or the image itself; None for anything else."""
    ext = path.suffix.lower()
    if ext == ".pdf":
        with fitz.open(path) as doc:
            if len(doc) == 0:
                return None
            page = doc[0]
            zoom = size / max(page.rect.width, page.rect.height, 1)
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    if ext in _IMAGE_EXTS:
        with Image.open(path) as im:
            if getattr(im, "n_frames", 1) > 1:
                im.seek(0)
            im.draft("RGB", (size, size))  # JPEG decodes straight to a smaller size: much faster
            return im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")
    return None
