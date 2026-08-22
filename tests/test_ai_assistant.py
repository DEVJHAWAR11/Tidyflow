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


def test_fallback_heuristic_clustering():
    from src.ai_assistant import _fallback_heuristic_clustering
    files = [
        {"file_id": "f1", "filename": "Screenshot_123.jpg", "extension": ".jpg"},
        {"file_id": "f2", "filename": "react_module_01.mp4", "extension": ".mp4"},
        {"file_id": "f3", "filename": "data_dump.sql", "extension": ".sql"},
    ]
    res = _fallback_heuristic_clustering(files)
    assert "clusters" in res
    assert "category_overrides" in res
    assert "f1" in res["category_overrides"]
    assert "f2" in res["category_overrides"]
    assert "f3" in res["category_overrides"]
    assert res["category_overrides"]["f1"] == "Screenshots"
    assert res["category_overrides"]["f2"] == "Course_Materials"
    assert res["category_overrides"]["f3"] == "Developer_Files"


def test_cluster_unrecognized_files_fallback():
    from src.ai_assistant import cluster_unrecognized_files
    files = [
        {"file_id": "f1", "filename": "invoice_998.pdf", "extension": ".pdf"},
        {"file_id": "f2", "filename": "backup.zip", "extension": ".zip"},
    ]
    res = cluster_unrecognized_files(files, existing_categories=["KIIT"])
    assert "clusters" in res
    assert "category_overrides" in res
    assert len(res["category_overrides"]) == 2


def test_fallback_heuristic_delete_category():
    current_cats = {
        "Work": {"name": "Work", "description": "", "keywords": [], "extensions": [], "active": True},
        "Finance": {"name": "Finance", "description": "", "keywords": [], "extensions": [], "active": True},
        "Photos": {"name": "Photos", "description": "", "keywords": [], "extensions": [], "active": True},
    }
    res = _fallback_heuristic_structure("Please delete the Work category", current_categories=current_cats)
    assert "Work" not in res["categories"]
    assert "Finance" in res["categories"]
    assert "Photos" in res["categories"]


def test_fallback_heuristic_rename_category():
    current_cats = {
        "Invoices": {"name": "Invoices", "description": "", "keywords": [], "extensions": [], "active": True},
        "Documents": {"name": "Documents", "description": "", "keywords": [], "extensions": [], "active": True},
    }
    res = _fallback_heuristic_structure("Rename Invoices to Bills_2026", current_categories=current_cats)
    assert "Invoices" not in res["categories"]
    assert "Bills_2026" in res["categories"]


def test_fallback_heuristic_add_category():
    current_cats = {
        "Work": {"name": "Work", "description": "", "keywords": [], "extensions": [], "active": True},
    }
    res = _fallback_heuristic_structure("Add a new folder for Receipts", current_categories=current_cats)
    assert "Work" in res["categories"]
    assert "Receipts" in res["categories"]


def test_fallback_heuristic_complexity_levels():
    sample_files = [
        "invoice_01.pdf", "receipt_feb.pdf", "lecture_01.pdf", "assignment_hw.docx",
        "script.py", "database.sql", "screenshot_1.png", "photo_vacation.jpg", "backup.zip"
    ]
    # Low complexity (broad flat buckets)
    res_low = _fallback_heuristic_structure("", sample_filenames=sample_files, complexity_level="low")
    assert len(res_low["categories"]) <= 4
    assert not any("/" in k for k in res_low["categories"].keys())

    # High / Complex (granular / hierarchical)
    res_high = _fallback_heuristic_structure("", sample_filenames=sample_files, complexity_level="high")
    assert len(res_high["categories"]) >= 4
    assert any("/" in k for k in res_high["categories"].keys())


def test_chat_generate_structure_auto_discover():
    res = chat_generate_structure(
        message="Auto-discover taxonomy",
        sample_filenames=["invoice_acme.pdf", "lecture_ai.pptx", "backend.py"],
        complexity_level="medium",
        auto_discover=True,
    )
    assert "categories" in res
    assert res["is_ready"] is True
    assert len(res["categories"]) > 0
