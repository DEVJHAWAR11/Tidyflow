from pathlib import Path
from src.models import (
    ClassificationResult,
    FileRecord,
    LlmBatchResponse,
    LlmClassificationItem,
    ReviewDecision,
    RunSummary,
)


def test_file_record_creation():
    rec = FileRecord(
        file_id="abc123456789",
        abs_path=Path("/tmp/invoice.pdf"),
        rel_path=Path("invoice.pdf"),
        filename="invoice.pdf",
        extension=".pdf",
        file_size_bytes=1024,
        file_category="document",
    )
    assert rec.file_id == "abc123456789"
    assert rec.extension == ".pdf"
    assert rec.skipped is False


def test_classification_result_validation():
    res = ClassificationResult(
        category="Finance/Invoices",
        confidence=95.0,  # Should normalize from 0-100 to 0-1
        file_type="pdf_document",
        action="copy_to_organized",
    )
    assert res.confidence == 0.95
    assert res.action == "copy_to_organized"


def test_llm_batch_response_parsing():
    raw_json = {
        "results": [
            {
                "file_id": "test1",
                "category": "Finance/Invoices",
                "confidence": 0.92,
                "file_type": "pdf_document",
                "suggested_filename": "invoice_1.pdf",
                "reason": "Clear vendor billing",
                "action": "copy_to_organized",
            }
        ]
    }
    parsed = LlmBatchResponse.model_validate(raw_json)
    assert len(parsed.results) == 1
    assert parsed.results[0].category == "Finance/Invoices"
    assert parsed.results[0].confidence == 0.92


def test_review_decision():
    dec = ReviewDecision(
        file_id="f1",
        approved=True,
        override_category="Work/Documents",
        original_category="Unknown",
        original_confidence=0.4,
    )
    assert dec.approved is True
    assert dec.override_category == "Work/Documents"
