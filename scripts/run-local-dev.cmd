@echo off
setlocal

cd /d "%~dp0\.."

if exist ".codex-dev.log" del /f /q ".codex-dev.log"
if exist ".codex-proxy.log" del /f /q ".codex-proxy.log"

start "" /b cmd /c "node scripts/local-api-proxy.mjs > .codex-proxy.log 2>&1"
start "" /b cmd /c "npm run dev -- --hostname 127.0.0.1 --port 3000 > .codex-dev.log 2>&1"

echo Local API proxy is starting on http://127.0.0.1:8787/proxy
echo Manga2Novel dev server is starting on http://127.0.0.1:3000
