# -*- mode: python ; coding: utf-8 -*-

import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata

block_cipher = None
project_root = Path.cwd()

# Collect data files
datas = []

# Frontend build
frontend_dist = project_root / "frontend" / "dist"
if frontend_dist.exists():
    datas.append((str(frontend_dist), "frontend/dist"))

# Templates
templates_dir = project_root / "src" / "templates"
if templates_dir.exists():
    datas.append((str(templates_dir), "src/templates"))

# Native binaries / source
native_dir = project_root / "src" / "native"
if native_dir.exists():
    datas.append((str(native_dir), "src/native"))

bin_dir = project_root / "bin"
if bin_dir.exists():
    datas.append((str(bin_dir), "bin"))

# Default configs
for cfg_file in ["config.yaml", "rules.yaml"]:
    cfg_path = project_root / cfg_file
    if cfg_path.exists():
        datas.append((str(cfg_path), "."))

# Collect package data & metadata
datas += collect_data_files("uvicorn")
datas += collect_data_files("sse_starlette")
for pkg in ["fastmcp", "fastmcp-slim", "uvicorn", "sse_starlette", "fastapi", "pydantic", "tqdm", "keyring"]:
    try:
        datas += copy_metadata(pkg)
    except Exception:
        pass

try:
    datas += collect_data_files("webview")
except Exception:
    pass

# Hidden imports to ensure dynamic modules are packaged
hiddenimports = [
    "sse_starlette",
    "sse_starlette.sse",
    "fastapi",
    "pydantic",
    "keyring",
    "keyring.backends",
    "fitz",
    "pymupdf",
    "PIL",
    "PIL.Image",
    "PIL.ImageEnhance",
    "PIL.ImageOps",
    "imagehash",
    "rapidfuzz",
    "pandas",
    "jinja2",
    "yaml",
]

# Dynamically collect all submodules for uvicorn and webview
hiddenimports += collect_submodules("uvicorn")
try:
    hiddenimports += collect_submodules("webview")
except Exception:
    hiddenimports += ["webview"]

if sys.platform == "darwin":
    hiddenimports += ["webview.platforms.cocoa", "keyring.backends.macOS", "objc", "AppKit", "WebKit", "Foundation"]
elif sys.platform == "win32":
    hiddenimports += ["webview.platforms.winforms", "webview.platforms.edgechromium", "keyring.backends.Windows"]

# Icon determination
icon_path = None
if sys.platform == "darwin":
    mac_icon = project_root / "frontend" / "src-tauri" / "icons" / "icon.icns"
    if mac_icon.exists():
        icon_path = str(mac_icon)
elif sys.platform == "win32":
    win_icon = project_root / "frontend" / "src-tauri" / "icons" / "icon.ico"
    if win_icon.exists():
        icon_path = str(win_icon)

a = Analysis(
    ["desktop.py"],
    pathex=[str(project_root)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "scipy", "pytest", "tests"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="TidyFlow",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=icon_path,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="TidyFlow",
)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="TidyFlow.app",
        icon=icon_path,
        bundle_identifier="com.tidyflow.app",
        info_plist={
            "NSHighResolutionCapable": "True",
            "LSBackgroundOnly": "False",
            "CFBundleDisplayName": "TidyFlow",
            "CFBundleName": "TidyFlow",
            "CFBundleVersion": "2.0.0",
            "CFBundleShortVersionString": "2.0.0",
            "NSHumanReadableCopyright": "Copyright © 2026 TidyFlow. All rights reserved.",
        },
    )
