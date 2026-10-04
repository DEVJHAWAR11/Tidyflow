@echo off
:: Build TidyFlow.exe on Windows. Double-click or run from Command Prompt.
:: Forwards to build.ps1 so both entry points behave the same.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" %*
exit /b %ERRORLEVEL%
