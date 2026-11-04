"""本地启动脚本：python run.py

端口固定 8000（前端 Vite 的 /api 代理写死这个端口）。

以前踩过的坑，这里都处理掉：
1. 旧进程还占着 8000 —— 老版本会"悄悄换 8001"，结果前端连的还是旧 8000，
   改了代码也不生效（还以为是"重启没生效"）。
   现在：发现 8000 被占用时，**先结束旧进程再接管**（加 -NoKill 可跳过）。
2. 代码改了但 Python 还在用旧的 __pycache__（文件时间戳被同步工具改回去时会这样），
   表现为"接口明明写了却没有这个路由"。启动前删掉 app 下的 __pycache__ 即可。
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import urllib.request


def _port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def _pid_on_port(port: int) -> int | None:
    """从 netstat 里找出监听该端口的 PID。"""
    try:
        out = subprocess.run(
            ["netstat", "-ano"], capture_output=True, text=True, timeout=10, check=False
        ).stdout
    except Exception:  # noqa: BLE001
        return None
    for line in out.splitlines():
        if "LISTENING" not in line:
            continue
        parts = line.split()
        if len(parts) < 5:
            continue
        if parts[1].endswith(f":{port}") and parts[-1].isdigit():
            return int(parts[-1])
    return None


def _is_supplymind_backend(host: str, port: int) -> bool:
    """端口上跑的是不是本项目的后端。"""
    try:
        with urllib.request.urlopen(f"http://{host}:{port}/health", timeout=1.5) as resp:
            body = resp.read(200).decode("utf-8", "ignore")
        return "database" in body or "version" in body
    except Exception:  # noqa: BLE001
        return False


def _free_port(host: str, port: int, no_kill: bool) -> bool:
    """尝试腾出端口；返回端口是否已空闲。"""
    pid = _pid_on_port(port)
    if pid is None:
        return False

    ours = _is_supplymind_backend(host, port)
    if no_kill:
        print(f"[WARN] 端口 {port} 被 PID {pid} 占用（-NoKill 已跳过自动结束）。")
        return False

    label = "本项目的旧后端" if ours else "其它进程"
    print(f"[INFO] 端口 {port} 被 PID {pid} 占用（{label}），正在结束它…")
    try:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/F"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[WARN] 结束进程失败：{exc}")

    for _ in range(20):  # 最多等 10 秒
        if not _port_in_use(host, port):
            print(f"[INFO] 端口 {port} 已释放。")
            return True
        time.sleep(0.5)

    print(f"[ERROR] 端口 {port} 仍被占用。请用管理员终端执行：taskkill /PID {pid} /F")
    return False


def _ensure_mysql(host: str, port: int) -> None:
    """MySQL 没起来时自动拉起来（PyCharm 里点 Run 就能一把跑通）。

    本机的 MySQL 用 Windows 服务方式启动会被系统拒绝，所以这里直接拉 mysqld.exe。
    路径可用环境变量 SUPPLY_MYSQL_HOME 覆盖。
    """
    if _port_in_use(host, port):
        print(f"[INFO] MySQL 已在运行（{host}:{port}）")
        return

    home = os.environ.get("SUPPLY_MYSQL_HOME", r"F:\HeiMaChengxuyuan\mysql-8.4.5-winx64")
    mysqld = os.path.join(home, "bin", "mysqld.exe")
    datadir = os.path.join(home, "data")
    if not os.path.exists(mysqld):
        print(f"[WARN] MySQL 未运行，且找不到 {mysqld}，请手动启动 MySQL")
        return

    print(f"[INFO] MySQL 未运行，正在自动启动：{mysqld}")
    kwargs: dict = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if os.name == "nt":
        kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
    subprocess.Popen(
        [mysqld, f"--datadir={datadir}", f"--port={port}"], **kwargs
    )

    for _ in range(40):  # 最多等 40 秒
        if _port_in_use(host, port):
            print(f"[INFO] MySQL 已就绪（{host}:{port}）")
            return
        time.sleep(1)
    print("[WARN] MySQL 40 秒内没起来，后端启动可能会失败")


def main() -> None:
    host = "127.0.0.1"
    port = int(os.environ.get("PORT", "8000"))
    no_kill = "-NoKill" in sys.argv or "--no-kill" in sys.argv

    db_host = os.environ.get("DB_HOST", "127.0.0.1")
    db_port = int(os.environ.get("DB_PORT", "3306"))
    _ensure_mysql(db_host, db_port)

    if _port_in_use(host, port) and not _free_port(host, port, no_kill):
        print("=" * 74)
        print(f"[ERROR] 无法启动：端口 {port} 被占用。")
        print("        前端 /api 代理固定指向该端口，被旧进程占着时，改了代码也不会生效。")
        print("=" * 74)
        raise SystemExit(1)

    print("=" * 74)
    print(" SupplyMind 后端启动中")
    print(f" 接口文档: http://{host}:{port}/docs")
    print(f" 健康检查: http://{host}:{port}/health")
    print(" 默认账号: gm / 123456（管理者）、sales01 / 123456（采购员）")
    print("=" * 74)

    import uvicorn  # 延迟导入：先给出端口检查结果

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=True,
        reload_dirs=["app"],
        log_level="info",
    )


if __name__ == "__main__":
    main()
