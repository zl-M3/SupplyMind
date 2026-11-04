"""Dify 应用代理：把外部 Dify 聊天应用接进 SupplyMind。

为什么不直接在前端调 Dify：
1. Dify 的 /v1 接口是给服务端用的，浏览器直连会撞 CORS；
2. API 密钥不能出现在前端包里；
3. 这里还能顺手带上当前登录用户与页面上下文，并做超时与错误归一。

注意：Dify 的 Agent 类型应用**不支持 blocking 模式**，只能走 streaming，
所以这里统一用 SSE 转发，前端逐字渲染。
"""

from __future__ import annotations

import json
import logging
import socket
import time
from typing import Any, AsyncIterator
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, File, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.errors import AppError
from app.models.ai import AIConversation
from app.models.enums import MessageRole
from app.services import ai_service, attachment_service
from app.services.ai_service import strip_thinking

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai/dify", tags=["AI 智能助手（Dify）"])

# 可达性探测结果缓存，避免每次开面板都打网络
_probe_cache: dict[str, Any] = {"at": 0.0, "ok": False, "detail": ""}
_PROBE_TTL = 30.0

# Dify 流式事件里承载正文的类型（Agent 应用用 agent_message）
_TEXT_EVENTS = {"message", "agent_message"}


class DifyStatus(BaseModel):
    enabled: bool
    configured: bool
    reachable: bool
    base_url: str = ""
    detail: str = ""


class DifyChatIn(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    conversation_id: str = ""
    context: str = ""
    attachment_ids: list[str] = Field(default_factory=list, description="先调用 /upload 拿到的附件 ID")


def _base_url() -> str:
    return (settings.DIFY_API_BASE or "").rstrip("/")


def _configured() -> bool:
    return bool(_base_url() and (settings.DIFY_API_KEY or "").strip())


def _tcp_probe(host: str, port: int, timeout: float = 2.5) -> tuple[bool, str]:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, "TCP 连接成功"
    except OSError as exc:
        return False, f"{type(exc).__name__}: {exc}"


def _probe(force: bool = False) -> tuple[bool, str]:
    now = time.time()
    if not force and now - float(_probe_cache["at"]) < _PROBE_TTL:
        return bool(_probe_cache["ok"]), str(_probe_cache["detail"])

    parsed = urlparse(_base_url())
    host = parsed.hostname or ""
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    ok, detail = _tcp_probe(host, port)

    _probe_cache.update({"at": now, "ok": ok, "detail": detail})
    return ok, detail


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _find_or_create_conversation(
    db, user, query: str, dify_conversation_id: str
) -> AIConversation:
    """小助手也落库：同一个 Dify 会话对应同一个本地会话。"""
    conversation = None
    if dify_conversation_id:
        conversation = db.scalar(
            select(AIConversation).where(
                AIConversation.dify_conversation_id == dify_conversation_id,
                AIConversation.username == user.username,
            )
        )
    if conversation is None:
        conversation = ai_service.create_conversation(
            db, user, title=(query or "AI 小助手")[:120]
        )
    return conversation


def _persist_reply(
    conversation_id: str, dify_conversation_id: str | None, text: str
) -> None:
    """把一轮回复写进正式库（失败不影响对话本身）。"""
    content = (strip_thinking(text) or "").strip()
    if not content:
        return
    try:
        with SessionLocal() as session:
            conversation = session.get(AIConversation, conversation_id)
            if conversation is None:
                return
            if dify_conversation_id and not conversation.dify_conversation_id:
                conversation.dify_conversation_id = dify_conversation_id
            ai_service.add_message(
                session,
                conversation,
                role=MessageRole.ASSISTANT,
                content=content,
            )
            session.commit()
    except Exception:  # noqa: BLE001
        logger.exception("保存 Dify 对话历史失败")


@router.get("/status", response_model=DifyStatus, summary="Dify 助手配置与连通状态")
def dify_status(user: CurrentUser, force: bool = False) -> DifyStatus:
    del user
    configured = _configured()
    reachable = False
    detail = "未配置 DIFY_API_BASE / DIFY_API_KEY"
    if configured:
        reachable, detail = _probe(force)
    return DifyStatus(
        enabled=bool(settings.DIFY_ENABLED) and configured,
        configured=configured,
        reachable=reachable,
        base_url=_base_url(),
        detail=detail,
    )


@router.post("/upload", summary="上传资料给 AI 分析（PDF / Word / Excel / TXT）")
async def upload_attachment(
    user: CurrentUser, file: UploadFile = File(...)
) -> dict[str, Any]:
    del user
    content = await file.read()
    return attachment_service.save_upload(file.filename or "file", content)


@router.post("/chat/stream", summary="与 Dify 助手对话（SSE 流式）")
async def dify_chat_stream(
    payload: DifyChatIn, user: CurrentUser, db: DbSession
) -> StreamingResponse:
    if not _configured():
        raise AppError("Dify 助手未配置", code="DIFY_NOT_CONFIGURED", status_code=503)

    reachable, detail = _probe()
    if not reachable:
        raise AppError(
            f"Dify 助手不可达（{_base_url()}）：{detail}",
            code="DIFY_UNREACHABLE",
            status_code=503,
        )

    # 小助手对话也写进「AI 对话」历史：先落一条用户消息
    conversation = _find_or_create_conversation(
        db, user, payload.query, payload.conversation_id
    )
    ai_service.add_message(db, conversation, role=MessageRole.USER, content=payload.query)
    db.commit()
    conversation_id = conversation.id

    # 把页面上下文拼进问题，避免依赖对方应用的 inputs 定义
    query = payload.query
    if payload.context.strip():
        query = f"【当前页面：{payload.context.strip()}】\n{query}"

    # 上传的附件：抽出正文塞进问题（Dify 这个应用没开文件上传，走文本最稳）
    attachment_blocks: list[str] = []
    for token in payload.attachment_ids[:3]:
        loaded = attachment_service.load_attachment(token)
        if loaded is None:
            continue
        name, text = loaded
        attachment_blocks.append(f"--- 附件：{name} ---\n{text}\n--- 附件结束 ---")
    if attachment_blocks:
        query = (
            "【用户上传了资料，请先阅读资料，再结合资料回答；引用关键字段】\n"
            + "\n".join(attachment_blocks)
            + "\n\n【用户问题】\n"
            + query
        )

    # 统一要求「先给结果、别讲推理过程」——前端是窄气泡，输出太长太绕不好看
    query = (
        "【回答要求】先用一两句话给出结论，再给必要的数据（表格可以）；"
        "不要输出思考过程、推理步骤、自我说明或“我先分析一下”之类的话。\n" + query
    )

    body: dict[str, Any] = {
        "inputs": {},
        "query": query,
        "response_mode": "streaming",
        "user": user.username,
        "auto_generate_name": False,
    }
    if payload.conversation_id:
        body["conversation_id"] = payload.conversation_id

    url = f"{_base_url()}/v1/chat-messages"
    headers = {
        "Authorization": f"Bearer {settings.DIFY_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }

    async def event_stream() -> AsyncIterator[str]:
        conv_id = payload.conversation_id
        collected: list[str] = []
        # 过滤模型输出的 <think>…</think> 推理段（DeepSeek 等推理模型会带），
        # 标签可能被切在两个 chunk 里，所以留一个小的 carry 缓冲
        carry = ""
        in_think = False
        MARK_OPEN = "<think"
        MARK_CLOSE = "</think"

        def feed(chunk: str, final: bool = False) -> str:
            nonlocal carry, in_think
            carry += chunk
            out: list[str] = []
            while carry:
                if in_think:
                    idx = carry.find(MARK_CLOSE)
                    if idx >= 0:
                        end = carry.find(">", idx)
                        carry = carry[(end + 1) if end >= 0 else (idx + len(MARK_CLOSE)):]
                        in_think = False
                        continue
                    keep = 0
                    if not final:
                        for k in range(1, len(MARK_CLOSE)):
                            if carry.endswith(MARK_CLOSE[:k]):
                                keep = k
                                break
                    carry = carry[len(carry) - keep:] if keep else ""
                    break
                idx = carry.find(MARK_OPEN)
                if idx >= 0:
                    out.append(carry[:idx])
                    close = carry.find(">", idx)
                    if close < 0:
                        carry = carry[idx:]
                        break
                    carry = carry[close + 1:]
                    in_think = True
                    continue
                keep = 0
                if not final:
                    for k in range(1, len(MARK_OPEN)):
                        if carry.endswith(MARK_OPEN[:k]):
                            keep = k
                            break
                if keep:
                    out.append(carry[: len(carry) - keep])
                    carry = carry[len(carry) - keep:]
                else:
                    out.append(carry)
                    carry = ""
                break
            return "".join(out)

        try:
            async with httpx.AsyncClient(timeout=float(settings.DIFY_TIMEOUT_SECONDS)) as client:
                async with client.stream("POST", url, json=body, headers=headers) as resp:
                    if resp.status_code >= 400:
                        raw = (await resp.aread()).decode("utf-8", "ignore")[:300]
                        yield _sse({"error": f"Dify 返回 {resp.status_code}：{raw}"})
                        yield _sse({"done": True})
                        return

                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        raw = line[5:].strip()
                        if not raw or raw == "[DONE]":
                            continue
                        try:
                            evt = json.loads(raw)
                        except json.JSONDecodeError:
                            continue

                        if evt.get("conversation_id"):
                            conv_id = evt["conversation_id"]

                        name = evt.get("event")
                        if name in _TEXT_EVENTS:
                            delta = evt.get("answer") or ""
                            if delta:
                                visible = feed(delta)
                                if visible:
                                    collected.append(visible)
                                    yield _sse({"delta": visible, "conversation_id": conv_id})
                        elif name == "message_end":
                            tail = feed("", final=True)
                            if tail:
                                collected.append(tail)
                                yield _sse({"delta": tail, "conversation_id": conv_id})
                            _persist_reply(conversation_id, conv_id, "".join(collected))
                            yield _sse({"done": True, "conversation_id": conv_id})
                            return
                        elif name == "error":
                            yield _sse({"error": str(evt.get("message") or "Dify 执行出错")})
                            yield _sse({"done": True})
                            return

            _persist_reply(conversation_id, conv_id, "".join(collected))
            yield _sse({"done": True, "conversation_id": conv_id})
        except httpx.HTTPError as exc:
            yield _sse({"error": f"调用 Dify 失败：{type(exc).__name__}: {exc}"})
            yield _sse({"done": True})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )



