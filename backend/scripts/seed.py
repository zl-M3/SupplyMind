"""初始化 / 重置数据库。

用法::

    python scripts/seed.py           # 空库时写入演示数据；已有数据则跳过
    python scripts/seed.py --reset   # 删除全部表 → 重建 → 重新写入演示数据
    python scripts/init_mysql.py     # 若数据库不存在，先执行该命令建库
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import models  # noqa: F401,E402  注册元数据
from app.core.database import Base, SessionLocal, check_connection, create_all_tables, engine  # noqa: E402
from app.seed import seed_demo_data  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="初始化 SupplyMind 数据库与演示数据")
    parser.add_argument("--reset", action="store_true", help="先删除所有表再重建（危险）")
    parser.add_argument("--skip-seed", action="store_true", help="只建表，不写演示数据")
    args = parser.parse_args()

    ok, info = check_connection()
    if not ok:
        print(f"[FAIL] 数据库不可用: {info}")
        print("       请先执行: python scripts/init_mysql.py")
        return 1
    print(f"[OK] 数据库连接成功，版本 {info}")

    if args.reset:
        confirm = input("确认删除全部数据表？输入 yes 继续: ").strip().lower()
        if confirm != "yes":
            print("已取消")
            return 0
        Base.metadata.drop_all(bind=engine)
        print("[OK] 已删除全部表")

    create_all_tables()
    print(f"[OK] 表结构就绪（{len(Base.metadata.tables)} 张表）")

    if args.skip_seed:
        return 0

    with SessionLocal() as db:
        if seed_demo_data(db):
            print("[OK] 演示数据写入完成")
            print("     账号: admin/admin123  purchaser/purchaser123  warehouse/warehouse123  viewer/viewer123")
        else:
            print("[SKIP] 已有数据，未重复写入（如需重置请加 --reset）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
