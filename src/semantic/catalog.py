"""The embedding models a user can download, and the saved choice of model."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

from .. import utils
from ..utils import write_text_atomic

logger = logging.getLogger(__name__)

# Files are fetched from one fixed revision, so a later upload to the repo can't change what we run.
HF_REPO = "ggml-org/embeddinggemma-2-GGUF"
HF_REVISION = "6ea3e3a309d12a4779cfda98b8c19800d2d5da71"

# Bump when the text sent to the model changes, so every vector is made again the same way.
PROMPT_VERSION = 1
DIMS = 768


@dataclass(frozen=True)
class ModelChoice:
    key: str
    label: str
    filename: str
    size_bytes: int
    sha256: str
    blurb: str
    recommended: bool = False

    @property
    def url(self) -> str:
        return f"https://huggingface.co/{HF_REPO}/resolve/{HF_REVISION}/{self.filename}"

    @property
    def fingerprint(self) -> str:
        """Stored beside every vector; vectors from another model or prompt can't be compared."""
        return f"embeddinggemma-2:{self.key}:{DIMS}:p{PROMPT_VERSION}"


# Only the text model: the separate image and audio encoder (mmproj) isn't used. There is no F16
# build on purpose: the model's activations overflow float16 and give NaN or quietly wrong vectors.
MODELS: dict[str, ModelChoice] = {
    "q8_0": ModelChoice(
        key="q8_0",
        label="Standard",
        filename="embeddinggemma-2-Q8_0.gguf",
        size_bytes=309_855_456,
        sha256="2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135",
        blurb="8-bit. Same results for search in practice, half the size and faster.",
        recommended=True,
    ),
    "bf16": ModelChoice(
        key="bf16",
        label="Full precision",
        filename="embeddinggemma-2-BF16.gguf",
        size_bytes=557_950_176,
        sha256="68bae29d62fb8c7d23e98d21fd4662753ddd636e6b62b8a70dfe059a9844f216",
        blurb="Unquantized weights. Larger and slower, for anyone who wants them.",
    ),
}
DEFAULT_MODEL = "q8_0"


def models_dir() -> Path:
    path = utils.get_app_data_dir() / "models"
    path.mkdir(parents=True, exist_ok=True)
    return path


def model_path(choice: ModelChoice) -> Path:
    return models_dir() / choice.filename


def is_downloaded(choice: ModelChoice) -> bool:
    """True when the finished, checked file is in place (downloads land under another name first)."""
    path = model_path(choice)
    try:
        return path.is_file() and path.stat().st_size == choice.size_bytes
    except OSError:
        return False


# ---------------------------------------------------------------------------
# The saved choice: semantic.json in the app data folder
# ---------------------------------------------------------------------------

def _settings_file() -> Path:
    return utils.get_app_data_dir() / "semantic.json"


def load_prefs() -> dict:
    """``{"enabled": bool, "model": key}``; off with the default model when nothing is saved."""
    prefs = {"enabled": False, "model": DEFAULT_MODEL}
    try:
        saved = json.loads(_settings_file().read_text(encoding="utf-8"))
        if isinstance(saved, dict):
            if isinstance(saved.get("enabled"), bool):
                prefs["enabled"] = saved["enabled"]
            if saved.get("model") in MODELS:
                prefs["model"] = saved["model"]
    except FileNotFoundError:
        pass
    except (OSError, ValueError) as e:
        logger.warning("Could not read semantic search settings: %s", e)
    return prefs


def save_prefs(*, enabled: bool | None = None, model: str | None = None) -> dict:
    prefs = load_prefs()
    if enabled is not None:
        prefs["enabled"] = bool(enabled)
    if model is not None:
        if model not in MODELS:
            raise ValueError(f"Unknown model: {model}")
        prefs["model"] = model
    write_text_atomic(_settings_file(), json.dumps(prefs))
    return prefs
