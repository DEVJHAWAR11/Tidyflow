import pytest
import tempfile
from pathlib import Path
from src.database import DatabaseManager

@pytest.mark.asyncio
async def test_search():
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
