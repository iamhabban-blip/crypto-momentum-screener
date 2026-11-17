"""Database schema. Every table, constraint and index lives here; Alembic migrations mirror it."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, DateTime, Enum, Float, ForeignKey, Index, Integer,
    String, Text, UniqueConstraint, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Role(str, enum.Enum):
    viewer = "viewer"    # read signals, own watchlist
    analyst = "analyst"  # + run backtests
    admin = "admin"      # + manage users, settings, read audit log


class Regime(str, enum.Enum):
    risk_on = "risk_on"
    risk_off = "risk_off"


class RunStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


def _now_default():
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ── Identity & access ─────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        Index("uq_users_email_lower", func.lower(text("email")), unique=True),
        CheckConstraint("failed_login_count >= 0", name="ck_users_failed_login_count"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[Role] = mapped_column(Enum(Role, name="user_role"), nullable=False, default=Role.viewer)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    failed_login_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    password_changed_at: Mapped[datetime] = _now_default()
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _now_default()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class RefreshToken(Base):
    """Opaque refresh tokens. Only a SHA-256 hash is stored; tokens rotate on every use.
    All tokens from one login share a family_id so a replayed (stolen) token can kill the whole family."""
    __tablename__ = "refresh_tokens"
    __table_args__ = (Index("ix_refresh_tokens_user", "user_id"), Index("ix_refresh_tokens_family", "family_id"))

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    family_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    issued_at: Mapped[datetime] = _now_default()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # rotated | logout | reuse_detected | password_change | admin | expired
    revoked_reason: Mapped[str | None] = mapped_column(String(24))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    ip: Mapped[str | None] = mapped_column(String(64))


class AuditLog(Base):
    """Append-only: a database trigger rejects UPDATE and DELETE (see migration 0001)."""
    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_log_created", "created_at"), Index("ix_audit_log_user", "user_id"))

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_email: Mapped[str | None] = mapped_column(String(254))
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target: Mapped[str | None] = mapped_column(String(255))
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    meta: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = _now_default()


# ── Market data ───────────────────────────────────────────────────────────────

class Symbol(Base):
    __tablename__ = "symbols"

    symbol: Mapped[str] = mapped_column(String(32), primary_key=True)
    base_asset: Mapped[str] = mapped_column(String(24), nullable=False)
    quote_asset: Mapped[str] = mapped_column(String(12), nullable=False)
    is_trading: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    quote_volume_24h: Mapped[float | None] = mapped_column(Float)
    price_change_pct_24h: Mapped[float | None] = mapped_column(Float)
    last_price: Mapped[float | None] = mapped_column(Float)
    first_candle_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class Candle(Base):
    """Closed candles only - the still-forming candle is never stored."""
    __tablename__ = "candles"
    __table_args__ = (
        CheckConstraint("high >= low", name="ck_candles_high_low"),
        CheckConstraint("volume >= 0", name="ck_candles_volume"),
    )

    symbol: Mapped[str] = mapped_column(ForeignKey("symbols.symbol", ondelete="CASCADE"), primary_key=True)
    interval: Mapped[str] = mapped_column(String(4), primary_key=True)
    open_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    open: Mapped[float] = mapped_column(Float, nullable=False)
    high: Mapped[float] = mapped_column(Float, nullable=False)
    low: Mapped[float] = mapped_column(Float, nullable=False)
    close: Mapped[float] = mapped_column(Float, nullable=False)
    volume: Mapped[float] = mapped_column(Float, nullable=False)
    quote_volume: Mapped[float] = mapped_column(Float, nullable=False)


# ── Screener output ───────────────────────────────────────────────────────────

class ScanRun(Base):
    __tablename__ = "scan_runs"
    __table_args__ = (Index("ix_scan_runs_candle_time", "candle_time"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    candle_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    started_at: Mapped[datetime] = _now_default()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[RunStatus] = mapped_column(Enum(RunStatus, name="run_status"), nullable=False)
    regime: Mapped[Regime | None] = mapped_column(Enum(Regime, name="market_regime"))
    btc_close: Mapped[float | None] = mapped_column(Float)
    btc_sma200d: Mapped[float | None] = mapped_column(Float)
    coins_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    coins_passed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    weights: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    error: Mapped[str | None] = mapped_column(Text)

    signals: Mapped[list["Signal"]] = relationship(back_populates="run", cascade="all, delete-orphan")


class Signal(Base):
    __tablename__ = "signals"
    __table_args__ = (
        UniqueConstraint("scan_run_id", "symbol", name="uq_signals_run_symbol"),
        CheckConstraint("score >= 0 AND score <= 100", name="ck_signals_score_range"),
        Index("ix_signals_symbol", "symbol"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    scan_run_id: Mapped[int] = mapped_column(ForeignKey("scan_runs.id", ondelete="CASCADE"), nullable=False)
    symbol: Mapped[str] = mapped_column(ForeignKey("symbols.symbol", ondelete="CASCADE"), nullable=False)
    rank: Mapped[int | None] = mapped_column(Integer)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    passed_gates: Mapped[bool] = mapped_column(Boolean, nullable=False)
    gate_reason: Mapped[str | None] = mapped_column(String(120))
    components: Mapped[dict] = mapped_column(JSONB, nullable=False)  # per-factor score + raw values
    close: Mapped[float] = mapped_column(Float, nullable=False)
    rsi: Mapped[float | None] = mapped_column(Float)
    rvol: Mapped[float | None] = mapped_column(Float)
    ret_1d: Mapped[float | None] = mapped_column(Float)
    ret_7d: Mapped[float | None] = mapped_column(Float)
    stop_price: Mapped[float | None] = mapped_column(Float)
    exit_level: Mapped[float | None] = mapped_column(Float)

    run: Mapped[ScanRun] = relationship(back_populates="signals")


# ── User data & configuration ─────────────────────────────────────────────────

class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    symbol: Mapped[str] = mapped_column(ForeignKey("symbols.symbol", ondelete="CASCADE"), primary_key=True)
    note: Mapped[str | None] = mapped_column(String(280))
    created_at: Mapped[datetime] = _now_default()


class AppSetting(Base):
    """Admin-editable screener settings (weights, filters). Every change is audit-logged."""
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class BacktestRun(Base):
    __tablename__ = "backtest_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _now_default()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[RunStatus] = mapped_column(Enum(RunStatus, name="run_status"), nullable=False)
    params: Mapped[dict] = mapped_column(JSONB, nullable=False)
    metrics: Mapped[dict | None] = mapped_column(JSONB)
    equity_curve: Mapped[list | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
