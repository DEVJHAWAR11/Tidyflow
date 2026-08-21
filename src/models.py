"""Pydantic data models for file records, LLM requests/responses, and review decisions."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Default Allowed Categories & File Types
# ---------------------------------------------------------------------------

DEFAULT_CATEGORIES: set[str] = {
    "Finance/Invoices",
    "Finance/Receipts",
    "Finance/Tax",
    "Finance/Statements",
    "Legal/Contracts",
    "Legal/IDs_and_Certificates",
    "Work/Documents",
    "Work/Spreadsheets",
    "Work/Presentations",
    "Personal/Photos",
    "Personal/Notes",
    "Development/Code",
    "Development/Data",
    "Media/Audio",
    "Media/Video",
    "Archives",
    "Large_Files",
    "Unknown",
}

ALLOWED_ACTIONS: set[str] = {"copy_to_organized", "manual_review"}
ALLOWED_SOURCES: set[str] = {"llm", "heuristic_high_confidence", "user_rule", "extension_rule", "none"}


# ---------------------------------------------------------------------------
# Classification Result
# ---------------------------------------------------------------------------

class ClassificationResult(BaseModel):
    """Result of classifying a single file."""
    category: str = "Unknown"
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    file_type: str = "unknown"
    suggested_filename: str = ""
    reason: str = ""
    action: str = "manual_review"
    source: str = "none"

    @field_validator("action")
    @classmethod
    def _validate_action(cls, v: str) -> str:
        if v not in ALLOWED_ACTIONS:
            return "manual_review"
        return v

    @field_validator("confidence", mode="before")
    @classmethod
    def _validate_confidence(cls, v: Any) -> float:
        val = float(v)
        # normalize 0-100 scale to 0.0-1.0 if needed
        if val > 1.0 and val <= 100.0:
            val = round(val / 100.0, 4)
        return max(0.0, min(1.0, val))


# ---------------------------------------------------------------------------
# File Record (universal inventory item)
# ---------------------------------------------------------------------------

class FileRecord(BaseModel):
    """Complete inventory record for a single scanned file."""
    file_id: str
    abs_path: Path
    rel_path: Path
    filename: str
    extension: str
    file_size_bytes: int
    created_at: datetime | None = None
    modified_at: datetime | None = None

    # content hash
    sha256: str = ""

    # file category (high-level group)
    file_category: str = "other"  # document, image, code, data, office, media, archive, binary, other

    # visual metadata (images, scanned PDFs)
    width: int | None = None
    height: int | None = None
    aspect_ratio: float | None = None
    image_mode: str | None = None
    page_count: int | None = None
    exif: dict[str, Any] | None = None

    # extracted text & OCR
    extracted_text_raw: str | None = None
    extracted_text_normalized: str | None = None
    extraction_source: str | None = None  # direct_text | pdf_text | ocr | office_doc
    ocr_confidence: float | None = None

    # hashing & duplicates
    perceptual_hash: str | None = None
    duplicate_group_id: str | None = None
    near_duplicate_group_id: str | None = None

    # keyword scoring
    keyword_scores: dict[str, float] = Field(default_factory=dict)

    # classification
    classification: ClassificationResult | None = None

    # processing errors
    processing_errors: list[str] = Field(default_factory=list)

    # base64 thumbnail (images, first page of PDFs)
    thumbnail_b64: str | None = None

    # skip tracking
    skipped: bool = False
    skip_reason: str | None = None

    model_config = {"arbitrary_types_allowed": True}


# ---------------------------------------------------------------------------
# LLM Request / Response Models
# ---------------------------------------------------------------------------

class LlmFilePayload(BaseModel):
    """Compact record sent to LLM for classification (no raw image bytes)."""
    file_id: str
    filename: str
    extension: str
    file_category: str
    file_size_bytes: int
    extracted_text: str = ""
    keyword_scores: dict[str, float] = Field(default_factory=dict)
    duplicate_group_id: str | None = None
    near_duplicate_group_id: str | None = None


class LlmClassificationItem(BaseModel):
    """A single classification item returned by LLM in batched response."""
    file_id: str
    category: str = "Unknown"
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    file_type: str = "unknown"
    suggested_filename: str = ""
    reason: str = ""
    action: str = "manual_review"

    @field_validator("confidence", mode="before")
    @classmethod
    def _validate_conf(cls, v: Any) -> float:
        val = float(v)
        if val > 1.0 and val <= 100.0:
            val = round(val / 100.0, 4)
        return max(0.0, min(1.0, val))

    @field_validator("action")
    @classmethod
    def _validate_action(cls, v: str) -> str:
        if v not in ALLOWED_ACTIONS:
            return "manual_review"
        return v


class LlmBatchResponse(BaseModel):
    """Expected JSON response from LLM."""
    results: list[LlmClassificationItem]


# ---------------------------------------------------------------------------
# Review Decision (from HTML export or user approval)
# ---------------------------------------------------------------------------

class ReviewDecision(BaseModel):
    """A single decision row from review_decisions.csv."""
    file_id: str
    approved: bool = False
    override_category: str | None = None
    override_filename: str | None = None
    original_category: str = "Unknown"
    original_confidence: float = 0.0


# ---------------------------------------------------------------------------
# Copy / Move Manifest Entry
# ---------------------------------------------------------------------------

class CopyManifestEntry(BaseModel):
    """One record in copy_manifest.csv."""
    original_path: Path
    destination_path: Path
    sha256: str
    category: str
    file_type: str
    classification_confidence: float
    operation: str = "copy"  # copy | move
    copied_at: datetime

    model_config = {"arbitrary_types_allowed": True}


# ---------------------------------------------------------------------------
# Run Summary
# ---------------------------------------------------------------------------

class RunSummary(BaseModel):
    """Aggregate statistics for a pipeline run."""
    total_scanned: int = 0
    total_skipped: int = 0
    text_extracted: int = 0
    ocr_processed: int = 0
    ocr_cached: int = 0
    exact_duplicates: int = 0
    near_duplicates: int = 0
    heuristic_classified: int = 0
    llm_classified: int = 0
    classified_unknown: int = 0
    manual_review: int = 0
    copied_files: int = 0
    moved_files: int = 0
    errors: int = 0
    estimated_api_tokens: int = 0
    run_started_at: datetime | None = None
    run_finished_at: datetime | None = None
