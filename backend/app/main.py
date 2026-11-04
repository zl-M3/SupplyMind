"""FastAPI 应用入口。

启动流程：
1. 初始化日志
2. 探测数据库连接（MySQL）
3. 自动建表（AUTO_CREATE_TABLES）
4. 空库写入演示数据（AUTO_SEED_DEMO_DATA）

本地启动::

    python run.py
    # 或
    uvicorn app.main:app --reload --port 8000

接口文档：http://127.0.0.1:8000/docs
"""

from __future__ import annotations

import json
import logging
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.api.v1 import api_router
from app.core.config import settings
from app.core.database import SessionLocal, check_connection, create_all_tables
from app.core.errors import AppError
from app.core.log import setup_logging
from app.seed import seed_demo_data
from app.services.user_service import ensure_default_accounts
from app.services.system_service import ensure_default_configs

logger = logging.getLogger(__name__)

TAGS_METADATA = [
    {"name": "认证与用户", "description": "登录、当前用户、密码与账号管理"},
    {"name": "工作台", "description": "KPI、趋势、待办、预警与 AI 洞察"},
    {"name": "采购管理-供应商", "description": "供应商主数据与履约统计"},
    {"name": "采购管理-采购订单", "description": "草稿 → 待审批 → 已审批 → 部分收货 → 已完成"},
    {"name": "采购管理-物流跟踪", "description": "物流节点、延迟标记与异常处理"},
    {"name": "商品与库存-商品", "description": "商品主数据、库存分布与流水"},
    {"name": "商品与库存-仓库", "description": "仓库主数据与库存明细"},
    {"name": "商品与库存-库存", "description": "库存总览、预警、流水与补货建议"},
    {"name": "商品与库存-调拨", "description": "跨仓调拨，扣减与增加在同一事务内完成"},
    {"name": "AI 智能中心", "description": "对话、Agent 任务、分析报告、白名单工具与知识库"},
]


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN201
    setup_logging("DEBUG" if settings.DEBUG else "INFO")
    logger.info("=" * 78)
    logger.info("%s v%s 启动中 ...", settings.APP_NAME, settings.APP_VERSION)
    logger.info("数据库: %s", settings.database_url_safe)

    ok, info = check_connection()
    if not ok:
        logger.error("数据库连接失败：%s", info)
        logger.error(
            "请先执行 `python scripts/init_mysql.py` 创建数据库，"
            "或在 .env 中修正 DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME"
        )
        raise RuntimeError(f"数据库不可用: {info}")
    logger.info("数据库连接成功，版本 %s", info)

    if settings.AUTO_CREATE_TABLES:
        create_all_tables()
        logger.info("表结构检查完成（create_all，缺失则自动创建）")

    with SessionLocal() as db:
        try:
            created = ensure_default_accounts(db)
            db.commit()
            if created:
                logger.info("已补齐默认账号: %s", ", ".join(created))
            count = ensure_default_configs(db)
            db.commit()
            if count:
                logger.info("已补齐默认系统参数 %d 项", count)
        except Exception:  # noqa: BLE001 - 初始化失败不应阻断服务启动
            db.rollback()
            logger.exception("默认账号/参数初始化失败（已回滚），服务继续启动")

    if settings.AUTO_SEED_DEMO_DATA:
        with SessionLocal() as db:
            try:
                if seed_demo_data(db):
                    logger.info("演示数据写入完成")
            except Exception:  # noqa: BLE001 - 种子失败不应阻断服务启动
                db.rollback()
                logger.exception("演示数据初始化失败（已回滚），服务继续启动")

    mode = "LLM" if settings.llm_ready else "规则引擎兜底（未配置 OPENAI_API_KEY）"
    logger.info("AI 模式: %s", mode)
    logger.info("接口文档: http://127.0.0.1:8000/docs")
    logger.info("=" * 78)

    # 定时报告：每分钟检查一次有没有到点的订阅
    async def _report_loop() -> None:
        from app.services import ai_service

        while True:
            try:
                await asyncio.sleep(60)
                with SessionLocal() as loop_db:
                    count = ai_service.run_due_report_schedules(loop_db)
                    if count:
                        logger.info("定时报告已生成 %d 份", count)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                logger.exception("定时报告循环异常")

    scheduler = asyncio.create_task(_report_loop())

    yield

    scheduler.cancel()
    logger.info("%s 已停止", settings.APP_NAME)


app = FastAPI(
    title=f"{settings.APP_NAME} API",
    version=settings.APP_VERSION,
    description=settings.APP_DESCRIPTION,
    openapi_tags=TAGS_METADATA,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_store_for_api(request: Request, call_next):  # noqa: ANN001, ANN201
    """业务接口一律不缓存。

    数据在库里改了、前端却还看到旧值，很大一部分原因就是中间层
    （浏览器 / 代理 / 二次封装网关）对 GET 做了缓存。这里显式禁用，
    保证每次请求都回源到数据库。
    """
    response = await call_next(request)
    if request.url.path.startswith(settings.API_V1_PREFIX):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


# --------------------------------------------------------------------------- #
# 全局异常处理：统一 {code, message, detail} 结构
# --------------------------------------------------------------------------- #


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    logger.warning("[业务异常] %s %s -> %s(%s): %s", request.method, request.url.path, exc.status_code, exc.code, exc.message)
    return JSONResponse(status_code=exc.status_code, content=exc.to_dict())


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    # pydantic v2 的 errors() 里 ctx 可能是 ValueError 实例（自定义校验器抛的），
    # 直接塞进 JSONResponse 会二次抛“not JSON serializable”，把 422 变成 500。
    detail = json.loads(json.dumps(exc.errors(), default=str, ensure_ascii=False))
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "code": "VALIDATION_ERROR",
            "message": "请求参数校验失败",
            "detail": detail,
        },
    )


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError) -> JSONResponse:
    logger.warning("[数据完整性] %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={
            "code": "DATA_INTEGRITY_ERROR",
            "message": "数据冲突，可能违反了唯一约束或外键约束",
            "detail": str(exc.orig) if getattr(exc, "orig", None) else None,
        },
    )


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_error_handler(request: Request, exc: SQLAlchemyError) -> JSONResponse:
    logger.exception("[数据库异常] %s", request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "code": "DATABASE_ERROR",
            "message": "数据库操作失败，请稍后重试",
            "detail": str(exc) if settings.DEBUG else None,
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("[未处理异常] %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "code": "INTERNAL_ERROR",
            "message": "服务器内部错误",
            "detail": str(exc) if settings.DEBUG else None,
        },
    )


# --------------------------------------------------------------------------- #
# 基础路由
# --------------------------------------------------------------------------- #


@app.get("/", tags=["系统"], summary="服务信息")
def root() -> dict:
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "description": settings.APP_DESCRIPTION,
        "docs": "/docs",
        "api_prefix": settings.API_V1_PREFIX,
        "ai_mode": "llm" if settings.llm_ready else "rule",
    }


@app.get("/health", tags=["系统"], summary="健康检查")
def health() -> dict:
    ok, info = check_connection()
    return {
        "status": "ok" if ok else "degraded",
        "database": settings.database_url_safe,
        "database_ok": ok,
        "database_version": info,
        "ai_mode": "llm" if settings.llm_ready else "rule",
        "ai_model": settings.OPENAI_MODEL if settings.llm_ready else None,
        "version": settings.APP_VERSION,
    }


app.include_router(api_router, prefix=settings.API_V1_PREFIX)
