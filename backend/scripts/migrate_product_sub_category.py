"""商品大类 / 小类改造：给 products 补 ``sub_category`` 并按现有商品回填。

背景：采购下单改成「商品大类 → 商品小类 → 可供应公司 → 商品」的链路后，
商品需要两级分类。``category`` 继续作为商品大类（与供应商的供货大类对应），
新增 ``sub_category`` 作为商品小类。

用法::

    python scripts/migrate_product_sub_category.py
    python scripts/migrate_product_sub_category.py --dry-run

脚本可重复执行：列已存在时跳过新增，只补齐 sub_category 为空的商品。
"""

from __future__ import annotations

import sys
from pathlib import Path

# 允许直接以 ``python scripts/migrate_product_sub_category.py`` 方式运行
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import inspect, text  # noqa: E402

from app.core.database import engine  # noqa: E402

# 现有演示 / 生产数据的小类归属（按商品编码，缺失时按商品名匹配）
SUB_CATEGORY_BY_CODE: dict[str, str] = {
    # 生活用品
    "P001": "纸品清洁",
    "P002": "纸品清洁",
    "P006": "纸品清洁",
    "P007": "纸品清洁",
    "P003": "家居日用",
    "P004": "家居日用",
    "P005": "家居日用",
    # 食品生鲜
    "P008": "粮油速食",
    "P014": "粮油速食",
    "P009": "蛋奶肉禽",
    "P010": "蛋奶肉禽",
    "P011": "蛋奶肉禽",
    "P012": "蔬果酒水",
    "P013": "蔬果酒水",
    # 办公耗材
    "P015": "纸张耗材",
    "P017": "纸张耗材",
    "P016": "文具用品",
    "P018": "文具用品",
    "P019": "文具用品",
}

SUB_CATEGORY_BY_NAME: dict[str, str] = {
    "抽取式面巾纸 3 层 100 抽": "纸品清洁",
    "抑菌洗手液 500ml": "纸品清洁",
    "消毒湿巾 80 抽": "纸品清洁",
    "厨房清洁剂 500ml": "纸品清洁",
    "加厚垃圾袋 45×55cm": "家居日用",
    "薰衣草洗衣液 2kg": "家居日用",
    "一次性纸杯 250ml": "家居日用",
    "五常大米 5kg": "粮油速食",
    "三鲜速冻水饺 1kg": "粮油速食",
    "鲜鸡蛋 30 枚装": "蛋奶肉禽",
    "全脂纯牛奶 1L": "蛋奶肉禽",
    "冷鲜牛腩 500g": "蛋奶肉禽",
    "有机蔬菜礼盒 5kg": "蔬果酒水",
    "精酿啤酒 330ml×24": "蔬果酒水",
    "A4 复印纸 70g 500 张": "纸张耗材",
    "激光打印机硒鼓 通用款": "纸张耗材",
    "中性笔 0.5mm 黑色": "文具用品",
    "A4 双强力夹文件夹": "文具用品",
    "12# 订书机": "文具用品",
}

# 兜底：小类缺失时按大类归到「其他 X」
FALLBACK_BY_MAJOR: dict[str, str] = {
    "生活用品": "家居日用",
    "食品生鲜": "粮油速食",
    "办公耗材": "文具用品",
}


def _ensure_column(conn) -> bool:
    inspector = inspect(conn)
    columns = {col["name"] for col in inspector.get_columns("products")}
    if "sub_category" in columns:
        print("[SKIP] products.sub_category 已存在")
        return False
    conn.execute(
        text(
            "ALTER TABLE products "
            "ADD COLUMN sub_category VARCHAR(40) NULL COMMENT '商品小类' AFTER category"
        )
    )
    print("[OK] 已新增 products.sub_category")
    return True


def _backfill(conn, *, dry_run: bool = False) -> int:
    rows = conn.execute(
        text("SELECT id, code, name, category, sub_category FROM products ORDER BY code")
    ).mappings().all()
    updated = 0
    for row in rows:
        if (row["sub_category"] or "").strip():
            continue
        sub = (
            SUB_CATEGORY_BY_CODE.get(str(row["code"]))
            or SUB_CATEGORY_BY_NAME.get(str(row["name"]))
            or FALLBACK_BY_MAJOR.get(str(row["category"] or ""))
            or "未分类"
        )
        if dry_run:
            print(f"[DRY] {row['code']} {row['name']} -> {row['category']} / {sub}")
        else:
            conn.execute(
                text("UPDATE products SET sub_category = :sub WHERE id = :pid"),
                {"sub": sub, "pid": row["id"]},
            )
            print(f"[OK] {row['code']} {row['name']} -> {row['category']} / {sub}")
        updated += 1
    return updated


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    with engine.begin() as conn:
        if not dry_run:
            _ensure_column(conn)
        updated = _backfill(conn, dry_run=dry_run)
    print(f"[DONE] {'待' if dry_run else '已'}回填 {updated} 个商品的小类")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
