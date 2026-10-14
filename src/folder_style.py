"""Finder folder looks on macOS 26+: a symbol or emoji on the folder, and a colour via a Finder tag.

Tahoe keeps a folder's symbol/emoji in the `com.apple.icon.folder#S` extended attribute (with the
"custom icon" Finder flag set) and tints a folder with the colour of its Finder tag. Neither is a
public API, so every step here is best effort: a failure leaves a plain folder and never affects sorting.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import json
import logging
import platform
import plistlib
import sys
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# SF Symbols offered in the app. Each one was checked to exist on macOS 26.
SYMBOLS: tuple[str, ...] = (
    "photo.on.rectangle", "camera", "display", "film", "music.note", "paintpalette",
    "doc.text", "book", "newspaper", "graduationcap", "briefcase", "person.crop.circle",
    "receipt", "creditcard", "banknote", "chart.bar", "tablecells", "cylinder.split.1x2",
    "chevron.left.forwardslash.chevron.right", "terminal", "shippingbox", "archivebox",
    "airplane", "house", "heart", "cross.case", "building.columns", "signature",
    "envelope", "calendar", "cart", "gamecontroller", "globe", "lock", "star", "sparkles",
)

# Finder tag colours, by the number Finder stores after the tag name.
COLORS: dict[str, int] = {
    "gray": 1, "green": 2, "purple": 3, "blue": 4, "yellow": 5, "red": 6, "orange": 7,
}

_ICON_ATTR = "com.apple.icon.folder#S"
_FINDER_INFO = "com.apple.FinderInfo"
_TAGS_ATTR = "com.apple.metadata:_kMDItemUserTags"
_HAS_CUSTOM_ICON = 0x0400  # FolderInfo.finderFlags, bytes 8-9 of FinderInfo


def is_supported() -> bool:
    """Folder symbols exist from macOS 26 (Tahoe)."""
    if sys.platform != "darwin":
        return False
    try:
        return int(platform.mac_ver()[0].split(".")[0]) >= 26
    except (ValueError, IndexError):
        return False


def clean_look(raw: Any) -> Optional[dict[str, str]]:
    """Keep only a known symbol, a short emoji/text, and a known colour. None when nothing is left."""
    if not isinstance(raw, dict):
        return None
    look: dict[str, str] = {}
    emoji = str(raw.get("emoji") or "").strip()
    symbol = str(raw.get("symbol") or "").strip()
    if emoji:
        look["emoji"] = emoji[:8]
    elif symbol in SYMBOLS:
        look["symbol"] = symbol
    color = str(raw.get("color") or "").strip().lower()
    if color in COLORS:
        look["color"] = color
    return look or None


def _libc():
    return ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)


def _get_xattr(path: Path, name: str) -> bytes | None:
    libc = _libc()
    p, n = str(path).encode(), name.encode()
    size = libc.getxattr(p, n, None, 0, 0, 0)
    if size < 0:
        return None
    buf = ctypes.create_string_buffer(size)
    got = libc.getxattr(p, n, buf, size, 0, 0)
    return buf.raw[:got] if got >= 0 else None


def _set_xattr(path: Path, name: str, value: bytes) -> None:
    rc = _libc().setxattr(str(path).encode(), name.encode(), value, len(value), 0, 0)
    if rc != 0:
        raise OSError(ctypes.get_errno(), f"setxattr {name} failed")


def apply_look(folder: Path, look: dict[str, str]) -> bool:
    """Give one folder its symbol/emoji and colour. Returns True when anything was applied."""
    applied = False
    icon = {"emoji": look["emoji"]} if look.get("emoji") else ({"sym": look["symbol"]} if look.get("symbol") else None)
    if icon:
        try:
            _set_xattr(folder, _ICON_ATTR, json.dumps(icon, ensure_ascii=False).encode("utf-8"))
            info = bytearray(_get_xattr(folder, _FINDER_INFO) or b"\x00" * 32)
            info = info.ljust(32, b"\x00")
            flags = int.from_bytes(info[8:10], "big") | _HAS_CUSTOM_ICON
            info[8:10] = flags.to_bytes(2, "big")
            _set_xattr(folder, _FINDER_INFO, bytes(info))
            applied = True
        except OSError as exc:
            logger.info("Could not set the folder symbol on %s: %s", folder, exc)

    color = look.get("color")
    if color in COLORS:
        try:
            existing = _get_xattr(folder, _TAGS_ATTR)
            tags = plistlib.loads(existing) if existing else []
            tag = f"{color.capitalize()}\n{COLORS[color]}"
            if tag not in tags:
                tags.append(tag)
            _set_xattr(folder, _TAGS_ATTR, plistlib.dumps(tags, fmt=plistlib.FMT_BINARY))
            applied = True
        except (OSError, plistlib.InvalidFileException, ValueError) as exc:
            logger.info("Could not set the folder colour on %s: %s", folder, exc)
    return applied


def style_new_folders(output_dir: Path, looks: dict[str, Any], existed_before: set[Path]) -> int:
    """Apply looks to the category folders this organize created. Folders that already existed are left alone."""
    if not is_supported():
        return 0
    styled = 0
    for category, raw in looks.items():
        look = clean_look(raw)
        folder = (output_dir / category).resolve()
        if not look or folder in existed_before or not folder.is_dir():
            continue
        # Stay inside the output folder whatever the category name says.
        if output_dir.resolve() not in folder.parents:
            continue
        if apply_look(folder, look):
            styled += 1
    return styled
