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


def test_move_mode_moves_each_duplicate_under_its_own_name(tmp_path):
    """Identical files used to share one ID, so the same file was copied twice and its twin stayed behind."""
    from src.config import TidyConfig
    from src.scanner import scan_directory

    src_dir = tmp_path / "in"
    src_dir.mkdir()
    (src_dir / "invoice.txt").write_text("INVOICE #1 amount due $10")
    (src_dir / "invoice (1).txt").write_text("INVOICE #1 amount due $10")
    (src_dir / "empty_a.txt").write_text("")
    (src_dir / "empty_b.txt").write_text("")

    records = scan_directory(TidyConfig(input_dir=src_dir))
    assert len({r.file_id for r in records}) == 4

    decisions = [
        ReviewDecision(file_id=r.file_id, approved=True, override_category="Finance")
        for r in records
    ]
    out_dir = tmp_path / "out"
    manifest = apply_decisions(decisions, records, out_dir, dry_run=False, move_mode=True)

    assert len(manifest) == 4
    assert sorted(p.name for p in (out_dir / "Finance").iterdir()) == [
        "empty_a.txt", "empty_b.txt", "invoice (1).txt", "invoice.txt",
    ]
    assert list(src_dir.iterdir()) == []


def test_flattened_name_clashes_get_readable_names_and_reruns_add_nothing(tmp_path):
    from src.config import TidyConfig
    from src.scanner import scan_directory

    src_dir = tmp_path / "in"
    for folder, text in [("aryan ppt", "full size"), ("compressedImages", "compressed"), ("", "top level"), ("old", "older")]:
        (src_dir / folder).mkdir(parents=True, exist_ok=True)
        (src_dir / folder / "IMG-0025.jpg").write_text(text)

    records = scan_directory(TidyConfig(input_dir=src_dir))
    decisions = [ReviewDecision(file_id=r.file_id, approved=True, override_category="Images") for r in records]
    out_dir = tmp_path / "out"

    manifest = apply_decisions(decisions, records, out_dir, dry_run=False)
    names = sorted(p.name for p in (out_dir / "Images").iterdir())
    assert len(manifest) == 4
    # The first keeps its name; the rest are labelled with their folder, never a hash.
    assert names == ["IMG-0025 (aryan ppt).jpg", "IMG-0025 (compressedImages).jpg", "IMG-0025 (old).jpg", "IMG-0025.jpg"]

    # Organizing the same files again recognises every copy and adds nothing.
    assert apply_decisions(decisions, records, out_dir, dry_run=False) == []
    assert len(list((out_dir / "Images").iterdir())) == 4


def test_top_level_clash_gets_a_number(tmp_path):
    from src.utils import choose_destination

    dest = tmp_path / "Images"
    dest.mkdir()
    (dest / "photo.jpg").write_text("one")
    path, already = choose_destination(dest, "photo.jpg", "not-the-same-hash")
    assert path.name == "photo (2).jpg" and not already
