# Build TidyFlow.exe and TidyFlow-windows.zip on Windows.
# Needs: Python 3.10+ (on PATH), Node.js 18+, WebView2 runtime (preinstalled on Windows 10/11).
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")

$python = if (Get-Command python -ErrorAction SilentlyContinue) { "python" }
          elseif (Get-Command py -ErrorAction SilentlyContinue) { "py" }
          else { throw "Python 3.10+ is required: https://www.python.org/downloads/ (tick 'Add Python to PATH')" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "Node.js 18+ is required: https://nodejs.org" }

& $python build\build.py @args
exit $LASTEXITCODE
