@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo No se encuentra Node.js. Instalalo o agrega su carpeta al PATH.
  exit /b 1
)
node scripts/backup-worker.mjs --once
exit /b %errorlevel%
