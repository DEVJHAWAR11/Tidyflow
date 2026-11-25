#!/usr/bin/env python3
"""Put llama.cpp's llama-server, for search by meaning, into bin/llama/ for the app bundle.

Downloads one pinned ggml-org release build for this platform, checks its SHA-256, and copies out
llama-server with only the libraries it needs. PyInstaller then bundles bin/ as it does the OCR
helper. Run by build/build.py; safe to run again (it skips the download when bin/llama is current).

    python build/fetch_llama_server.py
"""

from __future__ import annotations

import hashlib
import io
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

# The build the search-by-meaning spike was run with (llama.cpp b12359, 13 Nov 2026).
TAG = "b12359"
BASE = f"https://github.com/ggml-org/llama.cpp/releases/download/{TAG}/"
ASSETS = {
    ("darwin", "arm64"): ("llama-b12359-bin-macos-arm64.tar.gz",
                          "82b00abc740160e1b9980e6cc79c117345fa34af058c80e6c0a69aa8ddccde75"),
    ("darwin", "x86_64"): ("llama-b12359-bin-macos-x64.tar.gz",
                           "25320d529077ef5a3d16e7b5da26438f221d88c8c0930a32b0c79457f5eede56"),
    # Vulkan uses the GPU when its driver is there and falls back to the CPU when it isn't.
    ("win32", "amd64"): ("llama-b12359-bin-win-vulkan-x64.zip",
                         "e8d18c6e4210cca87e7307c2ea78363ac8d158e4e1397358ec96ab70b53a0d5e"),
    ("win32", "arm64"): ("llama-b12359-bin-win-cpu-arm64.zip",
                         "d27564c754478d2832789dfcebfc5ace018e36a224c41d810b7cbc1ba8243ec0"),
}

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "bin" / "llama"
STAMP = OUT / "VERSION"


def asset_for_this_platform() -> tuple[str, str] | None:
    return ASSETS.get((sys.platform, platform.machine().lower()))


def _download(name: str, sha256: str) -> bytes:
    import httpx  # a TidyFlow dependency; unlike urllib it brings its own CA certificates

    print(f"Downloading {name}")
    resp = httpx.get(BASE + name, follow_redirects=True, timeout=120)
    resp.raise_for_status()
    data = resp.content
    got = hashlib.sha256(data).hexdigest()
    if got != sha256:
        raise SystemExit(f"{name}: checksum {got} doesn't match the pinned {sha256}")
    return data


def _extract(name: str, data: bytes, dest: Path) -> Path:
    if name.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            z.extractall(dest)
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as t:
            t.extractall(dest, filter="data")
    exe = "llama-server.exe" if sys.platform == "win32" else "llama-server"
    found = next(dest.rglob(exe), None)
    if found is None:
        raise SystemExit(f"{name} has no {exe}")
    return found.parent


def _mac_libraries(folder: Path, start: str) -> list[str]:
    """Every @rpath library ``start`` loads, directly or through another library."""
    seen: set[str] = set()
    todo = [start]
    while todo:
        out = subprocess.run(["otool", "-L", str(folder / todo.pop())], capture_output=True, text=True, check=True).stdout
        for lib in re.findall(r"@rpath/(\S+)", out):
            if lib not in seen:
                seen.add(lib)
                todo.append(lib)
    return sorted(seen)


def install(folder: Path) -> list[str]:
    """Copy llama-server and its libraries from an extracted release into bin/llama."""
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)
    if sys.platform == "win32":
        names = ["llama-server.exe"] + sorted(p.name for p in folder.glob("*.dll"))
    else:
        names = ["llama-server"] + _mac_libraries(folder, "llama-server")
    for name in names + ["LICENSE"]:
        src = folder / name
        if src.exists():
            # Libraries are reached through symlinks in the release; copy the real file under the
            # name the binary asks for, so the bundle holds no symlinks.
            shutil.copyfile(src.resolve(), OUT / name)
            (OUT / name).chmod(0o755)
    return names


def main() -> None:
    asset = asset_for_this_platform()
    if asset is None:
        print(f"No llama-server build is pinned for {sys.platform}/{platform.machine()}; search by meaning "
              "will use a llama-server on PATH if there is one.")
        return
    name, sha256 = asset
    if STAMP.exists() and STAMP.read_text().strip() == name:
        print(f"bin/llama already holds {name}")
        return
    scratch = ROOT / ".pyinstaller" / "llama"
    shutil.rmtree(scratch, ignore_errors=True)
    scratch.mkdir(parents=True)
    try:
        folder = _extract(name, _download(name, sha256), scratch)
        names = install(folder)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    STAMP.write_text(name + "\n")
    size = sum(p.stat().st_size for p in OUT.iterdir()) / 1e6
    print(f"bin/llama: {len(names)} files, {size:.0f} MB, from {name}")


if __name__ == "__main__":
    main()
