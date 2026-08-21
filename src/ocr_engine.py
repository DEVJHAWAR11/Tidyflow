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

import os
import shutil
import subprocess
import sys

logger = logging.getLogger(__name__)

# Lazy-initialised OCR engines
_ocr_engine: Any = None
_ocr_available: bool | None = None
_MACOS_OCR_BIN = Path(__file__).resolve().parent.parent / "bin" / "macos_ocr"


def is_macos_ocr_available() -> bool:
    """Check if Apple Vision OCR binary is available or can be compiled."""
    if sys.platform != "darwin":
        return False
    if _MACOS_OCR_BIN.exists() and os.access(_MACOS_OCR_BIN, os.X_OK):
        return True
    swiftc = shutil.which("swiftc")
    if swiftc:
        swift_src = Path(__file__).resolve().parent / "native" / "macos_ocr.swift"
        if swift_src.exists():
            try:
                _MACOS_OCR_BIN.parent.mkdir(parents=True, exist_ok=True)
                subprocess.run(
                    [swiftc, "-O", str(swift_src), "-o", str(_MACOS_OCR_BIN)],
                    check=True,
                    capture_output=True,
                    timeout=30,
                )
                return _MACOS_OCR_BIN.exists()
            except Exception as e:
                logger.warning("Failed to compile native macos_ocr: %s", e)
    return False


def is_rapidocr_available() -> bool:
    """Check if RapidOCR ONNX engine can be imported."""
    try:
        from rapidocr_onnxruntime import RapidOCR  # noqa: F401
        return True
    except ImportError:
        return False


def is_paddleocr_available() -> bool:
    """Check if PaddleOCR can be imported and initialized."""
    global _ocr_available
    if _ocr_available is None:
        try:
            import paddleocr  # noqa: F401
            _ocr_available = True
        except (ImportError, Exception):
            _ocr_available = False
    return _ocr_available


def is_pytesseract_available() -> bool:
    """Check if pytesseract is available and configured."""
    try:
        import pytesseract
        if sys.platform == "win32":
            common_paths = [
                Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
                Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
                Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Tesseract-OCR" / "tesseract.exe",
            ]
            for p in common_paths:
                if p.exists():
                    pytesseract.pytesseract.tesseract_cmd = str(p)
                    break
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def is_ocr_engine_available() -> bool:
    """Return True if macOS native OCR, RapidOCR, PaddleOCR, or PyTesseract is available."""
    return (
        is_macos_ocr_available()
        or is_rapidocr_available()
        or is_paddleocr_available()
        or is_pytesseract_available()
    )


def _run_macos_vision_ocr(file_path: Path) -> tuple[str, float]:
    """Run native Apple Vision OCR on macOS."""
    if not is_macos_ocr_available():
        return "", 0.0
    try:
        proc = subprocess.run(
            [str(_MACOS_OCR_BIN), str(file_path)],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if proc.returncode == 0 and proc.stdout:
            lines = [l.strip() for l in proc.stdout.splitlines() if l.strip()]
            text = "\n".join(lines)
            return text, 0.95 if text else 0.0
    except Exception as exc:
        logger.debug("macOS Vision OCR failed for %s: %s", file_path, exc)
    return "", 0.0


def _get_engine(ocr_config: OcrConfig) -> Any:
    """Lazily initialise OCR engine (RapidOCR ONNX, PaddleOCR, or PyTesseract)."""
    global _ocr_engine
    if _ocr_engine is not None:
        return _ocr_engine

    # 1. Try RapidOCR (high performance, pure ONNX, robust on Windows/Linux/macOS)
    if is_rapidocr_available():
        try:
            from rapidocr_onnxruntime import RapidOCR
            _ocr_engine = RapidOCR()
            logger.info("Initialized RapidOCR (ONNX) engine")
            return _ocr_engine
        except Exception as exc:
            logger.warning("Could not initialize RapidOCR: %s", exc)

    # 2. Fallback to PaddleOCR
    if is_paddleocr_available():
        try:
            from paddleocr import PaddleOCR
            _ocr_engine = PaddleOCR(
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                lang=ocr_config.languages[0] if ocr_config.languages else "en",
            )
            logger.info("Initialized PaddleOCR engine")
            return _ocr_engine
        except Exception as exc:
            logger.warning("Could not initialize PaddleOCR engine: %s", exc)

    # 3. Fallback to PyTesseract
    if is_pytesseract_available():
        try:
            import pytesseract
            _ocr_engine = pytesseract
            logger.info("Initialized PyTesseract engine")
            return _ocr_engine
        except Exception as exc:
            logger.warning("Could not initialize PyTesseract: %s", exc)

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

        # Execute OCR via native macOS Vision or PaddleOCR
        try:
            if is_macos_ocr_available():
                raw_text, conf = _run_macos_vision_ocr(rec.abs_path)
                if raw_text:
                    rec.extracted_text_raw = raw_text
                    rec.extracted_text_normalized = normalize_ocr_text(raw_text)
                    rec.ocr_confidence = conf
                    rec.extraction_source = "ocr"
            elif engine is not None:
                _ocr_single(engine, rec, ocr_config)

            if rec.extracted_text_raw:
                cache.put(rec.sha256, {
                    "raw": rec.extracted_text_raw or "",
                    "normalized": rec.extracted_text_normalized or "",
                    "confidence": rec.ocr_confidence or 0.9,
                })
                processed += 1
        except Exception as exc:
            msg = f"OCR error for {rec.filename}: {exc}"
            logger.warning(msg)
            rec.processing_errors.append(msg)

    cache.save()
    logger.info("OCR finished: %d newly processed, %d from cache", processed, cached)
    return processed, cached


def _load_image_for_record(rec: FileRecord) -> Image.Image | None:
    """Load PIL Image from an image file or render the first page of a PDF for OCR."""
    ext = rec.extension.lower()
    if ext == ".pdf":
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(rec.abs_path)
            if len(doc) == 0:
                doc.close()
                return None
            page = doc[0]
            pix = page.get_pixmap(dpi=150)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            doc.close()
            return img
        except Exception as exc:
            logger.debug("Failed to render PDF page for OCR (%s): %s", rec.filename, exc)
            return None
    else:
        try:
            img = Image.open(rec.abs_path)
            if ext == ".gif":
                img.seek(0)
            return img
        except Exception as exc:
            logger.debug("Failed to open image for OCR (%s): %s", rec.filename, exc)
            return None


def _ocr_single(engine: Any, rec: FileRecord, ocr_config: OcrConfig) -> None:
    """Execute OCR on a single file record (image or scanned PDF)."""
    img = _load_image_for_record(rec)
    if img is None:
        return

    try:
        arr = _preprocess(img, max_dim=ocr_config.max_image_dimension)
    finally:
        img.close()

    lines: list[str] = []
    confidences: list[float] = []

    # Check for PyTesseract
    if getattr(engine, "__name__", "") == "pytesseract" or hasattr(engine, "image_to_data"):
        try:
            data = engine.image_to_data(arr, output_type=engine.Output.DICT)
            for text, conf in zip(data.get("text", []), data.get("conf", [])):
                if text and str(text).strip() and int(conf) > 0:
                    lines.append(str(text).strip())
                    confidences.append(float(conf) / 100.0)
        except Exception as exc:
            logger.debug("PyTesseract OCR failed: %s", exc)
    else:
        ocr_result = None
        try:
            if callable(getattr(engine, "predict", None)):
                ocr_result = engine.predict(arr)
            elif callable(engine):
                res = engine(arr)
                # RapidOCR returns (result, elapse)
                if isinstance(res, tuple) and len(res) >= 1:
                    ocr_result = res[0]
                else:
                    ocr_result = res
            elif hasattr(engine, "ocr"):
                ocr_result = engine.ocr(arr)
        except Exception as exc:
            logger.warning("OCR inference error for %s: %s", rec.filename, exc)
            ocr_result = None

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
                    # RapidOCR format: [bbox, text, score]
                    if len(item) == 3 and isinstance(item[1], str) and isinstance(item[2], (int, float)):
                        if item[1].strip():
                            lines.append(item[1].strip())
                            confidences.append(float(item[2]))
                    else:
                        for page_item in item:
                            if isinstance(page_item, (list, tuple)) and len(page_item) >= 2:
                                text_conf = page_item[1] if isinstance(page_item[1], (list, tuple)) else page_item[-1]
                                if isinstance(text_conf, (list, tuple)) and len(text_conf) >= 2:
                                    text, conf = str(text_conf[0]), float(text_conf[1])
                                    if text.strip():
                                        lines.append(text.strip())
                                        confidences.append(conf)

    raw_text = " ".join(lines)
    rec.extracted_text_raw = raw_text
    rec.extracted_text_normalized = normalize_ocr_text(raw_text)
    rec.ocr_confidence = round(sum(confidences) / len(confidences), 4) if confidences else None
    rec.extraction_source = "ocr"
