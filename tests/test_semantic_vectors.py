import sqlite3

import numpy as np
import pytest

from src.database import DatabaseManager
from src.semantic import vectors as vx


def unit(*vals, dims=8):
    v = np.zeros(dims, dtype=np.float32)
    v[: len(vals)] = vals
    return v / np.linalg.norm(v)


@pytest.fixture
def db_path(tmp_path):
    path = str(tmp_path / "t.db")
    DatabaseManager(db_path=path)  # creates the schema
    conn = sqlite3.connect(path)
    conn.executemany(
        "INSERT INTO files (id, path, extracted_text, status) VALUES (?, ?, ?, ?)",
        [
            (1, "/a.txt", "rent agreement for the flat", "indexed"),
            (2, "/b.txt", "blood test report", "indexed"),
            (3, "/c.png", "", "indexed"),
            (4, "/d.txt", "skipped text", "skipped"),
            (5, "/e.txt", None, None),
            (6, "/icon.png", "csv", "indexed"),
            (7, "/page.png", "12 / 40 ok", "indexed"),
        ],
    )
    conn.commit()
    conn.close()
    return path


def test_gate_small_library_uses_a_floor():
    assert vx.gate(np.array([0.9, 0.5, 0.7])) == [0, 2]
    assert vx.gate(np.array([0.3, 0.2])) == []
    assert vx.gate(np.array([])) == []


def test_gate_keeps_only_outliers_near_the_best():
    rng = np.random.default_rng(0)
    scores = rng.normal(0.55, 0.03, 500)
    scores[[7, 42, 99]] = [0.80, 0.78, 0.69]
    hits = vx.gate(scores)
    assert hits[:2] == [7, 42]
    assert 99 not in hits  # stands out, but is more than 0.10 below the best
    assert len(hits) < 10


def test_gate_needs_a_minimum_similarity():
    rng = np.random.default_rng(1)
    scores = rng.normal(0.50, 0.03, 500)
    scores[[3, 4]] = [0.66, 0.65]  # stand out, but nothing in the library is really related
    assert vx.gate(scores) == []


def test_gate_flat_scores_match_nothing():
    assert vx.gate(np.full(100, 0.6)) == []


def test_gate_caps_hits():
    scores = np.concatenate([np.full(400, 0.1), np.linspace(0.9, 0.85, 100)])
    assert len(vx.gate(scores, max_hits=50)) == 50


def test_plan_work_finds_text_changes_and_model_changes(db_path):
    work = vx.plan_work(db_path, "m1")
    assert sorted(r[0] for r in work.todo) == [1, 2]
    assert work.drop == [] and work.total == 2

    hashes = {row_id: h for row_id, _, h in work.todo}
    vx.save_vectors(db_path, "m1", [(1, hashes[1], unit(1))])
    work = vx.plan_work(db_path, "m1")
    assert [r[0] for r in work.todo] == [2]

    # Text changed: embed again.
    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE files SET extracted_text = 'new lease text' WHERE id = 1")
    conn.commit()
    conn.close()
    assert sorted(r[0] for r in vx.plan_work(db_path, "m1").todo) == [1, 2]
    # Another model: everything again.
    assert sorted(r[0] for r in vx.plan_work(db_path, "m2").todo) == [1, 2]


def test_plan_work_drops_vectors_of_files_without_text(db_path):
    vx.save_vectors(db_path, "m1", [(3, "h", unit(1)), (4, "h", unit(1))])
    assert sorted(vx.plan_work(db_path, "m1").drop) == [3, 4]


def test_deleting_a_file_deletes_its_vector(db_path):
    vx.save_vectors(db_path, "m1", [(1, "h", unit(1)), (2, "h", unit(0, 1))])
    conn = sqlite3.connect(db_path)
    conn.execute("DELETE FROM files WHERE id = 1")
    conn.commit()
    conn.close()
    assert vx.count_vectors(db_path, "m1") == 1


def test_matrix_load_search_upsert_remove(db_path):
    vx.save_vectors(db_path, "m1", [(1, "h", unit(1, 0)), (2, "h", unit(0, 1))])
    vx.save_vectors(db_path, "m2", [(9, "h", unit(1, 0))])
    m = vx.VectorMatrix()
    m.load(db_path, "m1")
    assert len(m) == 2
    assert m.search(unit(1, 0.1)) == [(1, pytest.approx(0.995, abs=0.01))]
    m.upsert([(2, unit(1, 0.05)), (7, unit(0, 0, 1))])
    assert len(m) == 3
    assert [i for i, _ in m.search(unit(1, 0.1))] == [2, 1]  # 2 now points closer to the query
    m.remove([1, 99])
    assert [i for i, _ in m.search(unit(1, 0.1))] == [2]
    assert [i for i, _ in m.search(unit(0, 0, 1))] == [7]
    m.clear()
    assert m.search(unit(1)) == []


def test_float16_round_trip():
    v = unit(0.3, 0.4, 0.5)
    assert np.allclose(vx.from_blob(vx.to_blob(v)), v, atol=1e-3)


def test_worth_embedding_needs_a_few_real_words():
    assert vx.worth_embedding("no. cash bill date.")
    assert vx.worth_embedding("बिजली का बिल जमा")  # any script counts
    assert vx.worth_embedding("火车票预订确认单请在出发前打印")  # no spaces
    assert not vx.worth_embedding("csv")
    assert not vx.worth_embedding("12 / 40 ok")
    assert not vx.worth_embedding("")
    assert not vx.worth_embedding(None)


def test_plan_work_skips_and_drops_text_too_thin_to_mean_anything(db_path):
    vx.save_vectors(db_path, "m1", [(6, "h", unit(1))])
    work = vx.plan_work(db_path, "m1")
    assert sorted(r[0] for r in work.todo) == [1, 2]
    assert work.drop == [6]
