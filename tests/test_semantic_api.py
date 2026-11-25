"""The /semantic routes and how /search uses search by meaning."""

import pytest
from fastapi.testclient import TestClient

import src.api as api
from src.database import DatabaseManager
from src.semantic.service import SemanticService

from test_library import _record


@pytest.fixture
def setup(tmp_path, monkeypatch):
    home = tmp_path / "Docs"
    home.mkdir()
    for name, body in [("rent-receipt.pdf", "rent paid for march"), ("tenancy.pdf", "the tenant shall pay monthly")]:
        (home / name).write_text(body)
    db = DatabaseManager(db_path=tmp_path / "tidyflow.db")
    db.sync_index_records([_record(p, "Unknown") for p in sorted(home.iterdir())])
    service = SemanticService(db.db_path)
    monkeypatch.setattr(api, "db", db)
    monkeypatch.setattr(api, "semantic", service)
    return db, service, home


def _ids(db):
    import sqlite3

    with sqlite3.connect(db.db_path) as conn:
        return {name.rsplit("/", 1)[-1]: i for i, name in conn.execute("SELECT id, path FROM files")}


def test_status_starts_off(setup):
    client = TestClient(api.app)
    st = client.get("/semantic/status").json()
    assert st["enabled"] is False and st["phase"] == "off"
    assert {m["key"] for m in st["models"]} == {"q8_0", "bf16"}
    assert all(not m["downloaded"] for m in st["models"])


def test_unknown_model_is_refused(setup):
    client = TestClient(api.app)
    assert client.post("/semantic/enable", json={"model": "q2"}).status_code == 422


def test_search_says_meaning_is_off(setup):
    client = TestClient(api.app)
    res = client.get("/search", params={"q": "rent"}).json()
    assert res["meaning"] == "off" and res["meaning_total"] == 0
    assert [r["match"] for r in res["results"]] == ["words"]


def test_search_merges_meaning_hits(setup, monkeypatch):
    db, service, _ = setup
    ids = _ids(db)

    async def lookup(q):
        return [(ids["tenancy.pdf"], 0.81)], "ok"

    monkeypatch.setattr(service, "lookup", lookup)
    client = TestClient(api.app)
    res = client.get("/search", params={"q": "rent"}).json()
    assert [r["name"] for r in res["results"]] == ["rent-receipt.pdf", "tenancy.pdf"]
    assert [r["match"] for r in res["results"]] == ["words", "meaning"]
    assert res["meaning"] == "ok" and res["meaning_total"] == 1 and res["total"] == 2
    # "Add all to a folder" only takes the files that contain the words.
    assert client.get("/search/ids", params={"q": "rent"}).json()["total"] == 1


def test_search_still_answers_while_the_engine_warms_up(setup, monkeypatch):
    _, service, _ = setup

    async def lookup(q):
        return None, "warming"

    monkeypatch.setattr(service, "lookup", lookup)
    res = TestClient(api.app).get("/search", params={"q": "rent"}).json()
    assert res["meaning"] == "warming" and res["total"] == 1


def test_disable_and_remove(setup):
    client = TestClient(api.app)
    assert client.post("/semantic/disable").json()["enabled"] is False
    body = client.delete("/semantic").json()
    assert body["enabled"] is False and body["freed_bytes"] == 0
    assert client.post("/semantic/warm").json() == {"phase": "off"}


def test_meaning_count_drops_files_gone_from_disk(setup, monkeypatch):
    db, service, home = setup
    ids = _ids(db)
    (home / "tenancy.pdf").unlink()

    async def lookup(q):
        return [(ids["tenancy.pdf"], 0.81)], "ok"

    monkeypatch.setattr(service, "lookup", lookup)
    res = TestClient(api.app).get("/search", params={"q": "rent"}).json()
    assert [r["name"] for r in res["results"]] == ["rent-receipt.pdf"]
    assert res["total"] == 1 and res["meaning_total"] == 0
