"""Report generator — CSV inventories, JSONL traces, run summary, and self-contained interactive HTML."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
from jinja2 import Environment, FileSystemLoader

from .models import FileRecord, RunSummary
from .utils import format_file_size

logger = logging.getLogger(__name__)


def generate_reports(
    records: list[FileRecord],
    summary: RunSummary,
    output_dir: Path,
    categories: list[str],
) -> None:
    """Generate all reports into output_dir."""
    output_dir.mkdir(parents=True, exist_ok=True)

    _write_file_inventory_csv(records, output_dir)
    _write_ocr_results_jsonl(records, output_dir)
    _write_classification_csv(records, output_dir)
    _write_run_summary(summary, output_dir)
    _write_review_html(records, output_dir, categories)

    logger.info("All reports successfully generated in %s", output_dir)


def _write_file_inventory_csv(records: list[FileRecord], out: Path) -> None:
    """Write comprehensive file inventory CSV."""
    rows: list[dict[str, Any]] = []
    for r in records:
        rows.append({
            "file_id": r.file_id,
            "filename": r.filename,
            "extension": r.extension,
            "file_category": r.file_category,
            "file_size_bytes": r.file_size_bytes,
            "file_size_display": format_file_size(r.file_size_bytes),
            "sha256": r.sha256,
            "duplicate_group_id": r.duplicate_group_id or "",
            "near_duplicate_group_id": r.near_duplicate_group_id or "",
            "extraction_source": r.extraction_source or "",
            "text_excerpt": (r.extracted_text_normalized or "")[:200],
            "ocr_confidence": r.ocr_confidence or "",
            "predicted_category": r.classification.category if r.classification else "Unknown",
            "confidence": r.classification.confidence if r.classification else 0.0,
            "suggested_filename": r.classification.suggested_filename if r.classification else "",
            "reason": r.classification.reason if r.classification else "",
            "action": r.classification.action if r.classification else "manual_review",
            "source": r.classification.source if r.classification else "",
            "abs_path": str(r.abs_path),
            "rel_path": str(r.rel_path),
            "skipped": r.skipped,
            "skip_reason": r.skip_reason or "",
            "errors": "; ".join(r.processing_errors) if r.processing_errors else "",
        })

    df = pd.DataFrame(rows)
    path = out / "file_inventory.csv"
    df.to_csv(path, index=False, encoding="utf-8-sig")
    logger.info("Wrote %s (%d rows)", path.name, len(df))


def _write_ocr_results_jsonl(records: list[FileRecord], out: Path) -> None:
    """Write extracted text and OCR results to JSONL."""
    path = out / "ocr_results.jsonl"
    with open(path, "w", encoding="utf-8") as f:
        for r in records:
            if r.skipped or not r.extracted_text_raw:
                continue
            obj = {
                "file_id": r.file_id,
                "filename": r.filename,
                "extraction_source": r.extraction_source,
                "text_raw": r.extracted_text_raw,
                "text_normalized": r.extracted_text_normalized,
                "ocr_confidence": r.ocr_confidence,
            }
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")
    logger.info("Wrote %s", path.name)


def _write_classification_csv(records: list[FileRecord], out: Path) -> None:
    """Write classification results to CSV."""
    rows: list[dict[str, Any]] = []
    for r in records:
        if r.skipped or r.classification is None:
            continue
        rows.append({
            "file_id": r.file_id,
            "filename": r.filename,
            "predicted_category": r.classification.category,
            "confidence": r.classification.confidence,
            "suggested_filename": r.classification.suggested_filename,
            "reason": r.classification.reason,
            "action": r.classification.action,
            "source": r.classification.source,
            "keyword_scores": json.dumps(r.keyword_scores),
        })
    df = pd.DataFrame(rows)
    path = out / "classification_results.csv"
    df.to_csv(path, index=False, encoding="utf-8-sig")
    logger.info("Wrote %s (%d rows)", path.name, len(df))


def _write_run_summary(summary: RunSummary, out: Path) -> None:
    """Write pipeline execution summary to JSON."""
    path = out / "run_summary.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(summary.model_dump(mode="json"), f, indent=2, default=str)
    logger.info("Wrote %s", path.name)


def _write_review_html(
    records: list[FileRecord],
    out: Path,
    categories: list[str],
) -> None:
    """Render interactive HTML report using Jinja2."""
    template_dir = Path(__file__).parent / "templates"
    template_dir.mkdir(parents=True, exist_ok=True)
    env = Environment(
        loader=FileSystemLoader(str(template_dir)),
        autoescape=True,
    )

    try:
        template = env.get_template("review_report.html")
    except Exception:
        # Fallback if template missing
        return

    items: list[dict[str, Any]] = []
    for r in records:
        if r.skipped:
            continue

        items.append({
            "file_id": r.file_id,
            "filename": r.filename,
            "rel_path": str(r.rel_path),
            "abs_path": str(r.abs_path),
            "extension": r.extension,
            "file_category": r.file_category,
            "file_size_bytes": r.file_size_bytes,
            "file_size_display": format_file_size(r.file_size_bytes),
            "width": r.width,
            "height": r.height,
            "page_count": r.page_count,
            "text_excerpt": (r.extracted_text_normalized or "")[:250],
            "has_text": bool(r.extracted_text_normalized and r.extracted_text_normalized.strip()),
            "thumbnail_b64": r.thumbnail_b64 or "",
            "predicted_category": r.classification.category if r.classification else "Unknown",
            "confidence": r.classification.confidence if r.classification else 0.0,
            "suggested_filename": r.classification.suggested_filename if r.classification else r.filename,
            "reason": r.classification.reason if r.classification else "",
            "action": r.classification.action if r.classification else "manual_review",
            "source": r.classification.source if r.classification else "",
            "duplicate_group_id": r.duplicate_group_id or "",
            "near_duplicate_group_id": r.near_duplicate_group_id or "",
            "keyword_scores": r.keyword_scores,
        })

    html = template.render(
        files=items,
        categories=sorted(categories),
        generated_at=datetime.now().isoformat(timespec="seconds"),
        total_count=len(items),
    )

    path = out / "review_report.html"
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    logger.info("Wrote %s (%d files)", path.name, len(items))
