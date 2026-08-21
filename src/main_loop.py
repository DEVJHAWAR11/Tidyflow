"""Main pipeline orchestrator and async batch processor."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .applier import apply_decisions, build_auto_approval_decisions, write_copy_manifest
from .config import TidyConfig, load_config
from .database import DatabaseManager
from .events import broadcast
from .extractor import extract_all_text
from .hashing import (
    assign_exact_duplicate_groups,
    assign_near_duplicate_groups,
    compute_perceptual_hashes,
)
from .llm_provider import classify_files_batched
from .metadata import extract_metadata
from .models import ClassificationResult, FileRecord, RunSummary
from .ocr_engine import run_ocr
from .reporter import generate_reports
from .rules import RuleEngine, identify_heuristic_candidates, score_keywords_all
from .scanner import scan_directory

logger = logging.getLogger(__name__)


def run_pipeline(
    config: TidyConfig,
    *,
    use_llm: bool = True,
    auto_apply: bool = False,
    move_mode: bool = False,
    dry_run: bool = True,
    db: Optional[Any] = None,
) -> tuple[list[FileRecord], RunSummary]:
    """
    Execute the complete universal file organization pipeline.

    Steps:
    1. Universal scan & filter
    2. Visual metadata & thumbnail generation
    3. Exact SHA-256 and pHash deduplication
    4. Multi-format text extraction (PDFs, plain text, code, Office docs)
    5. OCR for images and scanned documents
    6. Keyword scoring and fast-path heuristic candidate detection
    7. Batched LLM classification (30-40 files per request)
    8. Interactive reports and inventory exports
    9. Optional safe copy/move execution
    """
    summary = RunSummary(run_started_at=datetime.now(timezone.utc))

    # 1. Scan
    logger.info("=== STEP 1: Scanning directory: %s ===", config.input_dir)
    records = scan_directory(config)
    summary.total_scanned = sum(1 for r in records if not r.skipped)
    summary.total_skipped = sum(1 for r in records if r.skipped)

    # 2. Visual Metadata
    logger.info("=== STEP 2: Extracting visual metadata & thumbnails ===")
    extract_metadata(records, thumbnail_max_dim=config.thumbnail_max_dim)

    # 3. Hashing & Deduplication
    logger.info("=== STEP 3: Content hashing & duplicate detection ===")
    summary.exact_duplicates = assign_exact_duplicate_groups(records)
    compute_perceptual_hashes(records)
    summary.near_duplicates = assign_near_duplicate_groups(
        records,
        hamming_threshold=config.duplicates.hamming_distance_threshold,
    )

    # 4. Direct Text Extraction
    logger.info("=== STEP 4: Direct text extraction ===")
    summary.text_extracted = extract_all_text(records)

    # 5. OCR
    logger.info("=== STEP 5: OCR processing ===")
    processed_ocr, cached_ocr = run_ocr(records, config.ocr, config.output_dir)
    summary.ocr_processed = processed_ocr
    summary.ocr_cached = cached_ocr

    # 6. Rule Engine & Fast-Path Heuristics
    logger.info("=== STEP 6: Keyword scoring & rules evaluation ===")
    rule_engine = RuleEngine(categories=config.categories)
    for rec in records:
        if not rec.skipped:
            res = rule_engine.evaluate_record(rec)
            if res:
                rec.classification = res
                summary.heuristic_classified += 1

    score_keywords_all(records, config.categories)
    heuristic_candidates = identify_heuristic_candidates(
        records,
        high_threshold=config.classification.heuristic_high_threshold,
        low_second=config.classification.heuristic_low_second,
    )

    if config.classification.heuristic_bypass_enabled:
        for rec in heuristic_candidates:
            if rec.classification is None and rec.keyword_scores:
                top_cat = max(rec.keyword_scores, key=rec.keyword_scores.get)
                conf = rec.keyword_scores[top_cat] / 100.0
                rec.classification = ClassificationResult(
                    category=top_cat,
                    confidence=conf,
                    file_type=rec.file_category,
                    reason=f"Fast-path heuristic: high keyword score ({rec.keyword_scores[top_cat]:.0f})",
                    action="copy_to_organized" if conf >= config.classification.auto_copy_threshold else "manual_review",
                    source="heuristic_high_confidence",
                )
                summary.heuristic_classified += 1

    # 7. Batched LLM Classification
    if use_llm and config.llm.enabled:
        logger.info("=== STEP 7: Batched LLM classification ===")
        llm_count = classify_files_batched(
            records,
            config.llm,
            config.classification,
            config.categories,
            config.output_dir,
        )
        summary.llm_classified = llm_count
    else:
        logger.info("=== STEP 7: LLM classification skipped ===")

    # Aggregate stats
    for rec in records:
        if rec.skipped:
            continue
        if rec.processing_errors:
            summary.errors += 1
        if rec.classification:
            if rec.classification.category == "Unknown":
                summary.classified_unknown += 1
            if rec.classification.action == "manual_review":
                summary.manual_review += 1

    summary.run_finished_at = datetime.now(timezone.utc)

    # 8. Reports Generation
    logger.info("=== STEP 8: Generating output reports ===")
    config.output_dir.mkdir(parents=True, exist_ok=True)
    _save_records_jsonl(records, config.output_dir / "file_records.jsonl")
    generate_reports(records, summary, config.output_dir, list(config.categories.keys()))

    # 9. Optional Auto-Apply
    if auto_apply:
        logger.info("=== STEP 9: Auto-applying approved files ===")
        decisions = build_auto_approval_decisions(records, config.classification.auto_copy_threshold)
        manifest = apply_decisions(
            decisions, records, config.output_dir,
            dry_run=dry_run, move_mode=move_mode
        )
        if not dry_run and manifest:
            write_copy_manifest(manifest, config.output_dir)
            if move_mode:
                summary.moved_files = len(manifest)
            else:
                summary.copied_files = len(manifest)

    if db:
        try:
            for rec in records:
                if not rec.skipped:
                    text_snip = rec.extracted_text_normalized or rec.extracted_text_raw or ""
                    cat = rec.classification.category if rec.classification else "Unknown"
                    conf = rec.classification.confidence if rec.classification else 0.0
                    try:
                        loop = asyncio.get_running_loop()
                        loop.create_task(db.execute_write(
                            "INSERT OR REPLACE INTO files (id, path, status, category, confidence_score, extracted_text) VALUES (?, ?, ?, ?, ?, ?)",
                            (rec.file_id, str(rec.abs_path), "scanned", cat, conf, text_snip[:2000])
                        ))
                    except RuntimeError:
                        pass
        except Exception:
            pass

    logger.info("Pipeline run complete! Outputs available in %s", config.output_dir)
    return records, summary


def _save_records_jsonl(records: list[FileRecord], path: Path) -> None:
    """Serialize FileRecords to JSONL."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for rec in records:
            f.write(rec.model_dump_json() + "\n")


def load_records_jsonl(path: Path) -> list[FileRecord]:
    """Load FileRecords from JSONL."""
    records: list[FileRecord] = []
    if not path.exists():
        return records
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(FileRecord.model_validate_json(line))
    return records


# ---------------------------------------------------------------------------
# Async Concurrent Processor for API Streaming
# ---------------------------------------------------------------------------

class Processor:
    """Async background worker queue processor for desktop/API progress streaming."""

    def __init__(self, max_concurrent: int = 5, db: Optional[DatabaseManager] = None):
        self.queue = asyncio.Queue()
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.db = db or DatabaseManager()
        self._workers = []
        self.processed_count = 0

    async def add_file(self, file_path: str, base_scan_dir: str = ""):
        await self.queue.put((file_path, base_scan_dir))

    async def _worker(self):
        while True:
            item = await self.queue.get()
            if item is None:
                self.queue.task_done()
                break
            file_path, base_scan_dir = item
            try:
                async with self.semaphore:
                    short_name = Path(file_path).name
                    broadcast({"type": "analyzing", "file": short_name, "message": f"Analyzing: {short_name}"})

                    # Basic rule evaluation
                    engine = RuleEngine()
                    cat = engine.evaluate(file_path) or "Unknown"

                    broadcast({"type": "classified", "file": short_name, "category": cat})
                    await self.db.execute_write(
                        "INSERT OR REPLACE INTO files (path, category, status) VALUES (?, ?, 'processed')",
                        (file_path, cat)
                    )
                    self.processed_count += 1
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error processing %s: %s", file_path, e)
                broadcast({"type": "error", "file": Path(file_path).name, "message": str(e)})
            finally:
                self.queue.task_done()

    async def start(self, num_workers: int = 5):
        await self.db.start()
        for _ in range(num_workers):
            task = asyncio.create_task(self._worker())
            self._workers.append(task)

    async def stop(self):
        await self.queue.join()
        for task in self._workers:
            task.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        await self.db.stop()
