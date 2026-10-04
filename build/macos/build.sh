#!/usr/bin/env bash
# Build TidyFlow.app and TidyFlow.dmg on macOS.
# Needs: Python 3.10+, Node.js 18+, Xcode Command Line Tools (for the Apple Vision OCR helper).
set -euo pipefail
cd "$(dirname "$0")/../.."

PYTHON="${PYTHON:-python3}"
command -v "$PYTHON" >/dev/null || { echo "Python 3.10+ is required: https://www.python.org/downloads/"; exit 1; }
command -v npm >/dev/null || { echo "Node.js 18+ is required: https://nodejs.org"; exit 1; }

"$PYTHON" build/build.py "$@"
