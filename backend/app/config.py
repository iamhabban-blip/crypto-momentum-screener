"""Application settings, read from environment variables (see .env.example)."""

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Database -----------------------------------------------------------
    # The API and worker connect as the least-privileged `trendscope_app` role.
    database_url: str = "postgresql+psycopg://trendscope_app:app@localhost:5432/trendscope"
    # Migrations run as the schema owner (DDL rights). Never used by the API at runtime.
    migration_database_url: str | None = None
    db_pool_size: int = 10
    db_statement_timeout_ms: int = 15_000

    # --- Auth ---------------------------------------------------------------
    jwt_secret: str = Field(min_length=32)
    jwt_issuer: str = "trendscope"
    jwt_audience: str = "trendscope-web"
    access_token_minutes: int = 15
    refresh_token_days: int = 7
    max_failed_logins: int = 5
    lockout_minutes: int = 15
    login_rate_per_minute: int = 10  # per client IP
    cookie_secure: bool = True  # set False only for plain-http local development

    # First admin, created on startup if no admin exists yet.
    bootstrap_admin_email: str | None = None
    bootstrap_admin_password: str | None = None

    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:8080"]

    # --- Market data --------------------------------------------------------
    binance_base_url: str = "https://api.binance.com"

    @field_validator("jwt_secret")
    @classmethod
    def secret_not_placeholder(cls, v: str) -> str:
        if "change-me" in v.lower():
            raise ValueError("JWT_SECRET is still the placeholder value - generate a real one")
        return v

    @property
    def migrations_url(self) -> str:
        return self.migration_database_url or self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
