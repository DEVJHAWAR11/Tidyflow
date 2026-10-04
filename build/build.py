#!/usr/bin/env python3
"""
Build the TidyFlow desktop app for the current platform.

    macOS    ->  dist/TidyFlow.app  and  dist/TidyFlow.dmg
    Windows  ->  dist/TidyFlow/TidyFlow.exe  and  dist/TidyFlow-windows.zip

PyInstaller can't cross-compile, so run this on the platform you're building for
(or let .github/workflows/build.yml build both).

Usage:
    python build/build.py               # full build
    python build/build.py --skip-deps   # don't pip install first
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent.parent
BUILD_DIR = ROOT / "build"
DIST_DIR = ROOT / "dist"
WORK_DIR = ROOT / ".pyinstaller"
SPEC_FILE = BUILD_DIR / "tidyflow.spec"
IS_MAC = sys.platform == "darwin"
IS_WINDOWS = sys.platform == "win32"


def step(title: str) -> None:
    print(f"\n==> {title}", flush=True)


def run(cmd: list[str], cwd: Path = ROOT, shell: bool = False) -> None:
    subprocess.run(cmd, cwd=cwd, check=True, shell=shell)


def install_python_deps() -> None:
    step("Installing Python dependencies")
    run([sys.executable, "-m", "pip", "install", "-r", str(ROOT / "requirements.txt")])
    extra = ["pyinstaller>=6.0.0", "pywebview>=5.0.0"]
    if IS_WINDOWS:
        extra.append("pythonnet>=3.0.0")
    run([sys.executable, "-m", "pip", "install", *extra])


def build_frontend() -> None:
    step("Building the frontend")
    frontend = ROOT / "frontend"
    npm = shutil.which("npm")
    if not npm:
        sys.exit("npm not found. Install Node.js 18+ from https://nodejs.org")
    if not (frontend / "node_modules").exists():
        run([npm, "install"], cwd=frontend, shell=IS_WINDOWS)  # npm is a .cmd shim on Windows
    run([npm, "run", "build"], cwd=frontend, shell=IS_WINDOWS)
    if not (frontend / "dist" / "index.html").exists():
        sys.exit("Frontend build failed: frontend/dist/index.html is missing")


def build_native_ocr() -> None:
    if not IS_MAC:
        print("Skipping Apple Vision OCR (macOS only); PaddleOCR is used instead.")
        return
    step("Compiling Apple Vision OCR helper")
    source = ROOT / "src" / "native" / "macos_ocr.swift"
    output = ROOT / "bin" / "macos_ocr"
    output.parent.mkdir(parents=True, exist_ok=True)
    swiftc = shutil.which("swiftc")
    if swiftc and source.exists():
        run([swiftc, "-O", "-whole-module-optimization", str(source), "-o", str(output)])
        output.chmod(0o755)
    elif output.exists():
        print(f"swiftc not found; reusing {output.relative_to(ROOT)}")
    else:
        print("swiftc not found; the app will fall back to Python OCR. Run `xcode-select --install` to fix.")


def package_app() -> None:
    step("Packaging with PyInstaller")
    run([
        sys.executable, "-m", "PyInstaller", str(SPEC_FILE),
        "--noconfirm", "--clean",
        "--distpath", str(DIST_DIR),
        "--workpath", str(WORK_DIR),
    ])


def make_dmg() -> Path | None:
    step("Creating TidyFlow.dmg")
    app = DIST_DIR / "TidyFlow.app"
    dmg = DIST_DIR / "TidyFlow.dmg"
    staging = DIST_DIR / "dmg"
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    shutil.copytree(app, staging / "TidyFlow.app", symlinks=True)
    os.symlink("/Applications", staging / "Applications")
    dmg.unlink(missing_ok=True)
    run(["hdiutil", "create", "-volname", "TidyFlow", "-srcfolder", str(staging),
         "-ov", "-format", "UDZO", str(dmg)])
    shutil.rmtree(staging, ignore_errors=True)
    return dmg


def make_windows_zip() -> Path:
    step("Creating TidyFlow-windows.zip")
    archive = shutil.make_archive(str(DIST_DIR / "TidyFlow-windows"), "zip", DIST_DIR, "TidyFlow")
    return Path(archive)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--skip-deps", action="store_true", help="skip pip install")
    args = parser.parse_args()

    print(f"Building TidyFlow for {sys.platform} from {ROOT}")
    try:
        if not args.skip_deps:
            install_python_deps()
        build_frontend()
        build_native_ocr()
        package_app()
        if IS_MAC:
            outputs = [DIST_DIR / "TidyFlow.app", make_dmg()]
        elif IS_WINDOWS:
            outputs = [DIST_DIR / "TidyFlow" / "TidyFlow.exe", make_windows_zip()]
        else:
            outputs = [DIST_DIR / "TidyFlow" / "TidyFlow"]
    except subprocess.CalledProcessError as exc:
        sys.exit(f"\nBuild failed: {' '.join(map(str, exc.cmd))}")

    print("\nDone. Outputs:")
    for path in outputs:
        if path:
            print(f"  {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
