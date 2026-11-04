"""初始化 MySQL 数据库（建库 + 校验字符集）。

用法::

    python scripts/init_mysql.py
    python scripts/init_mysql.py --host 127.0.0.1 --port 3306 --user root --password 1234 --database supplymind

脚本只负责「建库」，建表由应用启动时自动完成（``AUTO_CREATE_TABLES=true``）
或手动执行 ``python -m app.db_init``。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# 允许直接以 ``python scripts/init_mysql.py`` 方式运行
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pymysql  # noqa: E402

from app.core.config import settings  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="创建 SupplyMind 的 MySQL 数据库")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3306)
    parser.add_argument("--user", default="root")
    parser.add_argument("--password", default="1234")
    parser.add_argument("--database", default=settings.MYSQL_DB_NAME)
    parser.add_argument(
        "--collation",
        default="utf8mb4_general_ci",
        help="MySQL 8 建议 utf8mb4_0900_ai_ci；跨版本兼容用 utf8mb4_general_ci",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        conn = pymysql.connect(
            host=args.host,
            port=args.port,
            user=args.user,
            password=args.password,
            charset="utf8mb4",
            autocommit=True,
        )
    except pymysql.MySQLError as exc:
        print(f"[FAIL] 无法连接 MySQL {args.host}:{args.port} -> {exc}")
        return 1

    try:
        with conn.cursor() as cur:
            cur.execute("SELECT VERSION()")
            version = cur.fetchone()[0]
            cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{args.database}` "
                f"DEFAULT CHARACTER SET utf8mb4 COLLATE {args.collation}"
            )
            cur.execute(
                "SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME "
                "FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = %s",
                (args.database,),
            )
            charset, collation = cur.fetchone()
        print(f"[OK] MySQL {version}")
        print(f"[OK] database `{args.database}` charset={charset} collation={collation}")
    finally:
        conn.close()

    print(f"[NEXT] 连接串: {settings.database_url_with(args.database)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
