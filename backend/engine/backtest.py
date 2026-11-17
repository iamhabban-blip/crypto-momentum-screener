"""Walk-forward backtest of the screener.

Every `hold_hours` (non-overlapping periods) the strategy buys the `top_k` coins scoring at least
`min_score`, holds them equal-weight for `hold_hours`, and pays `fee_pct` on entry and on exit.
In risk-off markets (BTC below its 200-day average) it holds cash when `regime_filter` is on.

Compared against:
    * universe  - equal-weight basket of every coin that passed the gates (what random picking gets you)
    * btc       - simply holding BTC

Walk-forward: several weight sets are evaluated; for each period the set that did best on ALL
EARLIER periods is used, so weights are never tuned on the data they're tested on.

Known limitation (stated in the results): the coin list is today's, so coins that were delisted
during the test window are missing (survivorship bias). This flatters both the strategy and the
universe baseline, so the comparison between them is still fair.
"""

import asyncio
import math
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Symbol

from .binance import Binance, ms_to_dt
from .scoring import DEFAULT_WEIGHTS, FACTORS, MIN_BARS, btc_regime, components, features
from .settings_store import load_config

MAX_COINS = 120


def weight_sets() -> dict[str, dict]:
    sets = {"default": dict(DEFAULT_WEIGHTS), "equal": {f: 100 / len(FACTORS) for f in FACTORS}}
    for f in FACTORS:
        w = dict(DEFAULT_WEIGHTS)
        donor = "volume" if f == "trend" else "trend"
        w[f] += 10
        w[donor] -= 10
        sets[f"more_{f}"] = w
    return sets


def _frame(rows: list[list]) -> pd.DataFrame:
    df = pd.DataFrame([r[:8] for r in rows], columns=["t", "open", "high", "low", "close", "volume", "ct", "quote_volume"])
    df["open_time"] = pd.to_datetime(df["t"], unit="ms", utc=True)
    for c in ["open", "high", "low", "close", "volume", "quote_volume"]:
        df[c] = df[c].astype(float)
    return df.set_index("open_time")[["open", "high", "low", "close", "volume", "quote_volume"]]


def build_panel(frames: dict[str, pd.DataFrame], btc_1h: pd.DataFrame, listing: dict, hold: int,
                min_quote_volume: float, min_history_days: int) -> pd.DataFrame:
    """One row per (time, coin): factor scores, gate result and forward return."""
    parts = []
    for symbol, df in frames.items():
        if len(df) < MIN_BARS + hold:
            continue
        f = features(df, btc_1h["close"])
        comp = components(f)
        p = comp.copy()
        p["fwd"] = df["close"].shift(-hold) / df["close"] - 1
        first = listing.get(symbol) or df.index[0]
        age_days = (df.index - first).total_seconds() / 86400
        p["gated"] = (f["quote_volume_24h"] >= min_quote_volume) & (age_days >= min_history_days) \
            & comp.notna().all(axis=1)
        p["symbol"] = symbol
        parts.append(p)
    panel = pd.concat(parts)
    panel.index.name = "t"
    return panel.reset_index()


def _stats(returns: pd.Series, periods_per_year: float) -> dict:
    r = returns.fillna(0)
    equity = (1 + r).cumprod()
    dd = (equity / equity.cummax() - 1).min()
    vol = r.std()
    return {
        "periods": int(len(r)),
        "avg_return_pct": round(float(r.mean() * 100), 3),
        "hit_rate_pct": round(float((r > 0).mean() * 100), 1),
        "total_return_pct": round(float((equity.iloc[-1] - 1) * 100), 2) if len(r) else 0.0,
        "max_drawdown_pct": round(float(dd * 100), 2) if len(r) else 0.0,
        "sharpe": round(float(r.mean() / vol * math.sqrt(periods_per_year)), 2) if vol and vol > 0 else None,
    }


def simulate(panel: pd.DataFrame, btc_1h: pd.DataFrame, btc_daily: pd.Series, *, days: int, top_k: int,
             hold_hours: int, min_score: float, fee_pct: float, regime_filter: bool,
             end: datetime | None = None) -> tuple[dict, list]:
    end = end or panel["t"].max()
    start = end - timedelta(days=days)
    times = pd.date_range(start.floor("h"), end - timedelta(hours=hold_hours), freq=f"{hold_hours}h", tz="UTC")
    regime = btc_regime(btc_daily)
    regime.index = regime.index + timedelta(days=1)  # a daily close is only known after the day ends
    cost = 2 * fee_pct / 100
    sets = weight_sets()

    by_time = {t: g for t, g in panel[panel["t"].isin(times) & panel["gated"]].groupby("t")}
    btc_close = btc_1h["close"]
    rows = []
    for t in times:
        g = by_time.get(t)
        reg = regime[regime.index <= t].tail(1)
        risk_on = True if reg.empty or pd.isna(reg["sma200"].iloc[0]) else bool(reg["risk_on"].iloc[0])
        btc_fwd = (btc_close.get(t + timedelta(hours=hold_hours)) / btc_close.get(t) - 1
                   if t in btc_close.index and (t + timedelta(hours=hold_hours)) in btc_close.index else np.nan)
        row = {"t": t, "risk_on": risk_on, "btc": btc_fwd, "coins": 0 if g is None else len(g)}
        if g is None or g.empty:
            row.update({"universe": 0.0, **{k: 0.0 for k in sets}})
            rows.append(row)
            continue
        row["universe"] = g["fwd"].mean() - cost
        for name, w in sets.items():
            ws = pd.Series(w)
            score = (g[list(FACTORS)] * ws).sum(axis=1) * (100 / ws.sum())
            picks = g.assign(score=score)
            picks = picks[picks["score"] >= min_score].nlargest(top_k, "score")
            if picks.empty or (regime_filter and not risk_on):
                row[name] = 0.0  # in cash
            else:
                row[name] = picks["fwd"].mean() - cost
        rows.append(row)

    res = pd.DataFrame(rows).set_index("t")
    names = list(sets)
    # Anchored walk-forward: first 40% of periods only train; afterwards each period uses the
    # weight set with the best average excess return over all previous periods.
    warm = max(10, int(len(res) * 0.4))
    wf, chosen = [], []
    for i in range(len(res)):
        if i < warm:
            wf.append(np.nan)
            chosen.append(None)
            continue
        past = res.iloc[:i]
        best = max(names, key=lambda n: (past[n] - past["universe"]).mean())
        wf.append(res[best].iloc[i])
        chosen.append(best)
    res["walk_forward"] = wf
    res["chosen"] = chosen

    test = res.iloc[warm:]
    ppy = 365 * 24 / hold_hours
    metrics = {
        "window": {"start": test.index.min().isoformat() if len(test) else None,
                   "end": test.index.max().isoformat() if len(test) else None,
                   "training_periods": warm, "test_periods": len(test)},
        "walk_forward": _stats(test["walk_forward"], ppy),
        "default_weights": _stats(test["default"], ppy),
        "universe": _stats(test["universe"], ppy),
        "btc": _stats(test["btc"], ppy),
        "excess_vs_universe_pct": round(float((test["walk_forward"] - test["universe"]).mean() * 100), 3)
        if len(test) else None,
        "risk_off_periods": int((~test["risk_on"]).sum()),
        "avg_coins_per_period": round(float(test["coins"].mean()), 1) if len(test) else 0,
        "weights_chosen": test["chosen"].value_counts().to_dict(),
        "weight_sets": sets,
        "caveats": [
            "Uses today's coin list (survivorship bias): delisted coins are missing.",
            "Fills at the hourly close; real fills may be worse on thin books.",
            "Past results don't guarantee future returns. This is a screener, not advice.",
        ],
    }
    eq = (1 + test[["walk_forward", "universe", "btc"]].fillna(0)).cumprod()
    curve = [{"t": t.isoformat(), "strategy": round(float(r.walk_forward), 4),
              "universe": round(float(r.universe), 4), "btc": round(float(r.btc), 4)} for t, r in eq.iterrows()]
    return metrics, curve


async def fetch_history(api: Binance, symbols: list[str], days: int) -> tuple[dict, pd.DataFrame, pd.Series]:
    warmup_days = MIN_BARS // 24 + 3
    start = datetime.now(timezone.utc) - timedelta(days=days + warmup_days)
    start_ms = int(start.timestamp() * 1000)
    sem = asyncio.Semaphore(5)

    async def one(sym):
        async with sem:
            rows = await api.klines_range(sym, "1h", start_ms)
        return sym, _frame(rows[:-1]) if len(rows) > 1 else None  # last = still forming

    got = await asyncio.gather(*(one(s) for s in set(symbols) | {"BTCUSDT"}))
    frames = {s: f for s, f in got if f is not None and len(f)}
    btc_daily_rows = await api.klines("BTCUSDT", "1d", 1000)
    btc_daily = _frame(btc_daily_rows[:-1])["close"]
    btc_1h = frames.pop("BTCUSDT")
    return frames, btc_1h, btc_daily


async def run_backtest(api: Binance, params: dict) -> tuple[dict, list]:
    with SessionLocal() as db:
        cfg = load_config(db)
        rows = db.execute(select(Symbol.symbol, Symbol.first_candle_at)
                          .where(Symbol.is_trading, Symbol.quote_volume_24h >= cfg.min_quote_volume_24h,
                                 Symbol.symbol != "BTCUSDT")
                          .order_by(Symbol.quote_volume_24h.desc()).limit(MAX_COINS)).all()
    symbols = [r[0] for r in rows]
    listing = {r[0]: r[1] for r in rows}
    if not symbols:
        raise RuntimeError("No coins available yet - wait for the worker's first universe refresh.")
    frames, btc_1h, btc_daily = await fetch_history(api, symbols, params["days"])
    panel = await asyncio.to_thread(build_panel, frames, btc_1h, listing, params["hold_hours"],
                                    cfg.min_quote_volume_24h, cfg.min_history_days)
    metrics, curve = await asyncio.to_thread(
        simulate, panel, btc_1h, btc_daily, days=params["days"], top_k=params["top_k"],
        hold_hours=params["hold_hours"], min_score=params["min_score"], fee_pct=params["fee_pct"],
        regime_filter=params.get("regime_filter", True))
    metrics["coins_tested"] = len(frames)
    return metrics, curve
