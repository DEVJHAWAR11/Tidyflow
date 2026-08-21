import tempfile
from pathlib import Path
import yaml
from src.config import load_config, TidyConfig


def test_load_default_config():
    cfg = load_config()
    assert isinstance(cfg, TidyConfig)
    assert cfg.max_file_size_mb >= 50.0
    assert "Finance/Invoices" in cfg.categories
    assert "Development/Code" in cfg.categories


def test_load_custom_yaml(tmp_path):
    custom_yaml = tmp_path / "custom_config.yaml"
    data = {
        "input_dir": str(tmp_path / "input"),
        "output_dir": str(tmp_path / "output"),
        "max_file_size_mb": 25.0,
        "classification": {
            "auto_copy_threshold": 0.90,
            "heuristic_bypass_enabled": True,
        },
        "categories": {
            "Work/Projects": {
                "description": "Project files",
                "keywords": ["sprint", "milestone"],
                "extensions": [".md", ".pdf"],
            }
        }
    }
    with open(custom_yaml, "w") as f:
        yaml.dump(data, f)

    cfg = load_config(custom_yaml)
    assert cfg.max_file_size_mb == 25.0
    assert cfg.classification.auto_copy_threshold == 0.90
    assert "Work/Projects" in cfg.categories
    assert "sprint" in cfg.categories["Work/Projects"].keywords
