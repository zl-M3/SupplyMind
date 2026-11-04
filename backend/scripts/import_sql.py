"""把 ``schema-mysql.sql`` / ``mock-data(1).sql`` 导入 .env 里配置的数据库。

为什么需要这个脚本：
    项目里有两条建库路线，混用就会出现「页面上看到的不是库里那份数据」：

    1) 后端启动时 ``AUTO_CREATE_TABLES`` + ``AUTO_SEED_DEMO_DATA``
       → 用 ORM 建表、用 ``app/seed.py`` 灌一套演示数据（供应链硬件类商品）。
    2) 手工执行 ``schema-mysql.sql`` + ``mock-data(1).sql``
       → 用 SQL 文件建表、灌另一套演示数据（日用品/生鲜类商品）。

    如果第 2 步是在别的库（例如在 Navicat 里当前选中的 ``shizhan``）执行的，
    后端仍然连 ``DB_NAME`` 指定的库，页面自然「和数据库不同步」。

用法（在 backend/ 目录下执行）::

    python scripts/import_sql.py --check                    # 只统计 SQL 文件里的行数
    python scripts/import_sql.py --dry-run                  # 解析语句，不写库
    python scripts/import_sql.py --yes                      # 备份 + 导入（推荐）
    python scripts/import_sql.py --yes --no-backup          # 不备份（空库时可跳过）
    python scripts/import_sql.py --yes --database supplymind

默认读取同目录上两级的 ``schema-mysql.sql`` 与 ``mock-data(1).sql``，
可用 ``--schema`` / ``--data`` 指定其它路径；``--data-only`` 表示只灌数据不重建表。
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]          # backend/
REPO = ROOT.parent                                   # 仓库根目录
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, text           # noqa: E402

from app.core.config import settings                 # noqa: E402

DEFAULT_SCHEMA = REPO / "schema-mysql.sql"
DEFAULT_DATA = REPO / "mock-data(1).sql"


# --------------------------------------------------------------------------- #
# SQL 语句切分
# --------------------------------------------------------------------------- #
def split_statements(sql: str) -> list[str]:
    """按分号切分 SQL，正确处理字符串、反引号、行注释与块注释。

    数据文件里有中文、JSON 数组、``;`` 出现在字符串里的情况，不能简单 split(";")。
    """
    statements: list[str] = []
    buf: list[str] = []
    i, n = 0, len(sql)
    quote: str | None = None

    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""

        if quote:
            buf.append(ch)
            if ch == "\\" and quote in ("'", '"'):
                if nxt:
                    buf.append(nxt)
                    i += 2
                    continue
            elif ch == quote:
                if nxt == quote:          # '' 转义
                    buf.append(nxt)
                    i += 2
                    continue
                quote = None
            i += 1
            continue

        if ch in ("'", '"', "`"):
            quote = ch
            buf.append(ch)
            i += 1
            continue

        if ch == "-" and nxt == "-" and (i + 2 >= n or sql[i + 2] in " \t\r\n"):
            while i < n and sql[i] != "\n":
                i += 1
            continue

        if ch == "#":
            while i < n and sql[i] != "\n":
                i += 1
            continue

        if ch == "/" and nxt == "*":
            end = sql.find("*/", i + 2)
            i = n if end < 0 else end + 2
            continue

        if ch == ";":
            stmt = "".join(buf).strip()
            if stmt:
                statements.append(stmt)
            buf = []
            i += 1
            continue

        buf.append(ch)
        i += 1

    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


_INSERT_RE = re.compile(r"^\s*INSERT\s+INTO\s+`?(\w+)`?", re.IGNORECASE)


def inserted_rows(statement: str) -> tuple[str, int]:
    """统计一条 INSERT 语句写入的行数（VALUES 之后顶层括号对数量）。"""
    match = _INSERT_RE.match(statement)
    table = match.group(1) if match else "?"

    # 找到 VALUES 关键字（可能写成 value / VALUES），列名清单在它之前
    keyword = re.search(r"\bvalues?\b", statement, re.IGNORECASE)
    start = keyword.end() if keyword else 0
    depth = 0
    rows = 0
    quote: str | None = None
    i, n = start, len(statement)
    while i < n:
        ch = statement[i]
        nxt = statement[i + 1] if i + 1 < n else ""
        if quote:
            if ch == "\\" and quote in ("'", '"'):
                i += 2
                continue
            if ch == quote:
                if nxt == quote:
                    i += 2
                    continue
                quote = None
            i += 1
            continue
        if ch in ("'", '"', "`"):
            quote = ch
        elif ch == "(":
            depth += 1
            if depth == 1:
                rows += 1
        elif ch == ")":
            depth -= 1
        i += 1
    return table, rows


# --------------------------------------------------------------------------- #
# 数据库操作
# --------------------------------------------------------------------------- #
def make_engine(database: str):
    url = settings.DATABASE_URL or settings.database_url_with(database)
    return create_engine(url, pool_pre_ping=True, isolation_level="AUTOCOMMIT")


def table_names(conn, database: str) -> list[str]:
    rows = conn.execute(
        text(
            "SELECT TABLE_NAME FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA=:db AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME"
        ),
        {"db": database},
    ).fetchall()
    return [r[0] for r in rows]


def row_counts(conn, database: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for table in table_names(conn, database):
        out[table] = int(
            conn.execute(text(f"SELECT COUNT(*) FROM `{database}`.`{table}`")).scalar() or 0
        )
    return out


def backup_database(conn, database: str) -> str:
    target = f"{database}_backup_{datetime.now():%Y%m%d_%H%M%S}"
    conn.execute(text(f"CREATE DATABASE `{target}` DEFAULT CHARACTER SET utf8mb4"))
    for table in table_names(conn, database):
        conn.execute(text(f"CREATE TABLE `{target}`.`{table}` LIKE `{database}`.`{table}`"))
        conn.execute(text(
            f"INSERT INTO `{target}`.`{table}` SELECT * FROM `{database}`.`{table}`"
        ))
    return target


def ensure_database(conn, database: str) -> None:
    conn.execute(
        text(f"CREATE DATABASE IF NOT EXISTS `{database}` "
             f"DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci")
    )


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def main() -> int:
    parser = argparse.ArgumentParser(description="把 SQL 文件导入本项目配置的数据库")
    parser.add_argument("--schema", default=str(DEFAULT_SCHEMA), help="建表脚本路径")
    parser.add_argument("--data", default=str(DEFAULT_DATA), help="数据脚本路径")
    parser.add_argument("--database", default=settings.DB_NAME, help="目标库名（默认取 .env 的 DB_NAME）")
    parser.add_argument("--data-only", action="store_true", help="只灌数据，不执行建表脚本")
    parser.add_argument("--check", action="store_true", help="只统计 SQL 文件里的写入行数")
    parser.add_argument("--dry-run", action="store_true", help="只解析并打印，不写库")
    parser.add_argument("--no-backup", action="store_true", help="导入前不备份")
    parser.add_argument("--yes", action="store_true", help="跳过交互确认")
    args = parser.parse_args()

    if not settings.is_mysql:
        print(f"当前 DATABASE_URL 不是 MySQL（{settings.database_url_safe}），本脚本只支持 MySQL。")
        return 1

    schema_path = Path(args.schema)
    data_path = Path(args.data)
    if not args.data_only and not schema_path.exists():
        print(f"找不到建表脚本：{schema_path}")
        return 1
    if not data_path.exists():
        print(f"找不到数据脚本：{data_path}")
        return 1

    schema_sql = schema_path.read_text(encoding="utf-8") if not args.data_only else ""
    data_sql = data_path.read_text(encoding="utf-8")
    schema_stmts = split_statements(schema_sql) if schema_sql else []
    data_stmts = split_statements(data_sql)

    print(f"建表脚本：{schema_path.name}（{len(schema_stmts)} 条语句）")
    print(f"数据脚本：{data_path.name}（{len(data_stmts)} 条语句）")

    expected: Counter[str] = Counter()
    for stmt in data_stmts:
        if _INSERT_RE.match(stmt):
            table, rows = inserted_rows(stmt)
            expected[table] += rows
    if expected:
        print("\nSQL 文件声明的行数：")
        for table, rows in sorted(expected.items()):
            print(f"  {table:<26} {rows}")

    if args.check:
        return 0

    if args.dry_run:
        print("\n[预演] 未连接数据库写入。")
        return 0

    print(f"\n目标数据库：{settings.database_url_safe.rsplit('/', 1)[0]}/{args.database}")
    if not args.yes:
        answer = input("确认执行？会清空该库中 SQL 覆盖的表 [y/N] ").strip().lower()
        if answer not in ("y", "yes"):
            print("已取消。")
            return 1

    # 先不带库名连上去，保证目标库不存在时也能建
    admin_engine = make_engine("")
    with admin_engine.connect() as conn:
        ensure_database(conn, args.database)
    admin_engine.dispose()

    engine = make_engine(args.database)
    with engine.connect() as conn:
        before = row_counts(conn, args.database)
        print(f"\n导入前：{sum(before.values())} 行 / {len(before)} 张表")

        if before and not args.no_backup:
            target = backup_database(conn, args.database)
            after_backup = row_counts(conn, target)
            assert after_backup == before, "备份行数与源库不一致"
            print(f"已备份到 `{target}`（回滚：见 README「回滚」一节）")

        # 建表脚本里有 DROP TABLE，先把库清干净，避免残留旧表结构
        for table in table_names(conn, args.database):
            conn.execute(text(f"DROP TABLE IF EXISTS `{args.database}`.`{table}`"))

        for stmt in schema_stmts:
            conn.execute(text(stmt))
        print(f"建表完成：{len(schema_stmts)} 条语句")

        executed = 0
        for stmt in data_stmts:
            conn.execute(text(stmt))
            executed += 1
        print(f"数据写入完成：{executed} 条语句")

        after = row_counts(conn, args.database)

    print("\n导入后行数核对：")
    ok = True
    for table in sorted(after, key=lambda t: (t not in expected, t)):
        want = expected.get(table, 0)
        got = after[table]
        flag = "OK" if (want == got or not expected) else "!!"
        if flag == "!!":
            ok = False
        suffix = f"（SQL 文件 {want}）" if expected else ""
        print(f"  {flag} {table:<26} {got}{suffix}")

    print("\n完成。" if ok else "\n行数与 SQL 文件不一致，请检查语句是否被跳过。")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
