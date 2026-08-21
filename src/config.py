"""Configuration loader — parses config.yaml + .env into validated Pydantic models."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default Extensions
# ---------------------------------------------------------------------------

SUPPORTED_IMAGE_EXTENSIONS: set[str] = {
    ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif", ".gif", ".heic",
}

SUPPORTED_DOCUMENT_EXTENSIONS: set[str] = {
    ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt",
    ".txt", ".md", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml",
}

SUPPORTED_CODE_EXTENSIONS: set[str] = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".rs", ".go",
    ".cpp", ".c", ".h", ".java", ".kt", ".dart", ".sh", ".rb", ".php", ".sql",
}

SUPPORTED_MEDIA_EXTENSIONS: set[str] = {
    ".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg",
    ".mp4", ".mov", ".mkv", ".avi", ".webm",
}

SUPPORTED_ARCHIVE_EXTENSIONS: set[str] = {
    ".zip", ".tar", ".gz", ".tar.gz", ".bz2", ".tbz2", ".7z", ".rar", ".dmg", ".pkg", ".iso",
}

ALL_SUPPORTED_EXTENSIONS: set[str] = (
    SUPPORTED_IMAGE_EXTENSIONS
    | SUPPORTED_DOCUMENT_EXTENSIONS
    | SUPPORTED_CODE_EXTENSIONS
    | SUPPORTED_MEDIA_EXTENSIONS
    | SUPPORTED_ARCHIVE_EXTENSIONS
)


# ---------------------------------------------------------------------------
# Nested Config Sections
# ---------------------------------------------------------------------------

class OcrConfig(BaseModel):
    """OCR engine configuration."""
    enabled: bool = True
    languages: list[str] = Field(default_factory=lambda: ["en"])
    skip_images_smaller_than: int = 120  # px on either dimension
    max_image_dimension: int = Field(default=768, ge=128)
    use_textline_orientation: bool = False
    text_detection_model_name: str = "PP-OCRv5_mobile_det"
    text_recognition_model_name: str = "en_PP-OCRv4_mobile_rec"


class LlmConfig(BaseModel):
    """Batched LLM API configuration."""
    enabled: bool = True
    provider: str = "deepseek"  # deepseek | openai | groq | openrouter | gemini | custom
    api_base_url: str = "https://api.deepseek.com"
    model: str = "deepseek-chat"
    batch_size: int = 40
    max_retries: int = 3
    timeout_seconds: int = 90
    custom_instructions: str = ""


class ClassificationConfig(BaseModel):
    """Classification rules and thresholds."""
    auto_copy_threshold: float = 0.85
    heuristic_bypass_enabled: bool = True
    heuristic_high_threshold: float = 88.0
    heuristic_low_second: float = 50.0
    default_category: str = "Unknown"


class DuplicateConfig(BaseModel):
    """Duplicate detection configuration."""
    hamming_distance_threshold: int = 8


class CategoryConfig(BaseModel):
    """Configuration for a specific category."""
    description: str = ""
    keywords: list[str] = Field(default_factory=list)
    extensions: list[str] = Field(default_factory=list)

    @field_validator("keywords", "extensions", mode="before")
    @classmethod
    def _coerce_strings(cls, v: Any) -> list[str]:
        if isinstance(v, list):
            return [str(item) for item in v]
        return v


# ---------------------------------------------------------------------------
# Root Config Model
# ---------------------------------------------------------------------------

class TidyConfig(BaseModel):
    """Root configuration for TidyFlow."""
    input_dir: Path = Field(default_factory=lambda: Path("./sample_data"))
    output_dir: Path = Field(default_factory=lambda: Path("./organized_output"))
    staging_dir: Path = Field(default_factory=lambda: Path("./organized_output/Staging"))

    max_file_size_mb: float = 50.0
    thumbnail_max_dim: int = 200
    max_files: int | None = Field(default=None, ge=1)

    ocr: OcrConfig = Field(default_factory=OcrConfig)
    llm: LlmConfig = Field(default_factory=LlmConfig)
    classification: ClassificationConfig = Field(default_factory=ClassificationConfig)
    duplicates: DuplicateConfig = Field(default_factory=DuplicateConfig)
    categories: dict[str, CategoryConfig] = Field(default_factory=dict)

    supported_extensions: set[str] = Field(
        default_factory=lambda: ALL_SUPPORTED_EXTENSIONS.copy()
    )

    @field_validator("input_dir", mode="before")
    @classmethod
    def _resolve_input(cls, v: Any) -> Path:
        return Path(str(v)).resolve()

    @field_validator("output_dir", "staging_dir", mode="before")
    @classmethod
    def _resolve_output(cls, v: Any) -> Path:
        p = Path(str(v)).resolve()
        return p


# ---------------------------------------------------------------------------
# Loader Function
# ---------------------------------------------------------------------------

def load_config(config_path: str | Path | None = None) -> TidyConfig:
    """Load config.yaml, merge with .env, and return a validated TidyConfig."""
    load_dotenv()

    # Search paths for config.yaml if not provided
    candidate_paths: list[Path] = []
    if config_path:
        candidate_paths.append(Path(config_path).resolve())
    else:
        candidate_paths.extend([
            Path.cwd() / "config.yaml",
            Path.cwd() / "config.yml",
            Path(__file__).parent.parent / "config.yaml",
        ])

    target_path: Path | None = None
    for p in candidate_paths:
        if p.exists():
            target_path = p
            break

    raw_data: dict[str, Any] = {}
    if target_path and target_path.exists():
        # Load .env in config directory if present
        env_file = target_path.parent / ".env"
        if env_file.exists():
            load_dotenv(env_file)

        with open(target_path, "r", encoding="utf-8") as f:
            raw_data = yaml.safe_load(f) or {}
        logger.info("Loaded configuration from %s", target_path)
    else:
        logger.info("No config.yaml found; using default configuration")

    # If categories not in config, populate default categories
    if "categories" not in raw_data or not raw_data["categories"]:
        raw_data["categories"] = _get_default_category_definitions()

    cfg = TidyConfig(**raw_data)
    return cfg


def _get_default_category_definitions() -> dict[str, dict[str, Any]]:
    """Return default category configuration dict."""
    return {
        "Finance/Invoices": {
            "description": "Invoices and billing documents",
            "keywords": ["invoice", "bill", "billing", "amount due", "invoice number", "remit payment"],
            "extensions": [".pdf", ".png", ".jpg", ".docx"],
        },
        "Finance/Receipts": {
            "description": "Receipts and purchase confirmations",
            "keywords": ["receipt", "order confirmation", "payment received", "subtotal", "paid"],
            "extensions": [".pdf", ".png", ".jpg", ".jpeg", ".webp"],
        },
        "Finance/Tax": {
            "description": "Tax returns and filings",
            "keywords": ["tax", "w-2", "1099", "irs", "tax return", "form 1040"],
            "extensions": [".pdf", ".xlsx", ".csv"],
        },
        "Legal/Contracts": {
            "description": "Contracts, NDAs and agreements",
            "keywords": ["agreement", "contract", "non-disclosure", "nda", "terms", "signature"],
            "extensions": [".pdf", ".docx", ".doc"],
        },
        "Work/Documents": {
            "description": "Work reports and notes",
            "keywords": ["report", "meeting notes", "proposal", "memo", "project plan"],
            "extensions": [".pdf", ".docx", ".doc", ".md", ".txt"],
        },
        "Work/Spreadsheets": {
            "description": "Workbooks, data tables, metrics",
            "keywords": ["spreadsheet", "budget", "forecast", "metrics", "inventory"],
            "extensions": [".xlsx", ".xls", ".csv", ".tsv"],
        },
        "Personal/Photos": {
            "description": "Personal photos and images",
            "keywords": ["photo", "picture", "camera", "portrait", "landscape"],
            "extensions": [".jpg", ".jpeg", ".png", ".heic"],
        },
        "Development/Code": {
            "description": "Source code and scripts",
            "keywords": ["import", "function", "class", "def", "const", "return"],
            "extensions": [".py", ".js", ".ts", ".html", ".css", ".rs", ".go", ".cpp", ".java"],
        },
        "Development/Data": {
            "description": "Data and configuration files",
            "keywords": ["json", "yaml", "schema", "database", "export"],
            "extensions": [".json", ".yaml", ".yml", ".xml", ".sql"],
        },
        "Archives": {
            "description": "Compressed archives",
            "keywords": ["archive", "zip", "backup", "tar"],
            "extensions": [".zip", ".tar", ".gz", ".7z", ".rar"],
        },
        "Large_Files": {
            "description": "Files exceeding size limits",
            "keywords": [],
            "extensions": [],
        },
        "Unknown": {
            "description": "Unclassified files",
            "keywords": [],
            "extensions": [],
        },
    }
