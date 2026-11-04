@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

rem ==========================================================================
rem  重启后端（自动结束占用 8000 的旧进程）
rem  前端 Vite 的 /api 代理固定指向 http://127.0.0.1:8000，
rem  旧进程不退、或 Python 用了旧的 __pycache__，都会导致"改了代码不生效"。
rem ==========================================================================

cd /d "%~dp0"

echo [1/3] 清理 Python 字节码缓存...
for /d /r "%~dp0app" %%d in (__pycache__) do (
  if exist "%%d" rd /s /q "%%d" 2>nul
)

echo [2/3] 结束占用 8000 端口的进程...
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do (
  echo     kill PID %%p
  taskkill /PID %%p /F >nul 2>&1
  set FOUND=1
)
if not defined FOUND echo     端口 8000 空闲。
timeout /t 2 >nul

echo [3/3] 启动后端（Ctrl+C 停止）...
echo.
python run.py
if errorlevel 1 (
  echo.
  echo [ERROR] 启动失败。如果提示找不到 fastapi/sqlalchemy，
  echo         说明这里的 python 不是你平时用的那个，请先激活对应的虚拟环境再运行本脚本。
)
pause
