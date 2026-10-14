"""Tests for the metric maths in scripts/compare_decision_models.py."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from compare_decision_models import _metrics  # noqa: E402


def _row(expected, predicted, confidence, cost=0.001):
    return {"expected": expected, "predicted": predicted, "confidence": confidence,
            "latency_s": 0.5, "cost": cost, "error": None}


def test_auto_copy_only_counts_confident_non_unknown():
    rows = [
        _row("A", "A", 0.95),        # auto-copied, right
        _row("A", "B", 0.90),        # auto-copied, wrong
        _row("B", "B", 0.50),        # below threshold
        _row("B", "Unknown", 0.99),  # Unknown never auto-copies
    ]
    m = _metrics(rows, 0.85)
    assert m["accuracy"] == 0.5
    assert m["auto_copy_count"] == 2
    assert m["auto_copy_wrong"] == 1
    assert m["coverage"] == 0.5
    assert m["auto_precision"] == 0.5


def test_perfect_calibration_has_zero_ece():
    rows = [_row("A", "A", 1.0)] * 4
    assert _metrics(rows, 0.85)["ece"] == pytest.approx(0.0)


def test_overconfident_model_has_high_ece():
    rows = [_row("A", "B", 0.95)] * 10
    assert _metrics(rows, 0.85)["ece"] == pytest.approx(0.95)


def test_cost_per_1k_and_empty():
    m = _metrics([_row("A", "A", 0.9, cost=0.002), _row("A", "A", 0.9, cost=None)], 0.85)
    assert m["cost_per_1k"] == pytest.approx(2.0)
    assert _metrics([], 0.85)["auto_precision"] is None
