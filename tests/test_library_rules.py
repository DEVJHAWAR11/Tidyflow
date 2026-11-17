"""Rules TidyFlow learns from where files are put, and Finder tags for TidyFlow folders."""

import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import src.api as api
from src import library, library_ops, library_rules, library_tags
from src.database import DatabaseManager
from src.rules import RuleEngine
from src.config import CategoryConfig

from test_library import _record

NAMES = [
    "airtel-bill-oct.pdf", "airtel-bill-nov.pdf", "airtel-receipt.pdf",
    "bescom-bill.pdf", "dbms-notes.txt", "resume-2026.pdf",
]


@pytest.fixture
def home(tmp_path):
    root = tmp_path / "Downloads"
    root.mkdir()
    for name in NAMES:
        (root / name).write_text(name)
    return root


@pytest.fixture
def db(tmp_path, home):
    manager = DatabaseManager(db_path=tmp_path / "tidyflow.db")
    manager.sync_index_records([_record(home / n, "Unknown") for n in NAMES])
    with sqlite3.connect(manager.db_path) as conn:
        library.sort_into_folders(conn, [
            (str(home / "airtel-bill-oct.pdf"), "Finance"),
            (str(home / "airtel-bill-nov.pdf"), "Finance"),
            (str(home / "bescom-bill.pdf"), "Finance/Bills"),
            (str(home / "dbms-notes.txt"), "College"),
        ])
    return manager


@pytest.fixture
def conn(db):
    c = sqlite3.connect(db.db_path)
    yield c
    c.close()


def _id(conn, table: str, column: str, value: str) -> int:
    return conn.execute(f"SELECT id FROM {table} WHERE {column} = ?", (value,)).fetchone()[0]


def _file(conn, home, name):
    return _id(conn, "files", "path", str(home / name))


def test_file_name_words_skip_dates_and_filler():
    assert library_rules.words("Airtel-Bill_Oct 2026 (copy).pdf") == {"airtel", "bill"}
    assert library_rules.words("IMG_2041.jpg") == set()


def test_two_agreeing_moves_offer_a_rule_and_undo_takes_it_back(conn, home):
    finance, bills = _id(conn, "folders", "name", "Finance"), _id(conn, "folders", "name", "Bills")
    oct_, nov = _file(conn, home, "airtel-bill-oct.pdf"), _file(conn, home, "airtel-bill-nov.pdf")

    library_ops.paste(conn, [oct_], bills, op="cut", from_folder_id=finance)
    assert library_rules.suggestions(conn) == []  # one move isn't a pattern
    library_ops.paste(conn, [nov], bills, op="cut", from_folder_id=finance)
    offered = library_rules.suggestions(conn)
    # Both words are in both moved files; "bill" is also in a file that was already there, so it leads.
    assert [(s["contains"], s["folder"], s["corrections"], s["matching"]) for s in offered] == [
        ("bill", "Finance/Bills", 2, 3),
        ("airtel", "Finance/Bills", 2, 2),
    ]

    library_ops.undo_last(conn)  # the second move goes back
    assert library_rules.suggestions(conn) == []


def test_a_word_found_in_an_unrelated_folder_is_not_offered(conn, home):
    finance, college = _id(conn, "folders", "name", "Finance"), _id(conn, "folders", "name", "College")
    bills = _id(conn, "folders", "name", "Bills")
    receipt = _file(conn, home, "airtel-receipt.pdf")
    library_ops.paste(conn, [receipt], bills, op="copy")  # adding a copy teaches nothing
    for name in ("airtel-bill-oct.pdf", "airtel-bill-nov.pdf"):
        library_ops.paste(conn, [_file(conn, home, name)], college, op="cut", from_folder_id=finance)
    # Both words are in Bills too, which has nothing to do with College.
    assert library_rules.suggestions(conn) == []

    library_ops.remove_from_folder(conn, [receipt], bills)
    assert [s["contains"] for s in library_rules.suggestions(conn)] == ["airtel"]  # "bill" still clashes


def test_accepted_rule_suggests_the_folder_and_can_be_forgotten(conn, home):
    bills = _id(conn, "folders", "name", "Bills")
    library_rules.add_rule(conn, bills, "Airtel")
    assert library_rules.rule_dicts(conn) == [{"category": "Finance/Bills", "contains": "airtel", "learned": True}]
    with pytest.raises(library_ops.LibraryError):
        library_rules.add_rule(conn, bills, "airtel")

    engine = RuleEngine(
        rules_file="no-such-rules.yaml",
        categories={"finance/bills": CategoryConfig(description="x"), "College": CategoryConfig(description="y")},
        extra_rules=library_rules.rule_dicts(conn),
    )
    result = engine.evaluate_record(_record(home / "airtel-receipt.pdf", "Unknown"))
    assert result.category == "finance/bills" and "airtel" in result.reason

    # The rule follows its folder when the folder is renamed.
    library_ops.update_folder(conn, bills, name="Phone and power")
    assert library_rules.rules(conn)[0]["folder"] == "Finance/Phone and power"

    rule_id = library_rules.rules(conn)[0]["id"]
    library_rules.remove_rule(conn, rule_id)
    assert library_rules.rules(conn) == []
    assert library_ops.undo_last(conn)["kind"] == "remove_rule"
    assert [r["contains"] for r in library_rules.rules(conn)] == ["airtel"]


@pytest.fixture
def client(db, monkeypatch):
    monkeypatch.setattr(api, "db", db)
    monkeypatch.setattr(api, "latest_pipeline_data", {})
    return TestClient(api.app)


def test_choices_on_the_review_and_new_files_screens_are_corrections(client, db, home):
    records = [_record(home / "airtel-receipt.pdf", "Finance"), _record(home / "resume-2026.pdf", "Career")]
    db.sync_index_records(records)
    api.latest_pipeline_data.update(records=records, input_dir=str(home), output_dir="", summary=None, categories=[])
    client.post("/pipeline/apply-direct", json={"mode": "library", "decisions": [
        {"file_id": "id-airtel-receipt.pdf", "override_category": "Finance/Bills"},
        {"file_id": "id-resume-2026.pdf"},  # kept as suggested: not a correction
    ]})
    with sqlite3.connect(db.db_path) as conn:
        bills = _id(conn, "folders", "name", "Bills")
        nov = _file(conn, home, "airtel-bill-nov.pdf")
        assert conn.execute("SELECT COUNT(*) FROM corrections").fetchone()[0] == 1

    res = client.post("/library/new/sort", json={"items": [
        {"id": nov, "folder": "Finance/Bills", "suggested": "Finance"},
    ]}).json()
    assert res == {"sorted": 1}
    rules = client.get("/library/rules").json()
    assert rules["rules"] == [] and rules["suggestions"][0]["contains"] == "airtel"

    assert client.post("/library/rules", json={"folder_id": bills, "contains": "airtel"}).status_code == 200
    assert [r["contains"] for r in client.get("/library/rules").json()["rules"]] == ["airtel"]
    assert client.post("/library/undo").json()["kind"] == "add_rule"
    assert client.post("/library/rules/dismiss", json={"folder_id": bills, "contains": "airtel"}).status_code == 200
    assert "airtel" not in [s["contains"] for s in client.get("/library/rules").json()["suggestions"]]


@pytest.mark.skipif(sys.platform != "darwin", reason="Finder tags are macOS only")
def test_finder_tags_follow_the_folders_and_keep_your_own(client, db, home):
    bill = home / "bescom-bill.pdf"
    library_tags.write_tags(bill, ["Mine"])
    res = client.post("/library/settings", json={"finder_tags": True}).json()
    assert res["finder_tags"] is True and res["tagged"] == 4
    assert library_tags.read_tags(bill) == ["Mine", "Bills"]
    assert library_tags.read_tags(home / "resume-2026.pdf") == []  # in no folder

    with sqlite3.connect(db.db_path) as conn:
        bills = _id(conn, "folders", "name", "Bills")
    client.patch(f"/library/folders/{bills}", json={"name": "Power"})
    assert library_tags.read_tags(bill) == ["Mine", "Power"]

    client.post("/library/settings", json={"finder_tags": False})
    assert library_tags.read_tags(bill) == ["Mine"]
    assert client.get("/library/settings").json() == {"finder_tags": False, "finder_tags_supported": True}
