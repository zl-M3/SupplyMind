"""AI 智能中心接口：对话、任务、报告与分析能力。"""

from __future__ import annotations

import asyncio
import json
from typing import Annotated, Any, AsyncIterator

from fastapi import APIRouter, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, DbSession, PageParams
from app.core.errors import AppError
from app.schemas.ai import (
    AnalysisCapability,
    AnalysisResponse,
    ChatRequest,
    ChatResponse,
    ConfirmationCreate,
    ConversationCreate,
    ConversationOut,
    ConversationUpdate,
    FeedbackIn,
    KnowledgeUpload,
    ReportBrief,
    ReportOut,
    TaskOut,
    ToolInfo,
)
from app.schemas.common import MessageOut, Page
from app.services import ai_service, attachment_service
from app.services.ai import knowledge as ai_knowledge
from app.services.ai import tools as ai_tools

router = APIRouter(prefix="/ai", tags=["AI 智能中心"])


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.get("/capabilities", summary="AI 能力信息")
def capabilities(db: DbSession, current_user: CurrentUser) -> dict:
    return ai_service.capabilities(current_user)


@router.get("/tools", response_model=list[ToolInfo], summary="当前角色可用的 AI 工具")
def list_tools(current_user: CurrentUser) -> list[ToolInfo]:
    visible = set(ai_tools.allowed_tools(current_user))
    return [
        ToolInfo(**info) for info in ai_tools.tool_infos() if info["name"] in visible
    ]


@router.get("/knowledge", summary="知识库文档清单")
def knowledge_documents(_current: CurrentUser) -> list[dict]:
    return ai_knowledge.documents()


@router.get("/knowledge/search", summary="知识库检索（返回引用片段与相似度）")
def knowledge_search(
    q: str,
    _current: CurrentUser,
    top_k: Annotated[int, Query(ge=1, le=10)] = 3,
) -> list[dict]:
    return ai_knowledge.search_knowledge(q, top_k=top_k)


@router.post(
    "/knowledge",
    status_code=status.HTTP_201_CREATED,
    summary="新增 / 覆盖知识文档（md 正文）",
)
def knowledge_upload(payload: KnowledgeUpload, _current: CurrentUser) -> dict:
    return ai_knowledge.save_document(payload.filename, payload.content)


class ExtractSupplierIn(BaseModel):
    attachment_id: str = Field(min_length=1)


@router.post("/extract/supplier", summary="从上传的供应商资料里抽字段（回填表单用）")
def extract_supplier_profile(payload: ExtractSupplierIn, _current: CurrentUser) -> dict:
    loaded = attachment_service.load_attachment(payload.attachment_id)
    if loaded is None:
        raise AppError(
            "附件不存在或已过期，请重新上传", code="ATTACHMENT_NOT_FOUND", status_code=404
        )
    file_name, text = loaded
    profile = attachment_service.extract_supplier_profile(text)
    profile["file_name"] = file_name
    return profile


@router.post("/messages/{message_id}/feedback", summary="给 AI 回答点赞 / 点踩")
def message_feedback(
    message_id: str,
    payload: FeedbackIn,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    ai_service.add_feedback(
        db, current_user, message_id, payload.score, payload.comment
    )
    db.commit()
    return {"message": "感谢反馈，已记录"}


@router.get("/feedback/summary", summary="AI 回答满意度统计")
def feedback_summary(db: DbSession, _current: CurrentUser) -> dict:
    return ai_service.feedback_summary(db)


class ReportScheduleIn(BaseModel):
    enabled: bool = True
    daily_time: str = Field(default="08:30", pattern=r"^\d{2}:\d{2}$")


@router.get("/report-schedule", summary="AI 报告定时生成设置")
def get_report_schedule(db: DbSession, current_user: CurrentUser) -> dict:
    return ai_service.get_report_schedule(db, current_user)


@router.put("/report-schedule", summary="保存 AI 报告定时生成设置")
def update_report_schedule(
    payload: ReportScheduleIn, db: DbSession, current_user: CurrentUser
) -> dict:
    result = ai_service.update_report_schedule(
        db, current_user, enabled=payload.enabled, daily_time=payload.daily_time
    )
    db.commit()
    return result


@router.post("/optimize/replenishment", summary="补货比价选商（价格优先）")
def optimize_replenishment(db: DbSession, _current: CurrentUser) -> dict:
    return ai_service.optimize_replenishment(db)


@router.post("/chat", response_model=ChatResponse, summary="与 AI 主 Agent 对话")
def chat(payload: ChatRequest, db: DbSession, current_user: CurrentUser) -> ChatResponse:
    result = ai_service.chat(db, current_user, payload)
    db.commit()
    return result


@router.post("/chat/stream", summary="与 AI 主 Agent 对话（SSE 逐字输出）")
async def chat_stream(
    payload: ChatRequest, db: DbSession, current_user: CurrentUser
) -> StreamingResponse:
    """先跑完 Agent（工具调用 + 落库），再把答案逐字推给前端。

    规则引擎本身是同步的，这里做「结果分片推送」，前端体验和小助手一致；
    将来接真 LLM 时，把分片来源换成模型流即可。
    """
    result = ai_service.chat(db, current_user, payload)
    db.commit()

    message = result.assistant_message
    text = (message.content or message.conclusion or "").strip()
    done_payload = {
        "done": True,
        "conversation_id": result.conversation_id,
        "message": message.model_dump(mode="json"),
        "task": result.task.model_dump(mode="json"),
        "confirmation": (
            result.confirmation.model_dump(mode="json") if result.confirmation else None
        ),
    }

    async def event_stream() -> AsyncIterator[str]:
        yield _sse({"conversation_id": result.conversation_id, "message_id": message.id})
        step = 8
        for index in range(0, len(text), step):
            yield _sse({"delta": text[index : index + step]})
            await asyncio.sleep(0.015)
        yield _sse(done_payload)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get(
    "/conversations", response_model=Page[ConversationOut], summary="我的会话列表"
)
def list_conversations(
    db: DbSession, current_user: CurrentUser, paging: PageParams
) -> Page[ConversationOut]:
    items, total = ai_service.list_conversations(
        db, current_user, page=paging.page, page_size=paging.page_size
    )
    return Page[ConversationOut].build(items, total, paging.page, paging.page_size)


@router.post(
    "/conversations",
    response_model=ConversationOut,
    status_code=status.HTTP_201_CREATED,
    summary="新建会话",
)
def create_conversation(
    payload: ConversationCreate, db: DbSession, current_user: CurrentUser
) -> ConversationOut:
    conversation = ai_service.create_conversation(
        db,
        current_user,
        title=payload.title or "新对话",
        context_type=payload.context_type,
        context_id=payload.context_id,
        context_label=payload.context_label,
    )
    db.commit()
    db.refresh(conversation)
    return ai_service.conversation_to_out(conversation)


@router.get("/conversations/{conversation_id}", response_model=ConversationOut, summary="会话详情")
def get_conversation(
    conversation_id: str, db: DbSession, current_user: CurrentUser
) -> ConversationOut:
    conversation = ai_service.get_conversation(db, conversation_id, current_user)
    return ai_service.conversation_to_out(conversation)


@router.patch("/conversations/{conversation_id}", response_model=ConversationOut, summary="重命名会话")
def update_conversation(
    conversation_id: str, payload: ConversationUpdate, db: DbSession, current_user: CurrentUser
) -> ConversationOut:
    conversation = ai_service.get_conversation(db, conversation_id, current_user)
    ai_service.update_conversation(db, conversation, payload.title)
    db.commit()
    db.refresh(conversation)
    return ai_service.conversation_to_out(conversation)


@router.delete(
    "/conversations/{conversation_id}",
    response_model=MessageOut,
    summary="删除会话",
)
def delete_conversation(
    conversation_id: str, db: DbSession, current_user: CurrentUser
) -> MessageOut:
    conversation = ai_service.get_conversation(db, conversation_id, current_user)
    ai_service.delete_conversation(db, conversation)
    db.commit()
    return MessageOut(message="会话已删除")


@router.get("/tasks", response_model=Page[TaskOut], summary="Agent 任务列表")
def list_tasks(
    db: DbSession,
    current_user: CurrentUser,
    paging: PageParams,
    task_type: Annotated[str | None, Query(description="任务类型")] = None,
    task_status: Annotated[
        str | None, Query(alias="status", description="pending/running/waiting_confirm/done/failed")
    ] = None,
    mine: Annotated[bool, Query(description="只看我的任务")] = True,
) -> Page[TaskOut]:
    items, total = ai_service.list_tasks(
        db,
        user=current_user if mine else None,
        task_type=task_type,
        status=task_status,
        page=paging.page,
        page_size=paging.page_size,
    )
    return Page[TaskOut].build(items, total, paging.page, paging.page_size)


@router.get("/tasks/{task_id}", response_model=TaskOut, summary="任务详情")
def get_task(task_id: str, db: DbSession, current_user: CurrentUser) -> TaskOut:
    task = ai_service.get_task(db, task_id, current_user)
    return ai_service.task_to_out(task)


@router.post("/tasks/{task_id}/confirm", summary="确认 AI 生成的采购草稿")
def confirm_task(
    task_id: str, payload: ConfirmationCreate, db: DbSession, current_user: CurrentUser
) -> dict:
    result = ai_service.confirm_task(db, task_id, payload, current_user)
    db.commit()
    return result


@router.post("/tasks/{task_id}/cancel", response_model=TaskOut, summary="取消任务")
def cancel_task(task_id: str, db: DbSession, current_user: CurrentUser) -> TaskOut:
    ai_service.cancel_task(db, task_id, current_user)
    db.commit()
    task = ai_service.get_task(db, task_id, current_user)
    return ai_service.task_to_out(task)


@router.get("/reports", response_model=Page[ReportBrief], summary="AI 报告列表")
def list_reports(
    db: DbSession,
    _current: CurrentUser,
    paging: PageParams,
    report_type: Annotated[
        str | None,
        Query(alias="type", description="replenishment / supplier_risk / logistics_anomaly"),
    ] = None,
    keyword: Annotated[str | None, Query(description="标题或对象名称")] = None,
) -> Page[ReportBrief]:
    items, total = ai_service.list_reports(
        db,
        report_type=report_type,
        keyword=keyword,
        page=paging.page,
        page_size=paging.page_size,
    )
    return Page[ReportBrief].build(items, total, paging.page, paging.page_size)


@router.get("/reports/{report_id}", response_model=ReportOut, summary="报告详情")
def get_report(report_id: str, db: DbSession, _current: CurrentUser) -> ReportOut:
    report = ai_service.get_report(db, report_id)
    return ai_service.report_to_out(report)


@router.get(
    "/analysis-capabilities",
    response_model=list[AnalysisCapability],
    summary="AI 分析能力清单",
)
def analysis_capabilities(_current: CurrentUser) -> list[AnalysisCapability]:
    return [AnalysisCapability(**item) for item in ai_service.capabilities()["analysis"]]


@router.post(
    "/analyze/inventory", response_model=AnalysisResponse, summary="库存与补货分析报告"
)
def analyze_inventory(db: DbSession, current_user: CurrentUser) -> AnalysisResponse:
    result = ai_service.analyze_inventory(db, current_user)
    db.commit()
    return result


@router.post("/analyze/purchase", response_model=AnalysisResponse, summary="采购辅助分析")
def analyze_purchase(db: DbSession, current_user: CurrentUser) -> AnalysisResponse:
    result = ai_service.analyze_purchase(db, current_user)
    db.commit()
    return result


@router.post(
    "/analyze/supplier", response_model=AnalysisResponse, summary="供应商风险分析"
)
def analyze_supplier(
    db: DbSession,
    current_user: CurrentUser,
    supplier_id: Annotated[str | None, Query(description="供应商ID，缺省取风险最高的一家")] = None,
) -> AnalysisResponse:
    result = ai_service.analyze_supplier(db, current_user, supplier_id=supplier_id)
    db.commit()
    return result


@router.post(
    "/analyze/logistics/{logistics_id}",
    response_model=AnalysisResponse,
    summary="物流异常分析报告",
)
def analyze_logistics(
    logistics_id: str, db: DbSession, current_user: CurrentUser
) -> AnalysisResponse:
    result = ai_service.analyze_logistics(db, current_user, logistics_id)
    db.commit()
    return result
