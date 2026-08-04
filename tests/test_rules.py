import pytest
import yaml
import tempfile
from pathlib import Path
from src.rules import RuleEngine

def test_rule_engine():
    with tempfile.TemporaryDirectory() as temp_dir:
        rules_path = Path(temp_dir) / "rules.yaml"
        
        # Write some rules
        rules_data = {
            "rules": [
                {"category": "Invoices", "contains": "invoice"},
                {"category": "Career", "pattern": "^resume.*"},
                {"category": "Taxes", "extensions": [".tax2023"]}
            ]
        }
        
        with open(rules_path, "w") as f:
            yaml.dump(rules_data, f)
            
        engine = RuleEngine(rules_file=str(rules_path))
        
        # Test User Rules
        assert engine.evaluate("my_invoice_2023.pdf") == "Invoices"
        assert engine.evaluate("Resume_John.docx") == "Career"
        assert engine.evaluate("data.tax2023") == "Taxes"
        
        # Test Heuristics (Fallback)
        assert engine.evaluate("random.png") == "Images"
        assert engine.evaluate("script.py") == "Code"
        assert engine.evaluate("document.pdf") == "Documents"
        
        # Test No Match
        assert engine.evaluate("unknown.xyz") is None

def test_rule_engine_no_rules_file():
    # If the file doesn't exist, it should just gracefully fall back to heuristics
    engine = RuleEngine(rules_file="does_not_exist.yaml")
    
    # User rules shouldn't apply (because they don't exist)
    assert engine.evaluate("my_invoice_2023.xyz") is None
    
    # Heuristics should still work
    assert engine.evaluate("random.png") == "Images"
