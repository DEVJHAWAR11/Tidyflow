"""Organizing real files through the API: every copy is exact and the originals are never touched."""

from __future__ import annotations

import csv
from pathlib import Path

import fitz
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import src.api as api
from src.config import TidyConfig
from src.database import DatabaseManager
from src.scanner import scan_directory
from src.utils import compute_sha256

# Where each file of the inbox is organized to.
CATEGORY = {"invoice_1024.pdf": "Finance", "photo.png": "Photos", "trip/photo.png": "Photos", "notes.txt": "Notes"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "db", DatabaseManager(db_path=tmp_path / "tidyflow.db"))
    monkeypatch.setattr(api, "latest_pipeline_data", {})
    monkeypatch.setattr(api, "work_data_dir", lambda: tmp_path / "work")
    return TestClient(api.app)


def _make_inbox(root: Path) -> None:
    """A small folder of real files: a PDF, a text note, and two different photos with one name."""
    (root / "trip").mkdir(parents=True)
    doc = fitz.open()
    doc.new_page().insert_text(fitz.Point(72, 72), "ACME INVOICE #1024. Total due: $1,250.00")
    doc.save(str(root / "invoice_1024.pdf"))
    doc.close()
    Image.new("RGB", (64, 48), (200, 30, 30)).save(root / "photo.png")
    Image.new("RGB", (64, 48), (30, 30, 200)).save(root / "trip" / "photo.png")
    (root / "notes.txt").write_text("Call the landlord about the deposit.\n", encoding="utf-8")


def _snapshot(root: Path) -> dict[str, tuple | None]:
    """Everything under ``root``: each file's hash, size and modification time; folders as None."""
    return {
        p.relative_to(root).as_posix(): (compute_sha256(p), p.stat().st_size, p.stat().st_mtime_ns) if p.is_file() else None
        for p in sorted(root.rglob("*"))
    }


def _hashes(snapshot: dict) -> list[str]:
    return sorted(v[0] for v in snapshot.values() if v)


def _scan(inbox: Path) -> list[dict]:
    """Scan the inbox as the app does and return the decisions the review screen would send."""
    records = scan_directory(TidyConfig(input_dir=inbox))
    assert len([r for r in records if not r.skipped]) == len(CATEGORY)
    api.db.sync_index_records(records)
    api.latest_pipeline_data.update(records=records, input_dir=str(inbox), output_dir="", summary=None, categories=[])
    return [
        {"file_id": r.file_id, "override_category": CATEGORY[Path(r.rel_path).as_posix()]}
        for r in records if not r.skipped
    ]


def test_copying_leaves_every_original_exactly_as_it_was(client, tmp_path):
    inbox, out = tmp_path / "Inbox", tmp_path / "Organized"
    _make_inbox(inbox)
    before = _snapshot(inbox)
    decisions = _scan(inbox)

    res = client.post("/pipeline/apply-direct", json={"mode": "copy", "output_dir": str(out), "decisions": decisions}).json()

    assert res["action"] == "copied" and res["applied_count"] == 4
    # The originals: the same files and folders, the same bytes, the same modification times.
    assert _snapshot(inbox) == before
    # The copies: one per original, byte for byte, each where the manifest says.
    copies = _snapshot(out)
    assert _hashes(copies) == _hashes(before)
    assert sorted(Path(k).parent.as_posix() for k, v in copies.items() if v) == ["Finance", "Notes", "Photos", "Photos"]
    for entry in res["manifest"]:
        dest = Path(entry["destination_path"])
        assert out.resolve() in dest.parents and entry["operation"] == "copy"
        assert compute_sha256(dest) == compute_sha256(entry["original_path"]) == entry["sha256"]
    # The audit copy of the manifest lists the same four files.
    with open(tmp_path / "work" / "manifests" / "copy_manifest.csv", encoding="utf-8-sig", newline="") as f:
        audited = sorted(row["destination_path"] for row in csv.DictReader(f))
    assert audited == sorted(e["destination_path"] for e in res["manifest"])

    # Undo takes away exactly the copies, and the folder made for them, and still leaves the originals be.
    assert client.post("/pipeline/undo-last").json() == {"status": "success", "restored": 4, "skipped": 0}
    assert not out.exists()
    assert _snapshot(inbox) == before


def test_moving_then_undoing_puts_every_original_back_byte_for_byte(client, tmp_path):
    inbox, out = tmp_path / "Inbox", tmp_path / "Organized"
    _make_inbox(inbox)
    before = _snapshot(inbox)
    decisions = _scan(inbox)

    res = client.post("/pipeline/apply-direct", json={"mode": "move", "output_dir": str(out), "decisions": decisions}).json()

    assert res["action"] == "moved" and res["applied_count"] == 4
    assert not [p for p in inbox.rglob("*") if p.is_file()]
    assert _hashes(_snapshot(out)) == _hashes(before)

    assert client.post("/pipeline/undo-last").json() == {"status": "success", "restored": 4, "skipped": 0}
    assert _snapshot(inbox) == before
    assert not out.exists()
