"""应用配置。

所有配置项均可通过环境变量或项目根目录下的 ``.env`` 文件覆盖。
环境变量名与字段名一致（不区分大小写）。
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from urllib.parse import quote_plus

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/ 目录
BASE_DIR = Path(__file__).resolve().parents[2]
APP_DIR = BASE_DIR / "app"
DATA_DIR = APP_DIR / "data"
KNOWLEDGE_DIR = DATA_DIR / "knowledge"


class Settings(BaseSettings):
    """全局配置。"""

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ------- 基础信息 -------
    APP_NAME: str = "SupplyMind"
    APP_VERSION: str = "1.0.0"
    APP_DESCRIPTION: str = "SupplyMind｜AI 智能供应链管理平台 MVP 后端"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api/v1"

    # ------- 数据库（MySQL） -------
    # 分项配置：留空 DATABASE_URL 时按下列分项自动拼装连接串
    DB_HOST: str = "127.0.0.1"
    DB_PORT: int = 3306
    DB_USER: str = "root"
    DB_PASSWORD: str = "1234"
    DB_NAME: str = "supplymind"
    DB_CHARSET: str = "utf8mb4"
    # 显式覆盖时优先使用；例如 mysql+pymysql://root:1234@127.0.0.1:3306/supplymind?charset=utf8mb4
    DATABASE_URL: str = ""
    DB_ECHO: bool = False
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_RECYCLE: int = 3600
    DB_POOL_TIMEOUT: int = 30

    # ------- 认证 -------
    SECRET_KEY: str = "supplymind-dev-secret-please-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 12

    # ------- 跨域 -------
    CORS_ORIGINS: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:4173"
    )

    # ------- LLM（AI Agent） -------
    # 留空则自动使用「规则引擎兜底模式」，全部 AI 场景仍可离线演示。
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.deepseek.com/v1"
    OPENAI_MODEL: str = "deepseek-chat"
    LLM_ENABLED: bool = True
    LLM_TIMEOUT_SECONDS: int = 45
    LLM_MAX_TOOL_ROUNDS: int = 6
    LLM_TEMPERATURE: float = 0.2

    # ---- 外部 Dify 应用（右下角 AI 小助手）----
    DIFY_ENABLED: bool = True
    DIFY_API_BASE: str = ""
    DIFY_API_KEY: str = ""
    DIFY_TIMEOUT_SECONDS: int = 60

    # ------- 启动行为 -------
    AUTO_CREATE_TABLES: bool = True
    AUTO_SEED_DEMO_DATA: bool = True

    # ------- 业务规则 -------
    # 供应商准时交付率的样本下限：交付过 1 单就可以算准时率，不要求大样本
    SUPPLIER_MIN_SAMPLE: int = 1
    # 工作台趋势图天数
    DASHBOARD_TREND_DAYS: int = 7

    @field_validator("DATABASE_URL")
    @classmethod
    def _normalize_url(cls, value: str) -> str:
        """清理空串，并把 Windows 反斜杠路径统一为正斜杠（兼容 SQLite 回退）。"""
        value = (value or "").strip()
        if value.startswith("sqlite") and "\\" in value:
            value = value.replace("\\", "/")
        return value

    # ------------------------------------------------------------------ #
    # 数据库连接
    # ------------------------------------------------------------------ #
    def database_url_with(self, db_name: str) -> str:
        """按分项配置拼装 MySQL 连接串（可指定库名）。"""
        password = quote_plus(self.DB_PASSWORD)
        user = quote_plus(self.DB_USER)
        return (
            f"mysql+pymysql://{user}:{password}@{self.DB_HOST}:{self.DB_PORT}"
            f"/{db_name}?charset={self.DB_CHARSET}"
        )

    @property
    def database_url(self) -> str:
        """最终使用的连接串：优先 DATABASE_URL，否则按分项拼装 MySQL。"""
        return self.DATABASE_URL or self.database_url_with(self.DB_NAME)

    @property
    def database_url_safe(self) -> str:
        """隐去密码的连接串，用于日志打印。"""
        url = self.database_url
        if "@" in url and "//" in url:
            prefix, _, rest = url.partition("//")
            credentials, _, tail = rest.partition("@")
            user, sep, _pwd = credentials.partition(":")
            return f"{prefix}//{user}{sep}******@{tail}"
        return url

    @property
    def MYSQL_DB_NAME(self) -> str:  # noqa: N802 - 供脚本/字典复用
        return self.DB_NAME

    @property
    def is_mysql(self) -> bool:
        return self.database_url.startswith("mysql")

    @property
    def cors_origins_list(self) -> list[str]:
        return [item.strip() for item in self.CORS_ORIGINS.split(",") if item.strip()]

    @property
    def llm_ready(self) -> bool:
        """是否具备调用真实 LLM 的条件。"""
        return bool(self.LLM_ENABLED and self.OPENAI_API_KEY.strip())

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
