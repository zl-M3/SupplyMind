@echo off
REM ============================================================
REM    frontend dev launcher
REM  Works even if node/pnpm are not on PATH in the caller's env.
REM  Usage: double-click, or run "start-dev.cmd" in any terminal.
REM ============================================================
setlocal

set "NODE_HOME=%LOCALAPPDATA%\Programs\nodejs"
if not exist "%NODE_HOME%\node.exe" set "NODE_HOME=%ProgramFiles%\nodejs"
if not exist "%NODE_HOME%\node.exe" (
  echo [ERROR] Node.js was not found.
  echo         Looked in:
  echo           %LOCALAPPDATA%\Programs\nodejs
  echo           %ProgramFiles%\nodejs
  echo         Install Node.js LTS first, then run this script again.
  pause
  exit /b 1
)

set "PATH=%NODE_HOME%;%PATH%"
cd /d "%~dp0"

echo [1/3] Node.js : & "%NODE_HOME%\node.exe" -v
set "USE_PNPM=0"
where pnpm >nul 2>nul
if not errorlevel 1 set "USE_PNPM=1"
if "%USE_PNPM%"=="1" (
  echo [2/3] pnpm    : & call pnpm -v
) else (
  echo [2/3] pnpm not found, launching local vite with node instead
)

if not exist "node_modules\vite\package.json" (
  echo [INFO] Dependencies missing, running pnpm install ...
  call pnpm install
  if errorlevel 1 (
    echo [ERROR] pnpm install failed.
    pause
    exit /b 1
  )
)

echo [3/3] Starting dev server on http://localhost:5273 ...
echo.
if "%USE_PNPM%"=="1" (
  call pnpm dev
) else (
  call "%NODE_HOME%\node.exe" node_modules\vite\bin\vite.js
)
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
  echo.
  echo [ERROR] dev server exited with code %EXITCODE%
  pause
)
endlocal
