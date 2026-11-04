"""一次性数据修补：给现有 demo 数据补齐商品小类、补上「成品」大类的可供应公司。

只改 products.sub_category 与 suppliers.categories 两个字段，可重复执行。
运行：python scripts/fix_demo_categories.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.core.database import engine  # noqa: E402

SUB_CATEGORY_BY_CODE = {
    "G0001": "集成电路",
    "G0002": "电容",
    "G0003": "塑胶外壳",
    "G0004": "紧固件",
    "G0005": "纸箱",
    "G0006": "电源模块",
    "G0007": "电源适配器",
    "G0008": "电容",
    "G0009": "亚克力面板",
    "G0010": "包装辅料",
}

# 这些商品大类必须至少有一家合作公司，否则采购下单时供应商下拉是空的
SUPPLIER_CATEGORY_FIX = {
    "SUP001": ["成品"],
}


def main() -> int:
    with engine.begin() as conn:
        for code, sub in SUB_CATEGORY_BY_CODE.items():
            result = conn.execute(
                text("UPDATE products SET sub_category = :sub WHERE code = :code"),
                {"sub": sub, "code": code},
            )
            if result.rowcount:
                print(f"[OK] {code} -> {sub}")

        for supplier_id, extra in SUPPLIER_CATEGORY_FIX.items():
            row = conn.execute(
                text("SELECT categories FROM suppliers WHERE id = :sid"), {"sid": supplier_id}
            ).first()
            if row is None:
                print(f"[SKIP] {supplier_id} 不存在")
                continue
            current = row[0]
            if isinstance(current, str):
                current = json.loads(current or "[]")
            categories = list(current or [])
            missing = [c for c in extra if c not in categories]
            if not missing:
                print(f"[SKIP] {supplier_id} 已包含 {extra}")
                continue
            categories.extend(missing)
            conn.execute(
                text("UPDATE suppliers SET categories = :cats WHERE id = :sid"),
                {"cats": json.dumps(categories, ensure_ascii=False), "sid": supplier_id},
            )
            print(f"[OK] {supplier_id} 增加 {missing} -> {categories}")

        # 汇报：仍然没有任何公司可供应的商品大类
        rows = conn.execute(
            text(
                "SELECT DISTINCT p.category FROM products p "
                "WHERE p.category IS NOT NULL AND p.category <> '' AND NOT EXISTS ("
                "  SELECT 1 FROM suppliers s WHERE JSON_CONTAINS(s.categories, JSON_QUOTE(p.category))"
                ")"
            )
        ).all()
        orphan = [r[0] for r in rows]
        if orphan:
            print(f"[WARN] 以下商品大类暂无供应商可供：{orphan}")
        else:
            print("[DONE] 所有商品大类都有可供应公司")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
