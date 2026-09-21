@echo off
setlocal
cd /d "%~dp0"

echo === Instalando BraszTech Prospeccao ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale em https://nodejs.org antes de continuar.
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo Instalando o pnpm...
  call npm install -g pnpm
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Criado .env (preencha as chaves na aba "Sistema" do painel).
)

echo Instalando dependencias, pode levar alguns minutos...
call pnpm install
if errorlevel 1 goto :erro

echo Preparando o banco de dados...
call pnpm db:migrate
if errorlevel 1 goto :erro

echo Compilando o painel...
call pnpm build
if errorlevel 1 goto :erro

echo.
echo === Pronto! Use iniciar.bat para abrir o sistema. ===
pause
exit /b 0

:erro
echo.
echo Algo deu errado durante a instalacao. Copie a mensagem acima e mande para o suporte.
pause
exit /b 1
