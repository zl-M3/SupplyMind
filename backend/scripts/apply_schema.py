"""执行 ``schema-mysql.sql``，把数据库重建成与 E-R 图一致的 19 张表。

用法::

    python scripts/apply_schema.py                 # 用项目根目录的 schema-mysql.sql
    python scripts/apply_schema.py --file xxx.sql  # 指定其它脚本

脚本会先确保库存在，再逐条执行 SQL 文件中的语句（文件自带 DROP TABLE，可重复执行）。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pymysql

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.config import settings  # noqa: E402


def split_statements(sql: str) -> list[str]:
    """按分号切分语句，跳过 ``--`` 注释行与空行。"""
    kept = [
        line
        for line in sql.splitlines()
        if line.strip() and not line.strip().startswith("--")
    ]
    return [stmt.strip() for stmt in "\n".join(kept).split(";") if stmt.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description="执行建表脚本")
    parser.add_argument("--file", default=str(ROOT / "schema-mysql.sql"))
    parser.add_argument("--host", default=settings.DB_HOST)
    parser.add_argument("--port", type=int, default=settings.DB_PORT)
    parser.add_argument("--user", default=settings.DB_USER)
    parser.add_argument("--password", default=settings.DB_PASSWORD)
    parser.add_argument("--database", default=settings.MYSQL_DB_NAME)
    parser.add_argument(
        "--no-drop",
        action="store_true",
        help="不删除旧库（默认会 DROP DATABASE 后重建，避免旧表残留外键冲突）",
    )
    args = parser.parse_args()

    path = Path(args.file)
    if not path.exists():
        print(f"找不到 SQL 文件：{path}")
        return 1
    statements = split_statements(path.read_text(encoding="utf-8"))
    print(f"待执行语句：{len(statements)} 条（{path.name}）")

    conn = pymysql.connect(
        host=args.host,
        port=args.port,
        user=args.user,
        password=args.password,
        charset=settings.DB_CHARSET,
        autocommit=True,
    )
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT VERSION()")
            print(f"MySQL 版本：{cur.fetchone()[0]}")
            if not args.no_drop:
                # 旧库里的表（含上一版遗留的 stock_transfer_items）会与新表的外键冲突，
                # 因此默认整库重建；SQL 文件本身也是幂等的 DROP + CREATE。
                cur.execute(f"DROP DATABASE IF EXISTS `{args.database}`")
                print(f"已删除旧库：{args.database}")
            cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{args.database}` "
                "DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci"
            )
            cur.execute(f"USE `{args.database}`")
            cur.execute("SET NAMES utf8mb4")
            for index, stmt in enumerate(statements, start=1):
                try:
                    cur.execute(stmt)
                except pymysql.MySQLError as exc:  # pragma: no cover - 直接报错退出
                    print(f"[{index}] 执行失败：{exc}\nSQL: {stmt[:200]}")
                    return 1
            cur.execute("SHOW TABLES")
            tables = [row[0] for row in cur.fetchall()]
            cur.execute("SHOW FULL TABLES WHERE Table_type = 'VIEW'")
            views = [row[0] for row in cur.fetchall()]
    finally:
        conn.close()

    print(f"建表完成：{len(tables)} 张表")
    for name in tables:
        print(f"  - {name}")
    if views:
        print(f"视图：{', '.join(views)}")
    print(f"连接串：{settings.database_url_with(args.database)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
