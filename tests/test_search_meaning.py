"""Search by meaning, as merged into keyword search by DatabaseManager.search_page."""

import sqlite3

import pytest

from src.database import DatabaseManager


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / "s.db")
    manager = DatabaseManager(db_path=path)
    conn = sqlite3.connect(path)
    conn.executemany(
        "INSERT INTO files (id, path, extracted_text, category, extension, status) VALUES (?, ?, ?, ?, ?, ?)",
        [
            (1, "/docs/rent receipt.pdf", "rent paid for march", "Finance", ".pdf", "indexed"),
            (2, "/docs/tenancy.pdf", "the tenant shall pay a monthly sum for the premises", "Housing", ".pdf", "indexed"),
            (3, "/docs/landlord.txt", "about the security deposit for the flat", "Housing", ".txt", "indexed"),
            (4, "/docs/skipped.txt", "tenant deposit", "Housing", ".txt", "skipped"),
            (5, "/pics/flat.jpg", "", "Photos", ".jpg", "indexed"),
        ],
    )
    conn.commit()
    conn.close()
    return manager


@pytest.mark.asyncio
async def test_without_meaning_nothing_changes(db):
    page = await db.search_page("rent")
    assert [r["id"] for r in page["results"]] == [1]
    assert page["meaning_total"] == 0
    assert page["results"][0]["match"] == "words"


@pytest.mark.asyncio
async def test_meaning_hits_come_after_word_hits(db):
    page = await db.search_page("rent", meaning=[(2, 0.8), (1, 0.79), (3, 0.7)])
    assert [r["id"] for r in page["results"]] == [1, 2, 3]
    assert [r["match"] for r in page["results"]] == ["words", "meaning", "meaning"]
    assert page["total"] == 3 and page["meaning_total"] == 2
    tenancy = page["results"][1]
    assert tenancy["meaning_score"] == pytest.approx(0.8)
    assert tenancy["snippet"].startswith("the tenant shall pay")
    assert "<mark>" not in tenancy["snippet"]


@pytest.mark.asyncio
async def test_meaning_only_search_finds_files_without_the_words(db):
    page = await db.search_page("lease agreement", meaning=[(2, 0.8)])
    assert [r["id"] for r in page["results"]] == [2]
    assert page["results"][0]["match"] == "meaning"
    assert page["total"] == page["meaning_total"] == 1


@pytest.mark.asyncio
async def test_meaning_hits_skip_unsearchable_and_missing_rows(db):
    page = await db.search_page("rent", meaning=[(4, 0.9), (999, 0.9), (2, 0.8)])
    assert [r["id"] for r in page["results"]] == [1, 2]


@pytest.mark.asyncio
async def test_filters_facets_and_paging_include_meaning_hits(db):
    meaning = [(2, 0.8), (3, 0.7)]
    page = await db.search_page("rent", meaning=meaning)
    assert page["facets"]["categories"] == {"Finance": 1, "Housing": 2}
    housing = await db.search_page("rent", meaning=meaning, category="Housing")
    assert [r["id"] for r in housing["results"]] == [2, 3]
    assert housing["meaning_total"] == 2
    second = await db.search_page("rent", meaning=meaning, limit=1, offset=1)
    assert [r["id"] for r in second["results"]] == [2]
    assert second["total"] == 3


@pytest.mark.asyncio
async def test_select_all_leaves_meaning_hits_out(db):
    ids = await db.search_page("rent", meaning=[(2, 0.8), (3, 0.7)], ids_only=True)
    assert ids == {"ids": [1], "total": 1}


@pytest.mark.asyncio
async def test_meaning_hits_take_the_place_of_a_spelling_guess(db):
    guessed = await db.search_page("rentt")
    assert guessed["corrected"] == "rent"
    page = await db.search_page("rentt", meaning=[(2, 0.8)])
    assert page["corrected"] is None
    assert [r["id"] for r in page["results"]] == [2]
