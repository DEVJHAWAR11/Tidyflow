"""PaddleOCR wrapper with SHA-256-keyed caching and preprocessing."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageEnhance, ImageOps
from tqdm import tqdm

from .config import OcrConfig
from .models import FileRecord
from .utils import normalize_ocr_text

logger = logging.getLogger(__name__)

# Lazy-initialised PaddleOCR engine
_ocr_engine: Any = None
_ocr_available: bool | None = None


def is_paddleocr_available() -> bool:
    """Check if PaddleOCR can be imported and initialized."""
    global _ocr_available
    if _ocr_available is None:
        try:
            import paddleocr  # noqa: F401
            _ocr_available = True
        except ImportError:
            _ocr_available = False
            logger.info("PaddleOCR package not installed; OCR will run in fallback mode")
    return _ocr_available


def _get_engine(ocr_config: OcrConfig) -> Any:
    """Lazily initialise PaddleOCR engine."""
    global _ocr_engine
    if not is_paddleocr_available():
        return None

    if _ocr_engine is None:
        from paddleocr import PaddleOCR
        try:
            _ocr_engine = PaddleOCR(
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=ocr_config.use_textline_orientation,
                text_detection_model_name=ocr_config.text_detection_model_name,
                text_recognition_model_name=ocr_config.text_recognition_model_name,
                lang=ocr_config.languages[0] if ocr_config.languages else "en",
            )
        except Exception:
            try:
                _ocr_engine = PaddleOCR(
                    lang=ocr_config.languages[0] if ocr_config.languages else "en",
                )
            except Exception as exc:
                logger.warning("Could not initialize PaddleOCR engine: %s", exc)
                _ocr_engine = None
    return _ocr_engine


# ---------------------------------------------------------------------------
# Persistent SHA-256 Cache
# ---------------------------------------------------------------------------

class OcrCache:
    """Persistent JSON-file OCR cache keyed by SHA-256."""

    def __init__(self, cache_path: Path) -> None:
        self.path = cache_path
        self._data: dict[str, dict[str, Any]] = {}
        if self.path.exists():
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    self._data = json.load(f)
                logger.info("Loaded OCR cache with %d entries", len(self._data))
            except (json.JSONDecodeError, OSError):
                logger.warning("Corrupt OCR cache file; initializing clean cache")
                self._data = {}

    def get(self, sha256: str) -> dict[str, Any] | None:
        return self._data.get(sha256)

    def put(self, sha256: str, result: dict[str, Any]) -> None:
        self._data[sha256] = result

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, ensure_ascii=False)
        except OSError as exc:
            logger.warning("Failed to save OCR cache: %s", exc)

    def __len__(self) -> int:
        return len(self._data)


# ---------------------------------------------------------------------------
# Preprocessing
# ---------------------------------------------------------------------------

def _preprocess(img: Image.Image, max_dim: int = 768) -> np.ndarray:
    """EXIF orientation correction, resize if oversized, contrast boost."""
    img = ImageOps.exif_transpose(img) or img
    if img.mode != "RGB":
        img = img.convert("RGB")

    if max(img.width, img.height) > max_dim:
        img = img.copy()
        img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

    enhancer = ImageEnhance.Contrast(img)
    img = enhancer.enhance(1.2)
    return np.array(img)


# ---------------------------------------------------------------------------
# Public OCR API
# ---------------------------------------------------------------------------

def run_ocr(
    records: list[FileRecord],
    ocr_config: OcrConfig,
    cache_dir: Path,
) -> tuple[int, int]:
    """
    Run OCR on image files and scanned documents that lack extracted text.
    Returns (processed_count, cached_count).
    """
    if not ocr_config.enabled:
        logger.info("OCR is disabled in configuration — skipping")
        return 0, 0

    cache = OcrCache(cache_dir / "ocr_cache.json")
    min_dim = ocr_config.skip_images_smaller_than

    # Candidates: images or documents needing OCR that are not skipped and have no text
    candidates = [
        r for r in records
        if not r.skipped
        and (r.file_category == "image" or (r.file_category == "document" and not r.extracted_text_raw))
    ]

    if not candidates:
        return 0, 0

    engine = _get_engine(ocr_config)
    processed = 0
    cached = 0

    for rec in tqdm(candidates, desc="Running OCR", unit="file"):
        # Skip small icons
        if rec.width and rec.height:
            if rec.width < min_dim or rec.height < min_dim:
                continue

        # Check cache
        hit = cache.get(rec.sha256)
        if hit is not None:
            rec.extracted_text_raw = hit.get("raw", "")
            rec.extracted_text_normalized = hit.get("normalized", "")
            rec.ocr_confidence = hit.get("confidence")
            rec.extraction_source = "ocr"
            cached += 1
            continue

        if engine is None:
            # Engine not available (no paddleocr installed); keep record as is
            continue

        try:
            _ocr_single(engine, rec, ocr_config)
            cache.put(rec.sha256, {
                "raw": rec.extracted_text_raw or "",
                "normalized": rec.extracted_text_normalized or "",
                "confidence": rec.ocr_confidence,
            })
            processed += 1
        except Exception as exc:
            msg = f"OCR error for {rec.filename}: {exc}"
            logger.warning(msg)
            rec.processing_errors.append(msg)

    cache.save()
    logger.info("OCR finished: %d newly processed, %d from cache", processed, cached)
    return processed, cached


def _ocr_single(engine: Any, rec: FileRecord, ocr_config: OcrConfig) -> None:
    """Execute OCR on a single file record."""
    img = Image.open(rec.abs_path)
    if rec.extension == ".gif":
        img.seek(0)

    arr = _preprocess(img, max_dim=ocr_config.max_image_dimension)
    img.close()

    if callable(getattr(engine, "predict", None)):
        ocr_result = engine.predict(arr)
    else:
        ocr_result = engine.ocr(arr)

    lines: list[str] = []
    confidences: list[float] = []

    if ocr_result:
        for item in ocr_result:
            if not item:
                continue

            if isinstance(item, dict):
                texts = item.get("rec_texts", []) or []
                scores = item.get("rec_scores", []) or []
                for t, s in zip(texts, scores):
                    if t and str(t).strip():
                        lines.append(str(t).strip())
                        try:
                            confidences.append(float(s))
                        except (ValueError, TypeError):
                            pass

            elif isinstance(item, (list, tuple)):
                for page_item in item:
                    if isinstance(page_item, (list, tuple)) and len(page_item) >= 2:
                        text_conf = page_item[1] if isinstance(page_item[1], (list, tuple)) else page_item[-1]
                        if isinstance(text_conf, (list, tuple)) and len(text_conf) >= 2:
                            text, conf = str(text_conf[0]), float(text_conf[1])
                            lines.append(text)
                            confidences.append(conf)

    raw_text = " ".join(lines)
    rec.extracted_text_raw = raw_text
    rec.extracted_text_normalized = normalize_ocr_text(raw_text)
    rec.ocr_confidence = round(sum(confidences) / len(confidences), 4) if confidences else None
    rec.extraction_source = "ocr"
