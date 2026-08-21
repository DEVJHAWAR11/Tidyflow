import tempfile
from pathlib import Path
import fitz
from src.config import TidyConfig
from src.main_loop import run_pipeline


def test_end_to_end_pipeline_inventory():
    with tempfile.TemporaryDirectory() as temp_dir:
        input_dir = Path(temp_dir) / "input"
        output_dir = Path(temp_dir) / "output"
        input_dir.mkdir()

        # 1. Create a PDF invoice
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text(fitz.Point(50, 50), "ACME INVOICE #1024. Due Date: 2026-09-01. Total Amount: $1,250.00.")
        doc.save(str(input_dir / "invoice_1024.pdf"))
        doc.close()

        # 2. Create a source code file
        code_file = input_dir / "script.py"
        code_file.write_text("import sys\n\ndef main():\n    print('test')\n")

        # 3. Run pipeline
        cfg = TidyConfig(
            input_dir=input_dir,
            output_dir=output_dir,
            staging_dir=output_dir / "Staging",
        )

        records, summary = run_pipeline(
            cfg,
            use_llm=False,
            auto_apply=True,
            dry_run=False,
        )

        assert summary.total_scanned == 2
        assert summary.text_extracted >= 1
        assert (output_dir / "file_inventory.csv").exists()
        assert (output_dir / "review_report.html").exists()
        assert (output_dir / "file_records.jsonl").exists()
