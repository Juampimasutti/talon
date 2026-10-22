@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
call INSTALAR-TALON.cmd
exit /b %errorlevel%
