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
        assert "<b>Acme</b>" in results[0]["snippet"]


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
