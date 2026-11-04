@echo off
REM ============================================================
REM  SupplyMind - one click launcher
REM  Services: MySQL 3306 / FastAPI 8000 / Vite 5273
REM  Everything is resolved relative to this file, so the
REM  project can be moved anywhere without editing paths.
REM
REM  Optional overrides (set before running, e.g. in system env):
REM    SUPPLY_PYTHON       python.exe used by the backend
REM    SUPPLY_MYSQL_HOME   folder that contains bin\mysqld.exe
REM ============================================================
setlocal
title SupplyMind Launcher

set "ROOT=%~dp0"
set "BACKEND_DIR=%ROOT%backend"
set "FRONTEND_DIR=%ROOT%frontend"
set "WEB_URL=http://127.0.0.1:5273"

if "%SUPPLY_MYSQL_HOME%"=="" set "SUPPLY_MYSQL_HOME=F:\HeiMaChengxuyuan\mysql-8.4.5-winx64"
set "MYSQLD=%SUPPLY_MYSQL_HOME%\bin\mysqld.exe"

if "%SUPPLY_PYTHON%"=="" set "SUPPLY_PYTHON=python"
if exist "%ROOT%.venv\Scripts\python.exe" set "SUPPLY_PYTHON=%ROOT%.venv\Scripts\python.exe"
if exist "F:\HeiMaChengxuyuan\anaconda\python.exe" if not exist "%ROOT%.venv\Scripts\python.exe" set "SUPPLY_PYTHON=F:\HeiMaChengxuyuan\anaconda\python.exe"

set "NODE_EXE=node"
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if exist "%ProgramFiles%\nodejs\node.exe" if not exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"

echo ============================================================
echo   SupplyMind launcher
echo   MySQL 3306 / FastAPI 8000 / Vite 5273
echo ============================================================

call :check_port 3306
if errorlevel 1 (
  if exist "%MYSQLD%" (
    echo [1/3] starting MySQL ...
    start "SupplyMind MySQL" /min "%MYSQLD%" --datadir="%SUPPLY_MYSQL_HOME%\data" --port=3306
    call :wait_port 3306 40
  ) else (
    echo [1/3] [WARN] MySQL is not running and mysqld.exe was not found:
    echo         %MYSQLD%
    echo         Start MySQL manually, or set SUPPLY_MYSQL_HOME.
  )
) else (
  echo [1/3] MySQL already listening on 3306, skip
)

call :check_port 8000
if errorlevel 1 (
  echo [2/3] starting backend FastAPI ...
  start "SupplyMind Backend" /min /d "%BACKEND_DIR%" cmd /c ""%SUPPLY_PYTHON%" run.py > backend.log 2>&1"
  call :wait_port 8000 60
) else (
  echo [2/3] backend already listening on 8000, skip
)

call :check_port 5273
if errorlevel 1 (
  echo [3/3] starting frontend Vite ...
  start "SupplyMind Web" /min /d "%FRONTEND_DIR%" cmd /c ""%NODE_EXE%" node_modules\vite\bin\vite.js --port 5273 > web.log 2>&1"
  call :wait_port 5273 90
) else (
  echo [3/3] frontend already listening on 5273, skip
)

echo.
echo Backend docs : http://127.0.0.1:8000/docs
echo Frontend URL : %WEB_URL%
echo Accounts     : gm / 123456  (manager), sales01 / 123456  (buyer)
echo.
start "" "%WEB_URL%"
echo Done. Run stop-all.cmd to stop the services.
exit /b 0

:check_port
netstat -ano | findstr ":%~1 " | findstr LISTENING >nul 2>&1
exit /b %errorlevel%

:wait_port
set "WP_PORT=%~1"
set "WP_LEFT=%~2"
:wait_loop
call :check_port %WP_PORT%
if not errorlevel 1 exit /b 0
set /a WP_LEFT-=1
if %WP_LEFT% LEQ 0 (
  echo [WARN] port %WP_PORT% not ready in time, check its window / log
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto wait_loop
