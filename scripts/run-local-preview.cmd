@echo off
setlocal

set "PROJECT_ROOT=%~dp0\.."
set "PREVIEW_ROOT=%PROJECT_ROOT%\preview-root"
set "TARGET_DIR=%PREVIEW_ROOT%\manga2novel"

if exist "%PREVIEW_ROOT%" rmdir /s /q "%PREVIEW_ROOT%"
mkdir "%TARGET_DIR%"
robocopy "%PROJECT_ROOT%\out" "%TARGET_DIR%" /E > nul

if exist "%PROJECT_ROOT%\.codex-proxy.log" del /f /q "%PROJECT_ROOT%\.codex-proxy.log"
start "" /b cmd /c "cd /d \"%PROJECT_ROOT%\" && node scripts/local-api-proxy.mjs > .codex-proxy.log 2>&1"

cd /d "%PREVIEW_ROOT%"

if exist ".codex-preview.log" del /f /q ".codex-preview.log"

start "" /b cmd /c "python -m http.server 3001 --bind 127.0.0.1 > .codex-preview.log 2>&1"

echo Local API proxy is starting on http://127.0.0.1:8787-8797/proxy
echo Manga2Novel preview server is starting on http://127.0.0.1:3001/manga2novel/
