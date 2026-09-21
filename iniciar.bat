@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo Ainda nao instalado. Rode instalar.bat primeiro.
  pause
  exit /b 1
)

start "" http://localhost:3000
call pnpm start:all
pause
