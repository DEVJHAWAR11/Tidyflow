"""Safe file organizer & applier — applies review decisions with copy/move safety and SHA-256 verification."""

from __future__ import annotations

import csv
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from tqdm import tqdm

from .models import CopyManifestEntry, FileRecord, ReviewDecision
from .utils import compute_sha256, is_safe_to_copy, resolve_filename_collision

logger = logging.getLogger(__name__)


def build_auto_approval_decisions(
    records: list[FileRecord],
    confidence_threshold: float = 0.85,
) -> list[ReviewDecision]:
    """Select high-confidence classifications marked for organization."""
    return [
        ReviewDecision(
            file_id=rec.file_id,
            approved=True,
            original_category=rec.classification.category,
            original_confidence=rec.classification.confidence,
        )
        for rec in records
        if not rec.skipped
        and rec.classification is not None
        and rec.classification.category != "Unknown"
        and rec.classification.action == "copy_to_organized"
        and rec.classification.confidence >= confidence_threshold
    ]


def load_decisions(decisions_path: Path | str) -> list[ReviewDecision]:
    """Load and parse review_decisions.csv."""
    path = Path(decisions_path)
    if not path.exists():
        raise FileNotFoundError(f"Decisions file not found: {path}")

    decisions: list[ReviewDecision] = []
    with open(path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader, start=2):
            try:
                decisions.append(ReviewDecision(
                    file_id=row["file_id"].strip(),
                    approved=row.get("approved", "").strip().lower() in ("true", "1", "yes"),
                    override_category=row.get("override_category", "").strip() or None,
                    override_filename=row.get("override_filename", "").strip() or None,
                    original_category=row.get("original_category", "Unknown").strip(),
                    original_confidence=float(row.get("original_confidence", 0)),
                ))
            except Exception as exc:
                logger.warning("Skipping invalid decision row %d: %s", i, exc)

    logger.info("Loaded %d decisions from %s", len(decisions), path)
    return decisions


def apply_decisions(
    decisions: list[ReviewDecision],
    records: list[FileRecord],
    output_dir: Path,
    *,
    dry_run: bool = True,
    move_mode: bool = False,
    db: Any = None,
) -> list[CopyManifestEntry]:
    """
    Copy (or move if explicitly confirmed) approved files into categorized folders.

    Folder structure: ``output_dir/<Category>/<filename>``
    Returns manifest list of performed operations.
    """
    id_map = {r.file_id: r for r in records if not r.skipped}
    approved = [d for d in decisions if d.approved]

    if not approved:
        logger.info("No approved files to organize")
        return []

    manifest: list[CopyManifestEntry] = []
    skipped_count = 0

    for dec in tqdm(approved, desc="Applying" if not dry_run else "Previewing", unit="file"):
        rec = id_map.get(dec.file_id)
        if rec is None:
            logger.warning("File ID %s not found in records — skipping", dec.file_id)
            skipped_count += 1
            continue

        # Final category & filename
        rec_cat = rec.classification.category if rec.classification else "Unknown"
        category = dec.override_category or (rec_cat if rec_cat != "Unknown" else dec.original_category)
        if category == "Unknown" and dec.override_category is None:
            logger.info("Skipping Unknown file %s", rec.filename)
            skipped_count += 1
            continue

        filename = dec.override_filename or getattr(dec, "target_filename", None) or rec.filename

        # Security check: do not copy unverified unsafe files (e.g. raw shell scripts or executables)
        if not is_safe_to_copy(rec.abs_path):
            logger.warning("Skipping unsafe file %s", rec.filename)
            skipped_count += 1
            continue

        dest_dir = output_dir / category
        dest_path = resolve_filename_collision(dest_dir, filename, rec.sha256)

        if dry_run:
            logger.info("[DRY RUN] %s → %s", rec.abs_path, dest_path)
        else:
            dest_dir.mkdir(parents=True, exist_ok=True)

            # Perform copy
            shutil.copy2(str(rec.abs_path), str(dest_path))

            # Post-copy integrity verification
            copied_hash = compute_sha256(dest_path)
            if copied_hash != rec.sha256:
                logger.error("HASH MISMATCH: %s (expected %s, got %s) - rolling back", dest_path, rec.sha256, copied_hash)
                if dest_path.exists():
                    dest_path.unlink()
                continue

            # If move_mode is enabled, delete original
            if move_mode:
                try:
                    os.remove(rec.abs_path)
                    logger.info("Moved %s -> %s [OK]", rec.filename, dest_path)
                except OSError as exc:
                    logger.error("Failed to remove original file during move: %s", exc)
            else:
                logger.info("Copied %s -> %s [OK]", rec.filename, dest_path)

        manifest_entry = CopyManifestEntry(
            original_path=rec.abs_path,
            destination_path=dest_path,
            sha256=rec.sha256,
            category=category,
            file_type=rec.file_category,
            classification_confidence=dec.original_confidence,
            operation="move" if move_mode and not dry_run else "copy",
            copied_at=datetime.now(timezone.utc),
        )
        manifest.append(manifest_entry)

    logger.info(
        "Organize complete: %d %s, %d skipped",
        len(manifest), "previewed" if dry_run else "processed", skipped_count
    )
    return manifest


def write_copy_manifest(manifest: list[CopyManifestEntry], output_dir: Path) -> None:
    """Write copy_manifest.csv."""
    path = output_dir / "copy_manifest.csv"
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "original_path", "destination_path", "sha256", "category",
            "file_type", "classification_confidence", "operation", "copied_at",
        ])
        writer.writeheader()
        for entry in manifest:
            writer.writerow({
                "original_path": str(entry.original_path),
                "destination_path": str(entry.destination_path),
                "sha256": entry.sha256,
                "category": entry.category,
                "file_type": entry.file_type,
                "classification_confidence": entry.classification_confidence,
                "operation": entry.operation,
                "copied_at": entry.copied_at.isoformat(),
            })
    logger.info("Saved copy manifest to %s (%d records)", path, len(manifest))
