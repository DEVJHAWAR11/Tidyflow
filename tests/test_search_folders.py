"""Search by TidyFlow folder: the folder filter, the folder counts, and each result's folders."""

import sqlite3

import pytest
from fastapi.testclient import TestClient

import src.api as api
from src import library, library_ops
from src.database import DatabaseManager

from test_library import _record


@pytest.fixture
def db(tmp_path):
    home = tmp_path / "Downloads"
    home.mkdir()
    for name, body in [
        ("bescom-bill.pdf", "electricity bill october"),
        ("airtel-bill.pdf", "airtel postpaid bill"),
        ("water-bill.pdf", "rent receipt bill paid"),
        ("dbms-notes.txt", "dbms notes on transactions"),
    ]:
        (home / name).write_text(body)
    manager = DatabaseManager(db_path=tmp_path / "tidyflow.db")
    manager.sync_index_records([_record(p, "Unknown") for p in sorted(home.iterdir())])
    conn = sqlite3.connect(manager.db_path)
    library.sort_into_folders(conn, [
        (str(home / "bescom-bill.pdf"), "Finance/Bills"),
        (str(home / "airtel-bill.pdf"), "Finance"),
        (str(home / "dbms-notes.txt"), "College"),
    ])
    conn.commit()
    conn.close()
    return manager


def _folder_id(db, name: str) -> int:
    with sqlite3.connect(db.db_path) as conn:
        return next(f["id"] for f in library.folder_rows(conn) if f["name"] == name)


async def test_folder_counts_and_result_folders(db):
    page = await db.search_page("bill")
    assert page["total"] == 3
    facets = page["facets"]
    assert [(f["name"], f["count"]) for f in facets["folders"]] == [("Finance", 2)]
    assert facets["unsorted"] == 1
    by_name = {r["path"].rsplit("/", 1)[-1]: r for r in page["results"]}
    assert by_name["bescom-bill.pdf"]["folders"] == [
        {"id": _folder_id(db, "Bills"), "name": "Bills", "is_real": False, "label": "Finance / Bills"}
    ]
    assert by_name["water-bill.pdf"]["folders"] == []


async def test_folder_filter_with_and_without_subfolders(db):
    finance = _folder_id(db, "Finance")
    names = lambda page: sorted(r["path"].rsplit("/", 1)[-1] for r in page["results"])

    assert names(await db.search_page("bill", folder=finance)) == ["airtel-bill.pdf", "bescom-bill.pdf"]
    assert names(await db.search_page("bill", folder=finance, include_subfolders=False)) == ["airtel-bill.pdf"]
    assert names(await db.search_page("bill", folder="unsorted")) == ["water-bill.pdf"]
    # The counts don't change with the filter, so the other chips stay usable.
    assert (await db.search_page("bill", folder="unsorted"))["facets"]["unsorted"] == 1


async def test_ids_only_returns_every_match(db):
    finance = _folder_id(db, "Finance")
    everything = await db.search_page("bill", ids_only=True)
    assert everything["total"] == 3 and len(everything["ids"]) == 3
    assert len((await db.search_page("bill", folder=finance, ids_only=True))["ids"]) == 2


def test_search_routes_take_the_folder_filter(db, monkeypatch):
    monkeypatch.setattr(api, "db", db)
    client = TestClient(api.app)
    finance = _folder_id(db, "Finance")

    res = client.get("/search", params={"q": "bill", "folder": str(finance)}).json()
    assert res["total"] == 2
    assert all(r["lives_in"].endswith("Downloads") for r in res["results"])
    assert client.get("/search", params={"q": "bill", "folder": "nope"}).status_code == 422

    ids = client.get("/search/ids", params={"q": "bill", "folder": "unsorted"}).json()["ids"]
    with sqlite3.connect(db.db_path) as conn:
        library_ops.paste(conn, ids, finance, op="copy")
        conn.commit()
    assert client.get("/search", params={"q": "bill", "folder": "unsorted"}).json()["total"] == 0
