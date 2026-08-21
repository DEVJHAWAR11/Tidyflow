"""Unit tests for AI Assistant conversational taxonomy and review commands."""

import pytest
from src.ai_assistant import (
    chat_generate_structure,
    apply_review_command,
    _fallback_heuristic_structure,
    _fallback_heuristic_review_command,
)


def test_fallback_heuristic_academic():
    res = _fallback_heuristic_structure("I am a student at university. Organize my homework, lecture notes and research papers.")
    assert "categories" in res
    assert res["is_ready"] is True
    assert any("Lecture_Notes" in k or "Assignments" in k for k in res["categories"].keys())
    assert len(res["categories"]) >= 2


def test_fallback_heuristic_freelance():
    res = _fallback_heuristic_structure("Freelance work: sort client invoices, contracts and final deliverables.")
    assert "categories" in res
    assert res["is_ready"] is True
    assert any("Client_Work" in k or "Invoices" in k for k in res["categories"].keys())


def test_fallback_heuristic_developer():
    res = _fallback_heuristic_structure("Developer code, python scripts, json datasets, and documentation.")
    assert "categories" in res
    assert res["is_ready"] is True
    assert any("Development" in k or "Source_Code" in k for k in res["categories"].keys())


def test_fallback_heuristic_review_command():
    files = [
        {"file_id": "1", "filename": "receipt_2026.pdf", "extension": ".pdf", "category": "Work"},
        {"file_id": "2", "filename": "photo.jpg", "extension": ".jpg", "category": "Media"},
        {"file_id": "3", "filename": "invoice_acme.pdf", "extension": ".pdf", "category": "Work"},
    ]
    categories = ["Finance/Invoices", "Media/Images", "Legal/Contracts"]

    res = _fallback_heuristic_review_command("Move all invoice and receipt files to Finance/Invoices", files, categories)
    assert "category_overrides" in res
    assert "1" in res["category_overrides"] or "3" in res["category_overrides"]
    if "3" in res["category_overrides"]:
        assert res["category_overrides"]["3"] == "Finance/Invoices"


def test_chat_generate_structure_execution():
    res = chat_generate_structure(
        message="Group my files into Taxes, Medical, and Photos",
        current_categories={"Default": {"name": "Default", "description": "", "keywords": [], "extensions": [], "active": True}},
        sample_filenames=["w2_2025.pdf", "doctor_bill.pdf", "trip.jpg"],
    )
    assert "message" in res
    assert "categories" in res
    assert len(res["categories"]) > 0
