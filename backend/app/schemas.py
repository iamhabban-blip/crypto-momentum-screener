"""Request and response models (the API contract)."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .models import Regime, Role, RunStatus


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ── Auth ──────────────────────────────────────────────────────────────────────

class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: "UserOut"


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)


class UserOut(ORM):
    id: uuid.UUID
    email: str
    full_name: str
    role: Role
    is_active: bool
    locked_until: datetime | None = None
    last_login_at: datetime | None = None
    created_at: datetime


class UserCreateIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    role: Role = Role.viewer
    password: str = Field(min_length=1, max_length=128)


class UserUpdateIn(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    role: Role | None = None
    is_active: bool | None = None


class ResetPasswordIn(BaseModel):
    new_password: str = Field(min_length=1, max_length=128)


# ── Screener ──────────────────────────────────────────────────────────────────

class SignalOut(ORM):
    symbol: str
    rank: int | None
    score: float
    passed_gates: bool
    gate_reason: str | None
    components: dict
    close: float
    rsi: float | None
    rvol: float | None
    ret_1d: float | None
    ret_7d: float | None
    stop_price: float | None
    exit_level: float | None


class ScanRunOut(ORM):
    id: int
    candle_time: datetime
    finished_at: datetime | None
    status: RunStatus
    regime: Regime | None
    btc_close: float | None
    btc_sma200d: float | None
    coins_total: int
    coins_passed: int
    weights: dict


class LatestScanOut(BaseModel):
    run: ScanRunOut | None
    signals: list[SignalOut]


class CandleOut(BaseModel):
    t: datetime
    o: float
    h: float
    l: float
    c: float
    v: float


class SymbolDetailOut(BaseModel):
    symbol: str
    signal: SignalOut | None
    candles: list[CandleOut]
    score_history: list[dict]
    on_watchlist: bool


class WatchlistIn(BaseModel):
    symbol: str = Field(min_length=2, max_length=32, pattern=r"^[A-Z0-9]+$")
    note: str | None = Field(default=None, max_length=280)


class WatchlistOut(ORM):
    symbol: str
    note: str | None
    created_at: datetime
    score: float | None = None
    close: float | None = None
    ret_1d: float | None = None


# ── Settings ──────────────────────────────────────────────────────────────────

FACTORS = ("trend", "volume", "relative_strength", "breakout", "rsi", "no_chase")


class ScreenerSettings(BaseModel):
    min_quote_volume_24h: float = Field(ge=0, le=1e11)
    min_history_days: int = Field(ge=1, le=365)
    regime_mode: str = Field(pattern="^(flag|suppress)$")
    weights: dict[str, float]

    @field_validator("weights")
    @classmethod
    def weights_valid(cls, w: dict[str, float]) -> dict[str, float]:
        if set(w) != set(FACTORS):
            raise ValueError(f"weights must have exactly these keys: {', '.join(FACTORS)}")
        if any(v < 0 for v in w.values()):
            raise ValueError("weights can't be negative")
        if abs(sum(w.values()) - 100) > 0.01:
            raise ValueError("weights must add up to 100")
        return w


# ── Backtests & audit ─────────────────────────────────────────────────────────

class BacktestIn(BaseModel):
    days: int = Field(default=365, ge=60, le=1095)
    top_k: int = Field(default=5, ge=1, le=20)
    hold_hours: int = Field(default=72, ge=6, le=336)
    min_score: float = Field(default=60, ge=0, le=100)
    fee_pct: float = Field(default=0.1, ge=0, le=1)
    regime_filter: bool = True


class BacktestOut(ORM):
    id: int
    created_at: datetime
    finished_at: datetime | None
    status: RunStatus
    params: dict
    metrics: dict | None
    equity_curve: list | None
    error: str | None


class AuditOut(ORM):
    id: int
    actor_email: str | None
    action: str
    target: str | None
    ip: str | None
    meta: dict
    created_at: datetime


class Page(BaseModel):
    total: int
    items: list


TokenOut.model_rebuild()
