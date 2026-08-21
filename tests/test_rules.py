from pathlib import Path
import yaml
from src.rules import RuleEngine
from src.models import FileRecord


def test_rule_engine_evaluation(tmp_path):
    rules_path = tmp_path / "rules.yaml"
    rules_data = {
        "rules": [
            {"category": "Finance/Invoices", "contains": "invoice"},
            {"category": "Work/Resumes", "pattern": "^resume.*"},
            {"category": "Finance/Tax", "extensions": [".tax2023"]},
        ]
    }
    with open(rules_path, "w") as f:
        yaml.dump(rules_data, f)

    engine = RuleEngine(rules_file=rules_path)

    assert engine.evaluate("my_invoice_2023.pdf") == "Finance/Invoices"
    assert engine.evaluate("resume_arpan.pdf") == "Work/Resumes"
    assert engine.evaluate("file.tax2023") == "Finance/Tax"
    assert engine.evaluate("script.py") == "Development/Code"
    assert engine.evaluate("archive.zip") == "Archives"


def test_rule_engine_record_evaluation():
    engine = RuleEngine(rules_file="nonexistent.yaml")
    rec = FileRecord(
        file_id="1",
        abs_path=Path("big.mp4"),
        rel_path=Path("big.mp4"),
        filename="big.mp4",
        extension=".mp4",
        file_size_bytes=52 * 1024 * 1024,
        file_category="media",
    )
    res = engine.evaluate_record(rec)
    assert res is not None
    assert res.category == "Large_Files"
