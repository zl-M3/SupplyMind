"""AI 回答评估集（规则引擎 / LLM 都适用）。

每个用例给一句提问 + 必须出现的关键事实，跑一遍算通过率。
用法：python scripts/ai_eval.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.models import User  # noqa: E402
from app.services.ai.runner import run_agent  # noqa: E402

CASES: list[tuple[str, tuple[str, ...]]] = [
    ("有哪些商品库存不足？", ("结论", "库存")),
    ("ABS 塑胶外壳需要补多少货？", ("补货", "安全库存")),
    ("最近哪些物流延迟了？", ("延迟", "物流")),
    ("哪家供应商交付有问题？", ("供应商",)),
    ("采购审批需要什么权限？", ("采购审批管理规范", "权限")),
    ("按库存不足生成采购草稿", ("草稿",)),
    ("给所有供应商出个对账单", ("供应商", "金额")),
    ("库存有多少", ("库存",)),
]


def main() -> int:
    passed = 0
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == "gm"))
        if user is None:
            print("找不到 gm 账号，先启动后端初始化数据")
            return 1
        for query, expects in CASES:
            result = run_agent(db, user, user_text=query)
            answer = result.answer or ""
            missing = [word for word in expects if word not in answer]
            ok = not missing
            passed += 1 if ok else 0
            flag = "PASS" if ok else "FAIL"
            print(f"{flag} {query}  (intent={result.intent})")
            if missing:
                print(f"      缺少关键词：{missing}")
                print(f"      回答片段：{answer[:120]!r}")
    total = len(CASES)
    print(f"\n通过 {passed}/{total}（{passed / total:.0%}）")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
