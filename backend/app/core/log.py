"""日志配置。"""

from __future__ import annotations

import logging
import sys


def setup_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    if root.handlers:
        root.setLevel(level)
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s | %(levelname)-7s | %(name)s | %(message)s", "%Y-%m-%d %H:%M:%S")
    )
    root.addHandler(handler)
    root.setLevel(level)

    for noisy in ("httpx", "httpcore", "openai", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
