@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Primero instala Node.js 24 LTS desde https://nodejs.org/
  pause
  exit /b 1
)
node windows/instalar.mjs
if errorlevel 1 (
  echo La instalacion no termino. Lee el mensaje de arriba.
  pause
  exit /b 1
)
pause
