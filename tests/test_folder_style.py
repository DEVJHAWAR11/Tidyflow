"""Tests for Finder folder looks (symbol/emoji and colour on macOS 26+)."""

import json
import plistlib
import sys

import pytest

from src import folder_style
from src.folder_style import _get_xattr, clean_look, style_new_folders

mac_only = pytest.mark.skipif(sys.platform != "darwin", reason="extended attributes are set the macOS way")


def test_clean_look_keeps_only_known_values():
    assert clean_look({"symbol": "receipt", "color": "Green"}) == {"symbol": "receipt", "color": "green"}
    assert clean_look({"emoji": "🧾", "symbol": "receipt"}) == {"emoji": "🧾"}  # emoji wins
    assert clean_look({"symbol": "not.a.symbol", "color": "teal"}) is None
    assert clean_look({"symbol": ""}) is None
    assert clean_look("receipt") is None


@mac_only
def test_new_folders_get_their_look_and_existing_ones_are_left_alone(tmp_path, monkeypatch):
    monkeypatch.setattr(folder_style, "is_supported", lambda: True)
    out = tmp_path / "Organized"
    (out / "Existing").mkdir(parents=True)
    existed = {(out / "Existing").resolve()}
    for name in ("Bills", "Photos", "Finance/Invoices", "Existing"):
        (out / name).mkdir(parents=True, exist_ok=True)

    styled = style_new_folders(
        out,
        {
            "Bills": {"emoji": "🧾", "color": "green"},
            "Photos": {"symbol": "photo.on.rectangle"},
            "Finance/Invoices": {"symbol": "receipt"},
            "Existing": {"symbol": "star"},
            "../Escape": {"symbol": "star"},
        },
        existed,
    )

    assert styled == 3
    assert json.loads(_get_xattr(out / "Bills", "com.apple.icon.folder#S")) == {"emoji": "🧾"}
    assert plistlib.loads(_get_xattr(out / "Bills", "com.apple.metadata:_kMDItemUserTags")) == ["Green\n2"]
    assert json.loads(_get_xattr(out / "Photos", "com.apple.icon.folder#S")) == {"sym": "photo.on.rectangle"}
    # The custom-icon Finder flag is set, so Finder draws the symbol.
    info = _get_xattr(out / "Photos", "com.apple.FinderInfo")
    assert int.from_bytes(info[8:10], "big") & 0x0400
    # Only the leaf of a nested folder is styled; folders that were already there are untouched.
    assert _get_xattr(out / "Finance/Invoices", "com.apple.icon.folder#S") is not None
    assert _get_xattr(out / "Finance", "com.apple.icon.folder#S") is None
    assert _get_xattr(out / "Existing", "com.apple.icon.folder#S") is None


def test_does_nothing_where_unsupported(tmp_path, monkeypatch):
    monkeypatch.setattr(folder_style, "is_supported", lambda: False)
    (tmp_path / "Bills").mkdir()
    assert style_new_folders(tmp_path, {"Bills": {"symbol": "receipt"}}, set()) == 0
