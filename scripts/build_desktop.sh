#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
cd "$DIR"

echo "🚀 Building TidyFlow Desktop Application..."
python3 scripts/build_desktop.py "$@"
