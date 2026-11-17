"""The screener's rules.

Gates (must all pass to be ranked)
    * liquidity: 24h quote volume >= min_quote_volume_24h
    * history:   at least min_history_days of 1h candles
    * regime:    BTC above its 200-day average = risk-on. In risk-off, signals are flagged
                 ("flag") or not ranked at all ("suppress").

Score 0-100 = weighted sum of six factor scores, each between 0 and 1
    trend             time-series momentum: 1d/3d/7d returns > 0, price above rising EMA50/EMA200
    volume            RVOL vs the previous 249 hours - counts only on an up candle
    relative_strength 7-day return minus BTC's 7-day return (+20 percentage points = full marks)
    breakout          close above the 72h / 7-day high
    rsi               RSI(14) in the 50-70 sweet spot; overheated (>80) or weak (<45) scores 0
    no_chase          penalises >20-30% pumps in 24h and extreme volatility

Risk levels shown with every signal: stop = close - 2 x ATR(14); trend exit = close below EMA50.

Everything is vectorised over the whole candle history, so the live scanner (last row) and the
backtest (every row) run exactly the same code.
"""

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .indicators import atr, ema, rsi

FACTORS = ("trend", "volume", "relative_strength", "breakout", "rsi", "no_chase")
DEFAULT_WEIGHTS = {"trend": 30, "volume": 20, "relative_strength": 15, "breakout": 15, "rsi": 10, "no_chase": 10}
RVOL_LOOKBACK = 249
MIN_BARS = RVOL_LOOKBACK + 1 + 200  # enough for RVOL, 7-day returns and a settled EMA200


@dataclass
class ScreenerConfig:
    min_quote_volume_24h: float = 2_000_000
    min_history_days: int = 30
    regime_mode: str = "flag"  # or "suppress"
    weights: dict = field(default_factory=lambda: dict(DEFAULT_WEIGHTS))


def features(df: pd.DataFrame, btc_close: pd.Series) -> pd.DataFrame:
    """df: 1h candles indexed by open_time with open/high/low/close/volume/quote_volume.
    btc_close: BTCUSDT 1h closes on the same kind of index."""
    c, o, h = df["close"], df["open"], df["high"]
    f = pd.DataFrame(index=df.index)
    f["close"] = c
    f["ret_1d"] = c / c.shift(24) - 1
    f["ret_3d"] = c / c.shift(72) - 1
    f["ret_7d"] = c / c.shift(168) - 1
    f["ema50"] = ema(c, 50)
    f["ema200"] = ema(c, 200)
    f["ema50_rising"] = f["ema50"] > f["ema50"].shift(24)
    f["rvol"] = df["volume"] / df["volume"].shift(1).rolling(RVOL_LOOKBACK).mean()
    f["up_candle"] = c > o
    f["high_72h"] = h.shift(1).rolling(72).max()
    f["high_7d"] = h.shift(1).rolling(168).max()
    f["rsi"] = rsi(c, 14)
    f["atr"] = atr(h, df["low"], c, 14)
    f["atr_pct"] = f["atr"] / c
    f["quote_volume_24h"] = df["quote_volume"].rolling(24).sum()
    btc = btc_close.reindex(df.index).ffill()
    f["btc_ret_7d"] = btc / btc.shift(168) - 1
    f["bars"] = np.arange(1, len(df) + 1)
    return f


def components(f: pd.DataFrame) -> pd.DataFrame:
    """Each factor scored 0..1."""
    s = pd.DataFrame(index=f.index)
    returns_up = ((f["ret_1d"] > 0).astype(float) + (f["ret_3d"] > 0) + (f["ret_7d"] > 0)) / 3
    structure = ((f["close"] > f["ema50"]).astype(float) + (f["close"] > f["ema200"])
                 + (f["ema50"] > f["ema200"]) + f["ema50_rising"].astype(float)) / 4
    s["trend"] = 0.5 * returns_up + 0.5 * structure

    s["volume"] = np.where(f["up_candle"], ((f["rvol"] - 1) / 2).clip(0, 1), 0.0)

    s["relative_strength"] = ((f["ret_7d"] - f["btc_ret_7d"]) / 0.20).clip(0, 1)

    s["breakout"] = np.select(
        [f["close"] > f["high_7d"], f["close"] > f["high_72h"], f["close"] >= 0.98 * f["high_72h"]],
        [1.0, 0.6, 0.3], 0.0)

    r = f["rsi"]
    s["rsi"] = np.select(
        [(r >= 50) & (r <= 70), ((r >= 45) & (r < 50)) | ((r > 70) & (r <= 75)), (r > 75) & (r <= 80)],
        [1.0, 0.6, 0.3], 0.0)

    chase = np.select([f["ret_1d"] > 0.30, f["ret_1d"] > 0.20], [0.0, 0.5], 1.0)
    s["no_chase"] = np.where(f["atr_pct"] > 0.05, chase * 0.5, chase)

    # Rows without enough history have NaN inputs: never let them score.
    valid = f[["ret_7d", "ema200", "rvol", "high_7d", "rsi", "atr", "btc_ret_7d"]].notna().all(axis=1)
    s.loc[~valid, :] = np.nan
    return s


def total_score(comp: pd.DataFrame, weights: dict) -> pd.Series:
    w = pd.Series({k: float(weights[k]) for k in FACTORS})
    return (comp[list(FACTORS)] * w).sum(axis=1, min_count=len(FACTORS)) * (100 / w.sum())


def btc_regime(btc_daily_close: pd.Series) -> pd.DataFrame:
    """Risk-on when BTC's daily close is above its 200-day simple moving average."""
    sma = btc_daily_close.rolling(200).mean()
    return pd.DataFrame({"btc_close": btc_daily_close, "sma200": sma,
                         "risk_on": btc_daily_close > sma}, index=btc_daily_close.index)


def gate_reason(row: pd.Series, cfg: ScreenerConfig, history_days: float) -> str | None:
    if pd.isna(row.get("ret_7d")) or pd.isna(row.get("ema200")) or pd.isna(row.get("rvol")):
        return "Not enough candle history yet"
    if history_days < cfg.min_history_days:
        return f"Listed less than {cfg.min_history_days} days"
    if (row.get("quote_volume_24h") or 0) < cfg.min_quote_volume_24h:
        return "24h volume below filter"
    return None


def score_latest(df: pd.DataFrame, btc_close: pd.Series, cfg: ScreenerConfig, history_days: float) -> dict | None:
    """Score the newest closed candle of one coin. Returns None if there's no data at all."""
    if df.empty:
        return None
    f = features(df, btc_close)
    comp = components(f)
    last, c = f.iloc[-1], comp.iloc[-1]
    score = float(total_score(comp.iloc[[-1]], cfg.weights).iloc[0]) if c.notna().all() else 0.0
    reason = gate_reason(last, cfg, history_days)

    def num(x):
        return None if x is None or pd.isna(x) else float(x)

    detail = {
        k: {"score": num(c[k]), "weight": cfg.weights[k]} for k in FACTORS
    }
    detail["trend"]["raw"] = {"ret_1d": num(last["ret_1d"]), "ret_3d": num(last["ret_3d"]),
                              "ret_7d": num(last["ret_7d"]), "ema50": num(last["ema50"]),
                              "ema200": num(last["ema200"]), "ema50_rising": bool(last["ema50_rising"])}
    detail["volume"]["raw"] = {"rvol": num(last["rvol"]), "up_candle": bool(last["up_candle"])}
    detail["relative_strength"]["raw"] = {"ret_7d": num(last["ret_7d"]), "btc_ret_7d": num(last["btc_ret_7d"])}
    detail["breakout"]["raw"] = {"high_72h": num(last["high_72h"]), "high_7d": num(last["high_7d"])}
    detail["rsi"]["raw"] = {"rsi": num(last["rsi"])}
    detail["no_chase"]["raw"] = {"ret_1d": num(last["ret_1d"]), "atr_pct": num(last["atr_pct"])}

    close = float(last["close"])
    return {
        "score": round(max(0.0, min(100.0, score)), 2),
        "gate_reason": reason,
        "components": detail,
        "close": close,
        "rsi": num(last["rsi"]),
        "rvol": num(last["rvol"]),
        "ret_1d": num(last["ret_1d"]),
        "ret_7d": num(last["ret_7d"]),
        "stop_price": None if pd.isna(last["atr"]) else close - 2 * float(last["atr"]),
        "exit_level": num(last["ema50"]),
        "quote_volume_24h": num(last["quote_volume_24h"]),
    }
