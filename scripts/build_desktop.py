#!/usr/bin/env python3
"""
TidyFlow Desktop Build Script.

Automates:
1. Building React frontend (npm run build)
2. Compiling native macOS Swift OCR binary (on macOS)
3. Bundling standalone desktop app via PyInstaller (.app on macOS, .exe on Windows)
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

# Fix Windows console UTF-8 encoding for emojis and Unicode output
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT_DIR = Path(__file__).resolve().parent.parent


def print_step(title: str):
    print("\n" + "=" * 60)
    print(f"🚀 {title}")
    print("=" * 60)


def check_python_dependencies():
    print_step("Step 0: Verifying Python Dependencies")
    req_file = ROOT_DIR / "requirements.txt"
    if req_file.exists():
        print("📦 Ensuring all packages from requirements.txt are installed...")
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(req_file)], check=True)
    
    deps = ["pyinstaller>=6.0.0", "pywebview>=5.0.0"]
    if sys.platform == "win32":
        deps.append("pythonnet>=3.0.0")
    
    subprocess.run([sys.executable, "-m", "pip", "install", *deps], check=True)
    print("✅ All Python dependencies are installed and up to date!")


def build_frontend():
    print_step("Step 1: Building React Frontend")
    frontend_dir = ROOT_DIR / "frontend"
    if not (frontend_dir / "package.json").exists():
        print("❌ Frontend directory not found!")
        sys.exit(1)

    npm = shutil.which("npm")
    if not npm:
        print("❌ npm not found! Please install Node.js (https://nodejs.org).")
        sys.exit(1)

    # Check node_modules
    if not (frontend_dir / "node_modules").exists():
        print("📦 Installing frontend dependencies (npm install)...")
        subprocess.run([npm, "install"], cwd=frontend_dir, check=True, shell=(sys.platform == "win32"))

    print("⚡ Compiling Vite production bundle (npm run build)...")
    subprocess.run([npm, "run", "build"], cwd=frontend_dir, check=True, shell=(sys.platform == "win32"))
    dist_dir = frontend_dir / "dist"
    if not dist_dir.exists() or not (dist_dir / "index.html").exists():
        print("❌ Frontend build failed: index.html not found in dist/")
        sys.exit(1)
    print("✅ Frontend build completed successfully!")


def build_native_binaries():
    print_step("Step 2: Checking / Compiling Native Binaries")
    if sys.platform == "darwin":
        swift_src = ROOT_DIR / "src" / "native" / "macos_ocr.swift"
        bin_out = ROOT_DIR / "bin" / "macos_ocr"
        bin_out.parent.mkdir(parents=True, exist_ok=True)

        swiftc = shutil.which("swiftc")
        if swift_src.exists() and swiftc:
            print("🍎 Compiling macOS Apple Vision OCR binary with swiftc...")
            try:
                subprocess.run(
                    [swiftc, "-O", "-whole-module-optimization", str(swift_src), "-o", str(bin_out)],
                    check=True,
                )
                bin_out.chmod(0o755)
                print(f"✅ Compiled native OCR binary at: {bin_out}")
            except Exception as e:
                print(f"⚠️ Warning: Could not compile Swift OCR binary: {e}")
        elif bin_out.exists():
            print(f"✅ Using existing native OCR binary at: {bin_out}")
        else:
            print("ℹ️ No Swift compiler found; app will use Python OCR fallback.")
    else:
        print("ℹ️ Non-macOS platform; using PaddleOCR engine.")


def package_desktop():
    print_step("Step 3: Packaging Desktop App with PyInstaller")
    pyinstaller = shutil.which("pyinstaller")
    if not pyinstaller:
        print("📦 Installing PyInstaller in current Python environment...")
        subprocess.run([sys.executable, "-m", "pip", "install", "pyinstaller", "pywebview"], check=True)

    spec_file = ROOT_DIR / "tidyflow.spec"
    if not spec_file.exists():
        print(f"❌ spec file not found at: {spec_file}")
        sys.exit(1)

    print("🔨 Running PyInstaller...")
    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        str(spec_file),
        "--noconfirm",
        "--clean",
    ]
    subprocess.run(cmd, cwd=ROOT_DIR, check=True)

    if sys.platform == "darwin":
        app_path = ROOT_DIR / "dist" / "TidyFlow.app"
        print(f"📱 macOS App Bundle: {app_path}")
        print("\nTo test, run:")
        print(f"  open '{app_path}'")
    elif sys.platform == "win32":
        exe_path = ROOT_DIR / "dist" / "TidyFlow" / "TidyFlow.exe"
        if not exe_path.exists():
            exe_path = ROOT_DIR / "dist" / "TidyFlow.exe"
        print(f"💻 Windows Executable: {exe_path}")
        print("\nTo test, run:")
        print(f"  .\\dist\\TidyFlow\\TidyFlow.exe")
    else:
        bin_path = ROOT_DIR / "dist" / "TidyFlow" / "TidyFlow"
        if not bin_path.exists():
            bin_path = ROOT_DIR / "dist" / "TidyFlow"
        print(f"🐧 Linux Executable: {bin_path}")


def create_dmg():
    """Create a drag-and-drop .dmg installer on macOS."""
    if sys.platform != "darwin":
        return

    print_step("Step 4: Creating macOS .dmg Installer")
    app_path = ROOT_DIR / "dist" / "TidyFlow.app"
    if not app_path.exists():
        print(f"❌ Cannot create DMG: {app_path} does not exist.")
        return

    dmg_path = ROOT_DIR / "dist" / "TidyFlow.dmg"
    dmg_temp = ROOT_DIR / "dist" / "dmg_temp"

    if dmg_temp.exists():
        shutil.rmtree(dmg_temp)
    dmg_temp.mkdir(parents=True, exist_ok=True)

    print("📁 Staging files for DMG...")
    shutil.copytree(app_path, dmg_temp / "TidyFlow.app", symlinks=True)

    # Symlink to /Applications for standard drag-and-drop installer
    apps_link = dmg_temp / "Applications"
    if not apps_link.exists():
        os.symlink("/Applications", str(apps_link))

    if dmg_path.exists():
        dmg_path.unlink()

    hdiutil = shutil.which("hdiutil")
    if not hdiutil:
        print("⚠️ hdiutil command not found. Skipping DMG creation.")
        return

    print(f"📦 Generating DMG: {dmg_path}...")
    subprocess.run(
        [
            "hdiutil",
            "create",
            "-volname",
            "TidyFlow Installer",
            "-srcfolder",
            str(dmg_temp),
            "-ov",
            "-format",
            "UDZO",
            str(dmg_path),
        ],
        check=True,
    )

    shutil.rmtree(dmg_temp, ignore_errors=True)
    print(f"🎉 1-Click Installer Ready: {dmg_path}")


def main():
    print("\n📦 TidyFlow 2.0 — Standalone Desktop App Builder")
    print(f"Root Directory: {ROOT_DIR}\n")
    try:
        check_python_dependencies()
        build_frontend()
        build_native_binaries()
        package_desktop()
        create_dmg()
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Build failed during command: {e.cmd}")
        sys.exit(e.returncode)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

