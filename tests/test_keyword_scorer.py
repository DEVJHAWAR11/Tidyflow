from pathlib import Path
from src.config import CategoryConfig
from src.models import FileRecord
from src.rules import score_keywords_all, identify_heuristic_candidates


def test_keyword_scoring():
    categories = {
        "Finance/Invoices": CategoryConfig(
            description="Invoices",
            keywords=["invoice", "total amount", "remit payment", "due date"],
        ),
        "Legal/Contracts": CategoryConfig(
            description="Contracts",
            keywords=["agreement", "non-disclosure", "governing law"],
        ),
    }

    rec1 = FileRecord(
        file_id="1",
        abs_path=Path("inv.pdf"),
        rel_path=Path("inv.pdf"),
        filename="inv.pdf",
        extension=".pdf",
        file_size_bytes=100,
        extracted_text_normalized="invoice due date total amount $500",
    )

    score_keywords_all([rec1], categories)
    assert rec1.keyword_scores.get("Finance/Invoices", 0) > 80.0
    assert rec1.keyword_scores.get("Legal/Contracts", 0) < 50.0

    candidates = identify_heuristic_candidates([rec1], high_threshold=80.0, low_second=50.0)
    assert len(candidates) == 1
    assert candidates[0].file_id == "1"
