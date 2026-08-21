"""Recursive universal file scanner — discovers all file types and builds FileRecords."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator, Any

from tqdm import tqdm

from .config import (
    TidyConfig,
    SUPPORTED_IMAGE_EXTENSIONS,
    SUPPORTED_DOCUMENT_EXTENSIONS,
    SUPPORTED_CODE_EXTENSIONS,
    SUPPORTED_MEDIA_EXTENSIONS,
    SUPPORTED_ARCHIVE_EXTENSIONS,
)
from .models import FileRecord
from .utils import compute_sha256, make_file_id, is_secret_file

logger = logging.getLogger(__name__)

# Default folders / files to ignore
DEFAULT_IGNORED_NAMES: set[str] = {
    ".git", ".svn", ".hg", "__pycache__", ".pytest_cache", ".venv", "venv",
    "node_modules", ".DS_Store", "Thumbs.db", ".tidyflow",
    "Organized_Output", "organized_output", "Organized", "organized", "Staging", "staging",
}


def determine_file_category(ext: str) -> str:
    """Classify file extension into a general file category."""
    ext_lower = ext.lower()
    if ext_lower in SUPPORTED_IMAGE_EXTENSIONS:
        return "image"
    if ext_lower == ".pdf" or ext_lower in {".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt"}:
        return "document"
    if ext_lower in {".txt", ".md", ".csv", ".tsv"}:
        return "document"
    if ext_lower in SUPPORTED_CODE_EXTENSIONS:
        return "code"
    if ext_lower in {".json", ".yaml", ".yml", ".xml", ".sql", ".db", ".sqlite"}:
        return "data"
    if ext_lower in SUPPORTED_MEDIA_EXTENSIONS:
        return "media"
    if ext_lower in SUPPORTED_ARCHIVE_EXTENSIONS:
        return "archive"
    if ext_lower in {".exe", ".msi", ".dll", ".so", ".dylib", ".bin"}:
        return "binary"
    return "other"


def load_ignore_patterns(input_dir: Path) -> set[str]:
    """Load custom ignore patterns from .tidyignore if present."""
    patterns = set(DEFAULT_IGNORED_NAMES)
    ignore_file = input_dir / ".tidyignore"
    if ignore_file.exists():
        try:
            with open(ignore_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        patterns.add(line.rstrip("/"))
        except OSError:
            pass
    return patterns


def _matches_ignore(name: str, rel_path: Path, patterns: set[str]) -> bool:
    """Check if file/dir name or relative path matches any ignore pattern."""
    import fnmatch
    rel_str = str(rel_path).replace("\\", "/")
    for pat in patterns:
        if pat in name or fnmatch.fnmatch(name, pat) or fnmatch.fnmatch(rel_str, pat):
            return True
        if pat.endswith("/") and fnmatch.fnmatch(rel_str + "/", pat):
            return True
    return False


def scan_directory(config: TidyConfig) -> list[FileRecord]:
    """
    Recursively walk config.input_dir and generate validated FileRecords.
    """
    input_dir = config.input_dir
    if not input_dir.exists():
        raise FileNotFoundError(f"Input directory does not exist: {input_dir}")

    max_bytes = int(config.max_file_size_mb * 1_048_576)
    ignore_patterns = load_ignore_patterns(input_dir)
    if hasattr(config, "output_dir") and config.output_dir:
        ignore_patterns.add(config.output_dir.name)
    if hasattr(config, "staging_dir") and config.staging_dir:
        ignore_patterns.add(config.staging_dir.name)

    all_candidate_paths: list[Path] = []
    for root, dirs, files in os.walk(input_dir):
        # Filter out ignored directories in-place
        dirs[:] = [
            d for d in dirs
            if not _matches_ignore(d, Path(root, d).relative_to(input_dir), ignore_patterns)
            and not d.startswith(".")
        ]

        for fname in files:
            rel_p = Path(root, fname).relative_to(input_dir)
            if _matches_ignore(fname, rel_p, ignore_patterns) or fname.startswith("~$") or fname == ".tidyignore":
                continue
            all_candidate_paths.append(Path(root) / fname)

    all_candidate_paths.sort()
    logger.info("Found %d candidate files in %s", len(all_candidate_paths), input_dir)

    records: list[FileRecord] = []
    accepted = 0

    for file_path in tqdm(all_candidate_paths, desc="Scanning files", unit="file"):
        ext = file_path.suffix.lower()
        try:
            rel_path = file_path.relative_to(input_dir)
        except ValueError:
            rel_path = Path(file_path.name)

        # Check for secret credential files
        if is_secret_file(file_path):
            records.append(_make_skipped(file_path, rel_path, "Secret/credential file excluded"))
            continue

        # Stat file size and timestamps
        try:
            stat = file_path.stat()
            size = stat.st_size
            created = datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc)
            modified = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
        except OSError as exc:
            records.append(_make_skipped(file_path, rel_path, f"Cannot stat file: {exc}"))
            continue

        # Check maximum file size
        if size > max_bytes:
            records.append(_make_skipped(file_path, rel_path, f"File size {size}B exceeds {max_bytes}B limit"))
            continue

        if config.max_files is not None and accepted >= config.max_files:
            break

        # Compute SHA-256
        try:
            sha = compute_sha256(file_path)
        except OSError as exc:
            records.append(_make_skipped(file_path, rel_path, f"Hash error: {exc}"))
            continue

        file_id = make_file_id(sha)
        category_type = determine_file_category(ext)

        records.append(FileRecord(
            file_id=file_id,
            abs_path=file_path.resolve(),
            rel_path=rel_path,
            filename=file_path.name,
            extension=ext,
            file_size_bytes=size,
            created_at=created,
            modified_at=modified,
            sha256=sha,
            file_category=category_type,
        ))
        accepted += 1

    n_ok = sum(1 for r in records if not r.skipped)
    n_skip = sum(1 for r in records if r.skipped)
    logger.info("Scan complete — %d files to process, %d skipped", n_ok, n_skip)
    return records


def _make_skipped(abs_path: Path, rel_path: Path, reason: str) -> FileRecord:
    """Create a skipped FileRecord."""
    try:
        size = abs_path.stat().st_size
    except OSError:
        size = 0
    return FileRecord(
        file_id="",
        abs_path=abs_path.resolve(),
        rel_path=rel_path,
        filename=abs_path.name,
        extension=abs_path.suffix.lower(),
        file_size_bytes=size,
        file_category=determine_file_category(abs_path.suffix.lower()),
        skipped=True,
        skip_reason=reason,
    )


# Backward-compatible helper for simple scan iterator
def scan_files(target_dir: str | Path) -> Generator[dict[str, Any], None, None]:
    """Compatibility generator for scanning files."""
    cfg = TidyConfig(input_dir=Path(target_dir))
    records = scan_directory(cfg)
    for r in records:
        if not r.skipped:
            yield {
                "path": str(r.abs_path),
                "filename": r.filename,
                "size": r.file_size_bytes,
                "sha256": r.sha256,
                "fingerprint": r.sha256,
                "file_category": r.file_category,
            }
