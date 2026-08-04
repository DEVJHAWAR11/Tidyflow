import re
import yaml
from pathlib import Path
from typing import Dict, Any, Optional

DEFAULT_HEURISTICS = {
    "Documents": [".pdf", ".docx", ".doc", ".txt", ".xlsx", ".csv", ".pptx", ".md"],
    "Images": [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"],
    "Archives": [".zip", ".tar", ".gz", ".rar", ".7z"],
    "Code": [".py", ".js", ".html", ".css", ".rs", ".go", ".cpp", ".json", ".yaml"],
    "Audio": [".mp3", ".wav", ".flac"],
    "Video": [".mp4", ".mkv", ".avi", ".mov"]
}

class RuleEngine:
    def __init__(self, rules_file: str = "rules.yaml"):
        self.rules_file = rules_file
        self.user_rules = self._load_rules()

    def _load_rules(self) -> list:
        if not Path(self.rules_file).exists():
            return []
        try:
            with open(self.rules_file, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f)
                return data.get("rules", []) if isinstance(data, dict) else []
        except Exception:
            return []

    def evaluate(self, path_str: str) -> Optional[str]:
        """
        Evaluate rules and heuristics.
        Returns category if matched, None if it should go to AI.
        """
        path = Path(path_str)
        filename = path.name
        ext = path.suffix.lower()

        # 1. Custom User Rules (Highest priority)
        for rule in self.user_rules:
            # Match by extension
            if "extensions" in rule and ext in [e.lower() for e in rule["extensions"]]:
                return rule["category"]
            # Match by filename pattern
            if "pattern" in rule:
                if re.search(rule["pattern"], filename, re.IGNORECASE):
                    return rule["category"]
            # Match by simple contains
            if "contains" in rule:
                if rule["contains"].lower() in filename.lower():
                    return rule["category"]

        # 2. Fast Path Heuristics (Partial: Disabled for Documents/Images to force AI)
        for category, exts in DEFAULT_HEURISTICS.items():
            if category in ["Documents", "Images"]:
                continue # Force AI to read these
            if ext in exts:
                return category

        # 3. No match -> send to AI
        return None
