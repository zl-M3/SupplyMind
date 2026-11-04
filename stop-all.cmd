@echo off
REM ============================================================
REM  SupplyMind - stop backend (8000) and frontend (5273)
REM  Optionally stops MySQL 3306 as well.
REM ============================================================
setlocal
title SupplyMind Stop

echo Stopping SupplyMind services ...

for %%P in (8000 5273) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P " ^| findstr LISTENING') do (
    echo   killing port %%P pid %%A
    taskkill /PID %%A /F >nul 2>&1
  )
)

set /p STOP_DB=Stop MySQL 3306 too? [y/N]:
if /i "%STOP_DB%"=="y" (
  if "%SUPPLY_MYSQL_HOME%"=="" set "SUPPLY_MYSQL_HOME=F:\HeiMaChengxuyuan\mysql-8.4.5-winx64"
  if exist "%SUPPLY_MYSQL_HOME%\bin\mysqladmin.exe" (
    "%SUPPLY_MYSQL_HOME%\bin\mysqladmin.exe" --user=root --password=1234 --host=127.0.0.1 shutdown >nul 2>&1
    echo   MySQL stop requested
  ) else (
    echo   mysqladmin.exe not found, stop MySQL manually
  )
) else (
  echo   MySQL kept running
)

echo Done.
