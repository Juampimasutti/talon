@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
node windows/iniciar.mjs
if errorlevel 1 (
  echo No se pudo abrir Talon. Lee el mensaje de arriba.
  pause
  exit /b 1
)
