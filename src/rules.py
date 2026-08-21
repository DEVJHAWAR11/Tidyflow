"""Fast-path heuristic rule engine & rapidfuzz keyword scorer."""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Optional

import yaml
from rapidfuzz import fuzz
from tqdm import tqdm

from .config import CategoryConfig
from .models import ClassificationResult, FileRecord

logger = logging.getLogger(__name__)

# Fallback Extension Heuristics
DEFAULT_EXTENSION_HEURISTICS: dict[str, list[str]] = {
    "Development/Code": [".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".rs", ".go", ".cpp", ".c", ".h", ".java", ".kt", ".dart", ".sh", ".rb", ".php"],
    "Development/Data": [".json", ".yaml", ".yml", ".xml", ".sql", ".db", ".sqlite"],
    "Media/Audio": [".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"],
    "Media/Video": [".mp4", ".mov", ".mkv", ".avi", ".webm"],
    "Archives": [".zip", ".tar", ".gz", ".tar.gz", ".bz2", ".7z", ".rar"],
    "Personal/Photos": [".heic", ".raw", ".cr2", ".nef"],
}


# ---------------------------------------------------------------------------
# Rapidfuzz Keyword Scoring
# ---------------------------------------------------------------------------

def score_keywords_all(
    records: list[FileRecord],
    categories: dict[str, CategoryConfig],
) -> None:
    """
    Score normalized extracted text against all category keywords using rapidfuzz.
    Saves scores in rec.keyword_scores (dict[category, score]).
    """
    processable = [
        r for r in records
        if not r.skipped and r.extracted_text_normalized
    ]

    if not processable:
        return

    for rec in tqdm(processable, desc="Keyword scoring", unit="file"):
        rec.keyword_scores = _score_single_text(rec.extracted_text_normalized or "", categories)


def _score_single_text(text: str, categories: dict[str, CategoryConfig]) -> dict[str, float]:
    """Score text against category keyword lists with exact word boundary and multi-word checking."""
    scores: dict[str, float] = {}
    text_lower = text.lower()

    for cat_name, cat_cfg in categories.items():
        if not cat_cfg.keywords:
            scores[cat_name] = 0.0
            continue

        cat_scores = []
        for kw in cat_cfg.keywords:
            kw_clean = kw.lower().strip()
            if not kw_clean:
                continue

            # Exact phrase match for multi-word keywords
            if " " in kw_clean:
                if kw_clean in text_lower:
                    cat_scores.append(100.0)
                else:
                    cat_scores.append(fuzz.partial_ratio(kw_clean, text_lower))
            else:
                # Word-boundary check for single words to avoid substring false positives
                if re.search(rf"\b{re.escape(kw_clean)}\b", text_lower):
                    cat_scores.append(100.0)
                elif len(kw_clean) >= 6:
                    cat_scores.append(fuzz.partial_ratio(kw_clean, text_lower))
                else:
                    cat_scores.append(0.0)

        scores[cat_name] = round(max(cat_scores), 2) if cat_scores else 0.0
    return scores


def identify_heuristic_candidates(
    records: list[FileRecord],
    *,
    high_threshold: float = 95.0,
    low_second: float = 40.0,
) -> list[FileRecord]:
    """
    Identify files where the top keyword score is high (>= high_threshold) and the
    runner-up score is low (< low_second) — safe for fast-path heuristic bypass.
    Only bypasses when there is strong multiple-category differentiation or exact 100% keyword match.
    """
    candidates: list[FileRecord] = []
    for rec in records:
        if rec.skipped or not rec.keyword_scores:
            continue

        sorted_scores = sorted(rec.keyword_scores.values(), reverse=True)
        if len(sorted_scores) < 2:
            # Single category: only bypass if exact 100% score
            if sorted_scores and sorted_scores[0] >= 100.0:
                candidates.append(rec)
            continue

        if sorted_scores[0] >= high_threshold and sorted_scores[1] < low_second:
            candidates.append(rec)

    return candidates


# ---------------------------------------------------------------------------
# Rule Engine Class
# ---------------------------------------------------------------------------

class RuleEngine:
    """Evaluates user rules, keyword scoring heuristics, and extension fallbacks."""

    def __init__(self, rules_file: str | Path = "rules.yaml", categories: dict[str, CategoryConfig] | None = None):
        self.rules_file = Path(rules_file)
        self.user_rules = self._load_rules()
        self.categories = categories or {}

    def _load_rules(self) -> list[dict[str, Any]]:
        if not self.rules_file.exists():
            return []
        try:
            with open(self.rules_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
                return data.get("rules", []) if isinstance(data, dict) else []
        except Exception:
            return []

    def evaluate(self, path_str: str) -> Optional[str]:
        """
        Evaluate rules for a file path. Returns matched category or None.
        (Backward-compatible helper)
        """
        path = Path(path_str)
        filename = path.name
        ext = path.suffix.lower()

        # 1. Custom User Rules
        for rule in self.user_rules:
            if "extensions" in rule and ext in [e.lower() for e in rule["extensions"]]:
                return rule.get("category", "Unknown")
            if "pattern" in rule and re.search(rule["pattern"], filename, re.IGNORECASE):
                return rule.get("category", "Unknown")
            if "contains" in rule and rule["contains"].lower() in filename.lower():
                return rule.get("category", "Unknown")

        # 2. Extension Fallback
        for category, exts in DEFAULT_EXTENSION_HEURISTICS.items():
            if ext in exts:
                return category

        return None

    def evaluate_record(self, rec: FileRecord) -> ClassificationResult | None:
        """
        Evaluate full record against user rules, size limits, and heuristics.
        """
        # Large Files (only if configured or no custom categories filter)
        if rec.file_size_bytes > 50 * 1024 * 1024 and (not self.categories or "Large_Files" in self.categories):
            return ClassificationResult(
                category="Large_Files",
                confidence=1.0,
                file_type="large_file",
                reason="File size exceeds 50 MB",
                action="copy_to_organized",
                source="extension_rule",
            )

        # User Rules
        for rule in self.user_rules:
            cat = rule.get("category", "Unknown")
            if self.categories and cat not in self.categories:
                continue
            if "extensions" in rule and rec.extension.lower() in [e.lower() for e in rule["extensions"]]:
                return ClassificationResult(
                    category=cat,
                    confidence=1.0,
                    file_type=rec.file_category,
                    reason=f"User rule matched extension {rec.extension}",
                    action="copy_to_organized",
                    source="user_rule",
                )
            if "pattern" in rule and re.search(rule["pattern"], rec.filename, re.IGNORECASE):
                return ClassificationResult(
                    category=cat,
                    confidence=1.0,
                    file_type=rec.file_category,
                    reason=f"User rule matched pattern {rule['pattern']}",
                    action="copy_to_organized",
                    source="user_rule",
                )
            if "contains" in rule and rule["contains"].lower() in rec.filename.lower():
                return ClassificationResult(
                    category=cat,
                    confidence=1.0,
                    file_type=rec.file_category,
                    reason=f"User rule matched keyword '{rule['contains']}' in filename",
                    action="copy_to_organized",
                    source="user_rule",
                )

        # Fallback Extension Heuristics (only for active configured categories)
        if rec.file_category in {"code", "archive", "media"}:
            for category, exts in DEFAULT_EXTENSION_HEURISTICS.items():
                if (not self.categories or category in self.categories) and rec.extension.lower() in exts:
                    return ClassificationResult(
                        category=category,
                        confidence=0.90,
                        file_type=rec.file_category,
                        reason=f"Extension heuristic {rec.extension}",
                        action="copy_to_organized",
                        source="extension_rule",
                    )

        return None
