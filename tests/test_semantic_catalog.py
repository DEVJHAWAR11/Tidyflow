import json

import pytest

from src.semantic import catalog


def test_models_are_pinned_text_only_and_not_float16():
    assert catalog.DEFAULT_MODEL in catalog.MODELS
    for choice in catalog.MODELS.values():
        assert catalog.HF_REVISION in choice.url
        assert choice.url.endswith(choice.filename)
        assert len(choice.sha256) == 64
        assert "mmproj" not in choice.filename
        assert "F16" not in choice.filename.replace("BF16", "")
    assert sum(c.recommended for c in catalog.MODELS.values()) == 1


def test_fingerprint_differs_per_model():
    prints = {c.fingerprint for c in catalog.MODELS.values()}
    assert len(prints) == len(catalog.MODELS)


def test_prefs_default_off(isolated_app_data):
    assert catalog.load_prefs() == {"enabled": False, "model": catalog.DEFAULT_MODEL}


def test_prefs_round_trip(isolated_app_data):
    catalog.save_prefs(enabled=True, model="bf16")
    assert catalog.load_prefs() == {"enabled": True, "model": "bf16"}
    catalog.save_prefs(enabled=False)
    assert catalog.load_prefs() == {"enabled": False, "model": "bf16"}


def test_prefs_reject_unknown_model(isolated_app_data):
    with pytest.raises(ValueError):
        catalog.save_prefs(model="q4_k_m")


def test_prefs_ignore_a_damaged_file(isolated_app_data):
    (isolated_app_data / "semantic.json").write_text("{not json", encoding="utf-8")
    assert catalog.load_prefs()["enabled"] is False
    (isolated_app_data / "semantic.json").write_text(json.dumps({"enabled": "yes", "model": "nope"}))
    assert catalog.load_prefs() == {"enabled": False, "model": catalog.DEFAULT_MODEL}


def test_is_downloaded_checks_the_size(isolated_app_data):
    choice = catalog.MODELS["q8_0"]
    assert not catalog.is_downloaded(choice)
    catalog.model_path(choice).write_bytes(b"partial")
    assert not catalog.is_downloaded(choice)
    assert catalog.model_path(choice).parent == isolated_app_data / "models"
