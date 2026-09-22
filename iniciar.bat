@echo off
setlocal
cd /d "%~dp0"

if exist "node_modules" goto :instalado
echo Ainda nao instalado. Rode instalar.bat primeiro.
pause
exit /b 1

:instalado
start "" http://localhost:3000
call pnpm start:all
pause
