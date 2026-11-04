"""AI 附件：上传的供应商资料先落盘、抽出文本，再交给 Dify 分析。

支持 txt / md / csv / json / log / pdf / docx / xlsx。
扫描版 PDF、图片暂不支持（没有 OCR）。
"""

from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path

from app.core.config import DATA_DIR
from app.core.errors import AppError

UPLOAD_DIR = DATA_DIR / "uploads"
MAX_BYTES = 10 * 1024 * 1024  # 10MB
MAX_CHARS = 12000  # 送进模型的正文上限
KEEP_DAYS = 2

SUPPORTED = {".txt", ".md", ".csv", ".json", ".log", ".pdf", ".docx", ".xlsx", ".png", ".jpg", ".jpeg", ".webp", ".bmp"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}

_ocr_engine = None


def _ocr(path: Path) -> str:
    """图片 / 扫描件：用 RapidOCR 抽文字（中文）。"""
    global _ocr_engine
    if _ocr_engine is None:
        from rapidocr_onnxruntime import RapidOCR

        _ocr_engine = RapidOCR()
    result, _elapsed = _ocr_engine(str(path))
    if not result:
        return ""
    return "\n".join(str(line[1]) for line in result)


def _extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in IMAGE_SUFFIXES:
        return _ocr(path)
    if suffix in {".txt", ".md", ".csv", ".json", ".log"}:
        return path.read_text(encoding="utf-8", errors="ignore")

    if suffix == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        return "\n".join((page.extract_text() or "") for page in reader.pages)

    if suffix == ".docx":
        import docx

        document = docx.Document(str(path))
        parts = [p.text for p in document.paragraphs if p.text.strip()]
        for table in document.tables:
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells]
                if any(cells):
                    parts.append(" | ".join(cells))
        return "\n".join(parts)

    if suffix == ".xlsx":
        import openpyxl

        workbook = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
        lines: list[str] = []
        try:
            for sheet in workbook.worksheets:
                lines.append(f"# 工作表：{sheet.title}")
                for row in sheet.iter_rows(values_only=True):
                    cells = ["" if value is None else str(value) for value in row]
                    if any(cells):
                        lines.append(" | ".join(cells))
        finally:
            workbook.close()
        return "\n".join(lines)

    return ""


def _cleanup() -> None:
    """顺手清掉几天前的附件，避免目录无限膨胀。"""
    if not UPLOAD_DIR.exists():
        return
    cutoff = time.time() - KEEP_DAYS * 86400
    for item in UPLOAD_DIR.iterdir():
        try:
            if item.is_file() and item.stat().st_mtime < cutoff:
                item.unlink()
        except OSError:
            continue


def save_upload(filename: str, content: bytes) -> dict:
    name = Path(filename or "file").name
    suffix = Path(name).suffix.lower()
    if suffix not in SUPPORTED:
        raise AppError(
            "只支持 txt / md / csv / json / pdf / docx / xlsx / png / jpg",
            code="ATTACHMENT_TYPE_UNSUPPORTED",
            status_code=400,
        )
    if not content:
        raise AppError("文件是空的", code="ATTACHMENT_EMPTY", status_code=400)
    if len(content) > MAX_BYTES:
        raise AppError("文件超过 10MB", code="ATTACHMENT_TOO_LARGE", status_code=400)

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    _cleanup()

    token = uuid.uuid4().hex
    raw_path = UPLOAD_DIR / f"{token}{suffix}"
    raw_path.write_bytes(content)

    try:
        text = _extract_text(raw_path)
    except Exception as exc:  # noqa: BLE001
        raw_path.unlink(missing_ok=True)
        raise AppError(
            f"解析文件失败：{type(exc).__name__}: {exc}",
            code="ATTACHMENT_PARSE_FAILED",
            status_code=400,
        ) from exc

    text = re.sub(r"\n{3,}", "\n\n", (text or "").strip())
    if not text:
        raw_path.unlink(missing_ok=True)
        hint = "扫描版 PDF 请先截图成图片再上传（图片支持 OCR）" if suffix == ".pdf" else "图片里没有识别到文字"
        raise AppError(
            f"文件里没有读到可用文字：{hint}",
            code="ATTACHMENT_EMPTY",
            status_code=400,
        )

    (UPLOAD_DIR / f"{token}.txt").write_text(text, encoding="utf-8")
    (UPLOAD_DIR / f"{token}.json").write_text(
        json.dumps({"name": name}, ensure_ascii=False), encoding="utf-8"
    )

    preview = text[:200].replace("\n", " ")
    return {
        "id": token,
        "name": name,
        "chars": len(text),
        "truncated": len(text) > MAX_CHARS,
        "preview": preview,
    }


def load_attachment(token: str) -> tuple[str, str] | None:
    if not re.fullmatch(r"[0-9a-f]{32}", token or ""):
        return None
    text_path = UPLOAD_DIR / f"{token}.txt"
    if not text_path.exists():
        return None
    meta_path = UPLOAD_DIR / f"{token}.json"
    name = "上传的资料"
    if meta_path.exists():
        try:
            name = json.loads(meta_path.read_text(encoding="utf-8")).get("name") or name
        except (OSError, json.JSONDecodeError):
            pass
    return name, text_path.read_text(encoding="utf-8", errors="ignore")[:MAX_CHARS]


# 供应商资料里常见的分类关键词 → 系统里的商品大类
_CATEGORY_HINTS: dict[str, tuple[str, ...]] = {
    "电子元件": ("电子元件", "电阻", "电容", "二极管", "三极管", "电感"),
    "芯片": ("芯片", "IC", "单片机", "STM32", "MCU"),
    "五金件": ("五金", "螺丝", "紧固件", "螺母", "垫片"),
    "包装材料": ("包装", "纸箱", "胶带", "护角", "气泡膜", "缠绕膜"),
    "塑胶件": ("塑胶", "塑料", "ABS", "亚克力", "注塑"),
    "成品": ("成品", "电源模块", "适配器", "整机"),
}

_PRICE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*元")
_LEAD_RE = re.compile(r"(\d+)\s*(?:个)?(?:工作)?天")
_MOQ_RE = re.compile(r"(?:起订|最小起订|MOQ)[^\d]{0,6}(\d+)")


def extract_supplier_profile(text: str) -> dict:
    """从供应商资料里抽字段（规则版，够课程设计用；接 LLM 后可换成模型抽取）。"""
    def pick(pattern: str) -> str | None:
        match = re.search(pattern, text)
        return match.group(1).strip() if match else None

    name = pick(r"(?:供应商|公司名称|企业名称|供货单位)\s*[:：]\s*([^\n，,；;]{2,40})")
    contact = pick(r"(?:联系人|对接人)\s*[:：]\s*([^\s，,；;]{2,10})")
    phone = pick(r"(?:电话|手机|联系方式)\s*[:：]\s*([0-9\-+ ]{7,20})")
    if not phone:
        phone_match = re.search(r"\b(0\d{2,3}-?\d{7,8}|1[3-9]\d{9})\b", text)
        phone = phone_match.group(1) if phone_match else None

    categories = [
        category
        for category, words in _CATEGORY_HINTS.items()
        if any(word in text for word in words)
    ]

    items: list[dict] = []
    skip_words = ("账期", "月结", "质保", "备注", "税率", "发票", "运费", "地址")
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if len(line) < 4:
            continue
        if any(word in line for word in skip_words):
            continue
        price = _PRICE_RE.search(line)
        lead = _LEAD_RE.search(line)
        moq = _MOQ_RE.search(line)
        if not (price or lead):
            continue
        head = re.split(r"[，,：:]|\d", line)[0].strip()
        head = head.replace("单价", "").replace("起订", "").strip()
        items.append(
            {
                "name": (head or line)[:40],
                "price": float(price.group(1)) if price else None,
                "lead_days": int(lead.group(1)) if lead else None,
                "moq": int(moq.group(1)) if moq else None,
                "raw": line[:120],
            }
        )

    return {
        "name": name,
        "contact": contact,
        "phone": phone.replace(" ", "") if phone else None,
        "categories": categories,
        "items": items[:20],
        "confidence": "high" if name and (price or items) else "medium",
    }
