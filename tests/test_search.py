import pytest
import tempfile
from pathlib import Path
from src.database import DatabaseManager
from src.models import FileRecord, ClassificationResult


@pytest.mark.asyncio
async def test_search_basic():
    with tempfile.TemporaryDirectory() as temp_dir:
        db_path = str(Path(temp_dir) / "test_search.db")
        db = DatabaseManager(db_path=db_path)
        await db.start()

        # Insert a file with some text
        await db.execute_write(
            "INSERT INTO files (path, extracted_text, category) VALUES (?, ?, ?)",
            ("invoice.pdf", "Acme Corp total amount $500", "Invoices")
        )

        # Also another file
        await db.execute_write(
            "INSERT INTO files (path, extracted_text, category) VALUES (?, ?, ?)",
            ("receipt.png", "Walmart groceries $40", "Receipts")
        )

        # Flush DB writes
        await db.stop()

        # Re-initialize to do the search
        db2 = DatabaseManager(db_path=db_path)

        results = await db2.search("Acme")

        assert len(results) == 1
        assert results[0]["path"] == "invoice.pdf"
        assert "<mark>Acme</mark>" in results[0]["snippet"]


@pytest.mark.asyncio
async def test_search_paths_and_special_characters():
    with tempfile.TemporaryDirectory() as temp_dir:
        db_path = str(Path(temp_dir) / "test_search_special.db")
        db = DatabaseManager(db_path=db_path)

        # Use sync_index_records
        records = [
            FileRecord(
                file_id="abc12345",
                abs_path=Path("/Users/arpan/test files/financial/tax-return-2024.pdf"),
                rel_path="financial/tax-return-2024.pdf",
                filename="tax-return-2024.pdf",
                extension=".pdf",
                file_size_bytes=1024,
                sha256="abc12345sha",
                extracted_text_normalized="Tax Return 1040 for Tax Year 2024. Total taxable income $75,000.",
                classification=ClassificationResult(
                    category="Taxes",
                    confidence=0.98,
                    suggested_filename="tax-return-2024.pdf",
                    action="copy_to_organized",
                    source="rule",
                ),
            ),
            FileRecord(
                file_id="def67890",
                abs_path=Path("/Users/arpan/test files/react-app-source.zip"),
                rel_path="react-app-source.zip",
                filename="react-app-source.zip",
                extension=".zip",
                file_size_bytes=2048,
                sha256="def67890sha",
                classification=ClassificationResult(
                    category="Archives",
                    confidence=1.0,
                    suggested_filename="react-app-source.zip",
                    action="copy_to_organized",
                    source="extension_rule",
                ),
            ),
        ]

        count = db.sync_index_records(records)
        assert count == 2

        # 1. Search with full path containing slashes
        res_path = await db.search("/Users/arpan/test files/financial")
        assert len(res_path) >= 1
        assert res_path[0]["file_id"] == "abc12345"

        # 2. Search with hyphen and numbers
        res_hyphen = await db.search("tax-return-2024")
        assert len(res_hyphen) >= 1
        assert "tax-return-2024.pdf" in res_hyphen[0]["path"]

        # 3. Search with prefix
        res_prefix = await db.search("taxab")
        assert len(res_prefix) >= 1

        # 4. Search archive without text (matches on path/category)
        res_zip = await db.search("react-app")
        assert len(res_zip) >= 1
        assert res_zip[0]["file_id"] == "def67890"

        # 5. Empty search
        res_empty = await db.search("   ")
        assert res_empty == []


def _rec(file_id, path, text="", category="Notes", new_name=""):
    return FileRecord(
        file_id=file_id,
        abs_path=Path(path),
        rel_path=Path(path).name,
        filename=Path(path).name,
        extension=Path(path).suffix,
        file_size_bytes=10,
        sha256=file_id + "sha",
        extracted_text_normalized=text,
        classification=ClassificationResult(
            category=category, confidence=0.9, suggested_filename=new_name or Path(path).name,
            action="copy_to_organized", source="llm",
        ),
    )


@pytest.fixture
def library(tmp_path):
    db = DatabaseManager(db_path=str(tmp_path / "lib.db"))
    db.sync_index_records([
        _rec("a1", "/in/scan_0412.pdf", "Invoice 4412 from Acme Corp, amount due 1250", "Finance", "acme-invoice-4412.pdf"),
        _rec("a2", "/in/IMG_2231.png", "invoice dashboard total paid", "Media"),
        _rec("a3", "/in/lecture3.pdf", "binary trees and heaps <script>alert(1)</script>", "Notes", "dsa-trees-heaps.pdf"),
        _rec("a4", "/in/budget.xlsx", "", "Finance"),
    ])
    return db


@pytest.mark.asyncio
async def test_search_finds_a_file_by_the_name_it_was_given(library):
    page = await library.search_page("dsa trees")
    assert [r["file_id"] for r in page["results"]] == ["a3"]
    assert page["total"] == 1 and page["corrected"] is None


@pytest.mark.asyncio
async def test_a_name_match_ranks_above_a_match_in_the_text(library):
    page = await library.search_page("invoice")
    assert [r["file_id"] for r in page["results"]] == ["a1", "a2"]


@pytest.mark.asyncio
async def test_search_matches_the_middle_of_a_name(library):
    page = await library.search_page("udget")
    assert [r["file_id"] for r in page["results"]] == ["a4"]


@pytest.mark.asyncio
async def test_a_misspelt_search_is_tried_again_with_the_closest_word(library):
    page = await library.search_page("invoce")
    assert page["corrected"] == "invoice"
    assert {r["file_id"] for r in page["results"]} == {"a1", "a2"}
    # A word that is nowhere near anything stays empty.
    assert (await library.search_page("zzzqqq"))["total"] == 0


@pytest.mark.asyncio
async def test_snippets_are_escaped_and_mark_the_match(library):
    row = (await library.search_page("heaps"))["results"][0]
    assert "<mark>heaps</mark>" in row["snippet"]
    assert "<script>" not in row["snippet"] and "&lt;script&gt;" in row["snippet"]
    assert "extracted_text" not in row and row["has_text"] is True


@pytest.mark.asyncio
async def test_filters_paging_and_counts(library):
    page = await library.search_page("in", limit=2)  # every path starts with /in/
    assert page["total"] == 4 and len(page["results"]) == 2
    assert page["facets"]["categories"] == {"Finance": 2, "Media": 1, "Notes": 1}
    assert page["facets"]["kinds"] == {"documents": 2, "images": 1, "sheets": 1}
    assert page["facets"]["unorganized"] == 4

    rest = await library.search_page("in", limit=2, offset=2)
    assert not {r["id"] for r in rest["results"]} & {r["id"] for r in page["results"]}

    finance = await library.search_page("in", category="Finance", kind="sheets")
    assert [r["file_id"] for r in finance["results"]] == ["a4"]
    assert finance["facets"]["categories"]["Notes"] == 1  # counts ignore the filters

    assert (await library.search_page("in", organized=True))["total"] == 0


def test_an_index_from_an_older_version_is_rebuilt(tmp_path):
    import sqlite3

    path = str(tmp_path / "old.db")
    db = DatabaseManager(db_path=path)
    db.sync_index_records([_rec("a1", "/in/scan.pdf", "hello", "Notes", "greeting-letter.pdf")])
    conn = sqlite3.connect(path)
    for trig in ("files_ai", "files_ad", "files_au"):
        conn.execute(f"DROP TRIGGER {trig}")
    conn.execute("DROP TABLE files_fts_vocab")
    conn.execute("DROP TABLE files_fts")
    conn.execute("CREATE VIRTUAL TABLE files_fts USING fts5(path, extracted_text, category, content='files', content_rowid='id')")
    conn.commit()
    conn.close()

    db = DatabaseManager(db_path=path)  # opening it again upgrades the index
    import asyncio
    page = asyncio.run(db.search_page("greeting"))
    assert [r["file_id"] for r in page["results"]] == ["a1"]
    assert asyncio.run(db.search_stats()) == {"files": 1, "with_text": 1, "categories": [{"name": "Notes", "count": 1}]}
