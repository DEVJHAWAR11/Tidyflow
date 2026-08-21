from pathlib import Path
from src.applier import apply_decisions, build_auto_approval_decisions
from src.models import ClassificationResult, FileRecord, ReviewDecision
from src.utils import compute_sha256


def test_auto_approval_decisions():
    rec = FileRecord(
        file_id="1",
        abs_path=Path("doc.pdf"),
        rel_path=Path("doc.pdf"),
        filename="doc.pdf",
        extension=".pdf",
        file_size_bytes=100,
        classification=ClassificationResult(
            category="Finance/Invoices",
            confidence=0.95,
            action="copy_to_organized",
        ),
    )
    decisions = build_auto_approval_decisions([rec], confidence_threshold=0.85)
    assert len(decisions) == 1
    assert decisions[0].approved is True
    assert decisions[0].original_category == "Finance/Invoices"


def test_apply_decisions_copy(tmp_path):
    src_file = tmp_path / "invoice.pdf"
    src_file.write_text("dummy invoice content")
    sha = compute_sha256(src_file)

    rec = FileRecord(
        file_id="1",
        abs_path=src_file,
        rel_path=Path("invoice.pdf"),
        filename="invoice.pdf",
        extension=".pdf",
        file_size_bytes=src_file.stat().st_size,
        sha256=sha,
    )

    dec = ReviewDecision(
        file_id="1",
        approved=True,
        original_category="Finance/Invoices",
        original_confidence=0.95,
    )

    out_dir = tmp_path / "organized"

    # Dry run
    manifest_dry = apply_decisions([dec], [rec], out_dir, dry_run=True)
    assert len(manifest_dry) == 1
    assert not (out_dir / "Finance/Invoices/invoice.pdf").exists()

    # Real run
    manifest_real = apply_decisions([dec], [rec], out_dir, dry_run=False)
    assert len(manifest_real) == 1
    dest_path = out_dir / "Finance/Invoices/invoice.pdf"
    assert dest_path.exists()
    assert src_file.exists()  # Original not deleted in copy mode
