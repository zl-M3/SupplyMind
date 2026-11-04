"""列表导出：Excel / PDF。

前端用带 Authorization 的 fetch 取 blob，再触发下载。
"""

from __future__ import annotations

import io
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterable
from urllib.parse import quote

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from app.api.deps import CurrentUser, DbSession
from app.services import ai_service, inventory_service, purchase_service

router = APIRouter(prefix="/export", tags=["数据导出"])

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _plain(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, date):
        return value.isoformat()
    return value


def _xlsx(title: str, headers: list[str], rows: Iterable[Iterable[Any]], filename: str) -> StreamingResponse:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = title

    header_fill = PatternFill("solid", fgColor="FDE8D8")
    header_font = Font(bold=True, color="8A3B12")
    for col, head in enumerate(headers, start=1):
        cell = sheet.cell(row=1, column=col, value=head)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for row_index, row in enumerate(rows, start=2):
        for col, value in enumerate([_plain(v) for v in row], start=1):
            sheet.cell(row=row_index, column=col, value=value)

    for col, head in enumerate(headers, start=1):
        width = max(len(str(head)) * 2 + 4, 12)
        sheet.column_dimensions[get_column_letter(col)].width = min(width, 32)
    sheet.freeze_panes = "A2"

    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


def _pdf(title: str, headers: list[str], rows: list[list[Any]], filename: str) -> StreamingResponse:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from reportlab.lib.styles import ParagraphStyle

    try:
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    except Exception:  # noqa: BLE001 - 已注册过
        pass

    title_style = ParagraphStyle("title", fontName="STSong-Light", fontSize=16, leading=22)
    cell_style = ParagraphStyle("cell", fontName="STSong-Light", fontSize=8, leading=11)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=24,
        rightMargin=24,
        topMargin=24,
        bottomMargin=24,
    )
    data = [[Paragraph(str(h), cell_style) for h in headers]]
    for row in rows:
        data.append([Paragraph(str(_plain(v)), cell_style) for v in row])

    table = Table(data, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#FDE8D8")),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E8D5C4")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    doc.build([Paragraph(title, title_style), Spacer(1, 8), table])
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/purchase-orders.xlsx", summary="导出采购订单 Excel")
def export_purchase_orders_xlsx(
    db: DbSession,
    current: CurrentUser,
    keyword: str | None = None,
    order_status: str | None = Query(default=None, alias="status"),
) -> StreamingResponse:
    items, _total = purchase_service.list_orders(
        db,
        keyword=keyword,
        status=order_status,
        page=1,
        page_size=10000,
        user=current,
    )
    headers = ["单号", "供应商", "状态", "金额", "下单人", "下单时间", "预计到货", "已收/总数量"]
    rows = [
        [
            po.code,
            po.supplier_name,
            po.status_label or po.status,
            po.total_amount,
            po.created_by_name or po.created_by,
            po.created_at,
            po.expected_arrival,
            f"{po.received_qty}/{po.ordered_qty}",
        ]
        for po in items
    ]
    return _xlsx("采购订单", headers, rows, "采购订单.xlsx")


@router.get("/inventory.xlsx", summary="导出库存 Excel")
def export_inventory_xlsx(
    db: DbSession,
    _current: CurrentUser,
    keyword: str | None = None,
    category: str | None = None,
) -> StreamingResponse:
    items, _total = inventory_service.inventory_overview(
        db, keyword=keyword, category=category, page=1, page_size=5000
    )
    headers = ["商品编码", "商品名称", "大类", "规格", "单位", "现存量", "安全库存", "缺口", "状态", "参考单价"]
    rows = [
        [
            item.product_code,
            item.product_name,
            item.category,
            item.spec,
            item.unit,
            item.total_qty,
            item.safety_stock,
            item.gap,
            item.status_label or item.status,
            item.purchase_price,
        ]
        for item in items
    ]
    return _xlsx("库存总览", headers, rows, "库存总览.xlsx")


@router.get("/ai-reports.xlsx", summary="导出 AI 分析报告 Excel")
def export_reports_xlsx(
    db: DbSession,
    _current: CurrentUser,
    report_type: str | None = Query(default=None, alias="type"),
    keyword: str | None = None,
) -> StreamingResponse:
    items, _total = ai_service.list_reports(
        db, report_type=report_type, keyword=keyword, page=1, page_size=2000
    )
    headers = ["类型", "标题", "对象", "创建人", "生成时间"]
    rows = [
        [item.type_label or item.type, item.title, item.target_name, item.created_by, item.created_at]
        for item in items
    ]
    return _xlsx("AI 分析报告", headers, rows, "AI分析报告.xlsx")


@router.get("/purchase-orders.pdf", summary="导出采购订单 PDF")
def export_purchase_orders_pdf(
    db: DbSession,
    current: CurrentUser,
    keyword: str | None = None,
    order_status: str | None = Query(default=None, alias="status"),
) -> StreamingResponse:
    items, _total = purchase_service.list_orders(
        db, keyword=keyword, status=order_status, page=1, page_size=2000, user=current
    )
    headers = ["单号", "供应商", "状态", "金额", "下单人", "预计到货", "已收/总数量"]
    rows = [
        [
            po.code,
            po.supplier_name,
            po.status_label or po.status,
            po.total_amount,
            po.created_by_name or po.created_by,
            po.expected_arrival,
            f"{po.received_qty}/{po.ordered_qty}",
        ]
        for po in items
    ]
    return _pdf("采购订单清单", headers, rows, "采购订单.pdf")
