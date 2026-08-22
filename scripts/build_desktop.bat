@echo off
setlocal

echo ============================================================
echo 🚀 Building TidyFlow Standalone Desktop App for Windows
echo ============================================================

cd /d "%~dp0\.."

python scripts\build_desktop.py %*

if %ERRORLEVEL% equ 0 (
    echo.
    echo 🎉 Windows build finished successfully! Check the 'dist' folder.
) else (
    echo.
    echo ❌ Build failed with error code %ERRORLEVEL%.
)

endlocal
