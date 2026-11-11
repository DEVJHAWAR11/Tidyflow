from pathlib import Path

import fitz
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import src.api as api
import src.previews as previews
from src.models import FileRecord
from src.utils import compute_sha256


@pytest.fixture
def cache(tmp_path, monkeypatch):
    monkeypatch.setattr(previews, "preview_cache_dir", lambda: tmp_path / "previews")
    return tmp_path / "previews"


def _pdf(path: Path) -> Path:
    doc = fitz.open()
    doc.new_page(width=595, height=842).insert_text((72, 72), "Invoice 4412")
    doc.save(path)
    return path


def test_pdfs_and_images_render_sharp_without_quicklook(tmp_path, cache):
    pdf = _pdf(tmp_path / "invoice.pdf")
    out = previews.get_preview(pdf, compute_sha256(pdf), 640, use_quicklook=False)
    assert out is not None and out.suffix == ".webp"
    with Image.open(out) as im:
        assert max(im.size) == 640  # a whole page, long side at the asked size, not a cropped square

    big = tmp_path / "photo.jpg"
    Image.new("RGB", (3000, 2000), (200, 30, 30)).save(big)
    out = previews.get_preview(big, compute_sha256(big), 700, use_quicklook=False)
    with Image.open(out) as im:
        assert im.size == (640, 427)  # snapped to the nearest standard size, aspect kept


def test_previews_are_cached_and_unpreviewable_files_are_remembered(tmp_path, cache, monkeypatch):
    pdf = _pdf(tmp_path / "a.pdf")
    sha = compute_sha256(pdf)
    first = previews.get_preview(pdf, sha, 640, use_quicklook=False)
    monkeypatch.setattr(previews, "_render_locally", lambda *a: pytest.fail("should come from the cache"))
    assert previews.get_preview(pdf, sha, 640, use_quicklook=False) == first

    blob = tmp_path / "x.torrent"
    blob.write_bytes(b"d8:announce")
    calls = []
    monkeypatch.setattr(previews, "_render_locally", lambda *a: calls.append(1))
    assert previews.get_preview(blob, compute_sha256(blob), 640, use_quicklook=False) is None
    assert previews.get_preview(blob, compute_sha256(blob), 640, use_quicklook=False) is None
    assert len(calls) == 1  # the second ask doesn't try again


def test_preview_endpoint_serves_only_files_from_the_current_results(tmp_path, cache, monkeypatch):
    pdf = _pdf(tmp_path / "doc.pdf")
    rec = FileRecord(file_id="abc123", abs_path=pdf, rel_path=Path("doc.pdf"), filename="doc.pdf",
                     extension=".pdf", file_size_bytes=pdf.stat().st_size, sha256=compute_sha256(pdf))
    monkeypatch.setitem(api.latest_pipeline_data, "records", [rec])
    monkeypatch.setattr(previews.sys, "platform", "linux")  # local rendering, same on every machine
    client = TestClient(api.app)

    r = client.get("/preview/abc123?size=320")
    assert r.status_code == 200 and r.headers["content-type"] == "image/webp"
    assert "max-age" in r.headers["cache-control"]
    assert client.get("/preview/not-a-file").status_code == 404
