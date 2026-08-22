@echo off
setlocal

echo ============================================================
echo 🚀 Building TidyFlow Standalone Desktop App for Windows
echo ============================================================

cd /d "%~dp0\.."

:: Check if python is available in PATH
where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    set "PY_CMD=python"
) else (
    where py >nul 2>nul
    if %ERRORLEVEL% equ 0 (
        set "PY_CMD=py"
    ) else (
        echo.
        echo ❌ Python was not found on your system!
        echo Please install Python 3.10+ from https://www.python.org/downloads/
        echo (Make sure to check "Add Python to PATH" during installation)
        exit /b 1
    )
)

echo 🐍 Using Python: %PY_CMD%
%PY_CMD% scripts\build_desktop.py %*

if %ERRORLEVEL% equ 0 (
    echo.
    echo 🎉 Windows build finished successfully!
    echo 📁 Check the 'dist\TidyFlow.exe' executable.
) else (
    echo.
    echo ❌ Build failed with error code %ERRORLEVEL%.
)

endlocal
