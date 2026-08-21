"""Visual metadata extraction and thumbnail generation using Pillow and PyMuPDF."""

from __future__ import annotations

import base64
import io
import logging
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF
from PIL import Image, ExifTags, UnidentifiedImageError
from tqdm import tqdm

from .models import FileRecord

logger = logging.getLogger(__name__)


def extract_metadata(records: list[FileRecord], *, thumbnail_max_dim: int = 200) -> None:
    """
    Populate visual dimensions, page counts, EXIF, and base64 thumbnails on FileRecords.
    """
    processable = [r for r in records if not r.skipped]
    for rec in tqdm(processable, desc="Extracting visual metadata", unit="file"):
        try:
            if rec.file_category == "image":
                _extract_image_metadata(rec, thumbnail_max_dim)
            elif rec.extension == ".pdf":
                _extract_pdf_metadata(rec, thumbnail_max_dim)
        except Exception as exc:
            msg = f"Metadata extraction error for {rec.filename}: {exc}"
            logger.debug(msg)
            rec.processing_errors.append(msg)


def _extract_image_metadata(rec: FileRecord, thumb_max: int) -> None:
    """Extract dimensions, mode, EXIF and thumbnail for image files."""
    try:
        img = Image.open(rec.abs_path)
    except (UnidentifiedImageError, OSError) as exc:
        rec.processing_errors.append(f"Cannot open image: {exc}")
        return

    if rec.extension == ".gif":
        try:
            img.seek(0)
        except EOFError:
            pass

    rec.width = img.width
    rec.height = img.height
    rec.image_mode = img.mode

    if img.height > 0:
        rec.aspect_ratio = round(img.width / img.height, 4)

    rec.exif = _extract_exif(img)
    rec.thumbnail_b64 = _make_thumbnail_b64(img, thumb_max)
    img.close()


def _extract_pdf_metadata(rec: FileRecord, thumb_max: int) -> None:
    """Extract page count, dimensions, and first-page thumbnail for PDFs."""
    try:
        doc = fitz.open(rec.abs_path)
        rec.page_count = len(doc)
        if len(doc) > 0:
            page = doc[0]
            rect = page.rect
            rec.width = int(rect.width)
            rec.height = int(rect.height)
            if rect.height > 0:
                rec.aspect_ratio = round(rect.width / rect.height, 4)

            # Render first page as thumbnail
            pix = page.get_pixmap(dpi=72)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            rec.thumbnail_b64 = _make_thumbnail_b64(img, thumb_max)
            img.close()
        doc.close()
    except Exception as exc:
        logger.debug("PDF metadata extraction note: %s", exc)


def _extract_exif(img: Image.Image) -> dict[str, Any] | None:
    """Extract JSON-safe EXIF tags from PIL Image."""
    try:
        raw_exif = img.getexif()
        if not raw_exif:
            return None
    except Exception:
        return None

    result: dict[str, Any] = {}
    for tag_id, value in raw_exif.items():
        tag_name = ExifTags.TAGS.get(tag_id, str(tag_id))
        if isinstance(value, (str, int, float)):
            result[tag_name] = value
        elif isinstance(value, bytes):
            try:
                result[tag_name] = value.decode("utf-8", errors="replace")
            except Exception:
                pass
    return result if result else None


def _make_thumbnail_b64(img: Image.Image, max_dim: int) -> str | None:
    """Generate JPEG thumbnail and encode to base64 string."""
    try:
        thumb = img.copy()
        if thumb.mode in ("RGBA", "P", "LA", "PA"):
            thumb = thumb.convert("RGB")
        elif thumb.mode != "RGB":
            thumb = thumb.convert("RGB")
        thumb.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        thumb.save(buf, format="JPEG", quality=70)
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception as exc:
        logger.debug("Thumbnail generation error: %s", exc)
        return None
