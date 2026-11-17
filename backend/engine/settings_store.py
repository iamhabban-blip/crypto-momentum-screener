"""Reads admin-editable screener settings from the app_settings table (with safe defaults)."""

from sqlalchemy.orm import Session

from app.models import AppSetting

from .scoring import DEFAULT_WEIGHTS, ScreenerConfig

SETTINGS_KEY = "screener"
DEFAULTS = {"min_quote_volume_24h": 2_000_000, "min_history_days": 30, "regime_mode": "flag",
            "weights": dict(DEFAULT_WEIGHTS)}


def load_config(db: Session) -> ScreenerConfig:
    row = db.get(AppSetting, SETTINGS_KEY)
    values = {**DEFAULTS, **(row.value if row else {})}
    return ScreenerConfig(**values)
