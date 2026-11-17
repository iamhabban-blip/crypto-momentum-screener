"""Background worker: keeps candle history complete, runs the hourly scan, executes queued
backtests and applies the data-retention rules.

Only one worker may run at a time (Postgres advisory lock), so scaling the API never
duplicates scans.

    python -m engine.worker
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import pandas as pd
from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert

from app.db import SessionLocal, engine
from app.models import (BacktestRun, Candle, Regime, RefreshToken, RunStatus, ScanRun, Signal, Symbol)

from .backtest import run_backtest
from .binance import Binance, BinanceError, kline_to_row, ms_to_dt
from .scoring import btc_regime, score_latest
from .settings_store import load_config

log = logging.getLogger("worker")
HOUR = timedelta(hours=1)
LIVE_BARS = 1000            # 1h candles kept warm per coin (~41 days): settles EMA200 exactly
POLL_SECONDS = 60
UNIVERSE_REFRESH = timedelta(minutes=30)
RETENTION = {"candles_days": 800, "scan_runs_days": 90, "dead_tokens_days": 30}
ADVISORY_LOCK_ID = 7_351_001


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def valid_candle(r: dict) -> bool:
    return (r["high"] >= r["low"] and r["low"] > 0 and r["volume"] >= 0
            and r["low"] <= min(r["open"], r["close"]) and r["high"] >= max(r["open"], r["close"]))


def upsert_candles(db, rows: list[dict]) -> int:
    bad = [r for r in rows if not valid_candle(r)]
    if bad:
        log.warning("skipping %d malformed candle(s), e.g. %s %s", len(bad), bad[0]["symbol"], bad[0]["open_time"])
        rows = [r for r in rows if valid_candle(r)]
    if not rows:
        return 0
    stmt = insert(Candle).values(rows).on_conflict_do_nothing(index_elements=["symbol", "interval", "open_time"])
    return db.execute(stmt).rowcount or 0


def load_frame(db, symbol: str, interval: str = "1h", limit: int = LIVE_BARS) -> pd.DataFrame:
    rows = db.execute(
        select(Candle.open_time, Candle.open, Candle.high, Candle.low, Candle.close, Candle.volume,
               Candle.quote_volume)
        .where(Candle.symbol == symbol, Candle.interval == interval)
        .order_by(Candle.open_time.desc()).limit(limit)).all()
    df = pd.DataFrame(rows, columns=["open_time", "open", "high", "low", "close", "volume", "quote_volume"])
    return df.iloc[::-1].set_index("open_time")


class Worker:
    def __init__(self, api: Binance):
        self.api = api
        self.universe: list[str] = []
        self.last_universe_refresh = datetime.min.replace(tzinfo=timezone.utc)
        self.last_retention = datetime.min.replace(tzinfo=timezone.utc)

    # ── Universe & history ─────────────────────────────────────────────────────

    async def refresh_universe(self) -> None:
        pairs = await self.api.usdt_universe()
        with SessionLocal() as db:
            cfg = load_config(db)
            for p in pairs:
                db.execute(insert(Symbol).values(**p, is_trading=True).on_conflict_do_update(
                    index_elements=["symbol"],
                    set_={k: p[k] for k in ("quote_volume_24h", "price_change_pct_24h", "last_price")}
                    | {"is_trading": True, "updated_at": func.now()}))
            live = {p["symbol"] for p in pairs}
            db.execute(Symbol.__table__.update().where(Symbol.symbol.not_in(live)).values(is_trading=False))
            db.commit()
            wanted = {p["symbol"] for p in pairs if p["quote_volume_24h"] >= cfg.min_quote_volume_24h}
            wanted.add("BTCUSDT")
            missing_age = [s for s in wanted if db.scalar(
                select(Symbol.first_candle_at).where(Symbol.symbol == s)) is None]
        for s in missing_age:  # listing date, used by the "minimum history" gate
            try:
                first = await self.api.first_candle_time(s)
            except BinanceError as e:
                log.warning("listing date for %s: %s", s, e)
                continue
            with SessionLocal() as db:
                db.execute(Symbol.__table__.update().where(Symbol.symbol == s).values(first_candle_at=first))
                db.commit()
        self.universe = sorted(wanted)
        self.last_universe_refresh = utcnow()
        log.info("universe: %d coins pass the %s USDT volume filter", len(self.universe),
                 f"{cfg.min_quote_volume_24h:,.0f}")

    async def backfill(self, symbol: str, bars: int = LIVE_BARS) -> None:
        """Reload recent history (also used to repair gaps after downtime)."""
        rows = await self.api.klines(symbol, "1h", min(bars + 1, 1000))
        closed = rows[:-1]  # Binance always returns the still-forming candle last
        with SessionLocal() as db:
            upsert_candles(db, [kline_to_row(symbol, "1h", k) for k in closed])
            db.commit()

    async def refresh_btc_daily(self) -> None:
        rows = await self.api.klines("BTCUSDT", "1d", 400)
        with SessionLocal() as db:
            upsert_candles(db, [kline_to_row("BTCUSDT", "1d", k) for k in rows[:-1]])
            db.commit()

    async def ensure_history(self) -> None:
        with SessionLocal() as db:
            counts = dict(db.execute(
                select(Candle.symbol, func.count()).where(Candle.interval == "1h",
                                                          Candle.symbol.in_(self.universe))
                .group_by(Candle.symbol)).all())
        todo = [s for s in self.universe if counts.get(s, 0) < LIVE_BARS - 5]
        if todo:
            log.info("loading history for %d coins", len(todo))
        await asyncio.gather(*(self._safe(self.backfill(s)) for s in todo))

    async def _safe(self, coro):
        try:
            return await coro
        except BinanceError as e:
            log.warning("%s", e)

    # ── Polling ────────────────────────────────────────────────────────────────

    async def poll(self) -> datetime | None:
        """Adds newly closed candles; repairs gaps. Returns the newest closed BTC candle time."""
        async def one(symbol: str):
            rows = await self.api.klines(symbol, "1h", 3)
            closed = rows[:-1]
            with SessionLocal() as db:
                last = db.scalar(select(func.max(Candle.open_time))
                                 .where(Candle.symbol == symbol, Candle.interval == "1h"))
            if last is not None and closed and ms_to_dt(closed[0][0]) > last + HOUR:
                log.info("gap detected for %s (last %s) - reloading history", symbol, last)
                await self.backfill(symbol)
                return
            with SessionLocal() as db:
                upsert_candles(db, [kline_to_row(symbol, "1h", k) for k in closed])
                db.commit()

        await asyncio.gather(*(self._safe(one(s)) for s in self.universe))
        with SessionLocal() as db:
            return db.scalar(select(func.max(Candle.open_time))
                             .where(Candle.symbol == "BTCUSDT", Candle.interval == "1h"))

    # ── Scan ───────────────────────────────────────────────────────────────────

    def scan(self, candle_time: datetime) -> int:
        with SessionLocal() as db:
            if db.scalar(select(ScanRun.id).where(ScanRun.candle_time == candle_time,
                                                  ScanRun.status == RunStatus.succeeded)):
                return 0
            cfg = load_config(db)
            run = ScanRun(candle_time=candle_time, status=RunStatus.running, weights=cfg.weights,
                          coins_total=len(self.universe))
            db.add(run)
            db.commit()
            try:
                btc = load_frame(db, "BTCUSDT")
                daily = load_frame(db, "BTCUSDT", "1d", 400)["close"]
                regime = btc_regime(daily).iloc[-1] if len(daily) else None
                risk_on = bool(regime["risk_on"]) if regime is not None and pd.notna(regime["sma200"]) else True
                run.regime = Regime.risk_on if risk_on else Regime.risk_off
                if regime is not None:
                    run.btc_close = float(regime["btc_close"])
                    run.btc_sma200d = None if pd.isna(regime["sma200"]) else float(regime["sma200"])

                listed = dict(db.execute(select(Symbol.symbol, Symbol.first_candle_at)
                                         .where(Symbol.symbol.in_(self.universe))).all())
                results = []
                for symbol in self.universe:
                    df = load_frame(db, symbol)
                    if df.empty or df.index[-1] != candle_time:
                        continue  # this coin's latest candle hasn't arrived; it is scored next hour
                    first = listed.get(symbol) or df.index[0]
                    res = score_latest(df, btc["close"], cfg, (candle_time - first).total_seconds() / 86400)
                    if res:
                        results.append((symbol, res))

                passed = [(s, r) for s, r in results if r["gate_reason"] is None]
                rankable = passed if (risk_on or cfg.regime_mode == "flag") else []
                ranks = {s: i for i, (s, _) in enumerate(sorted(rankable, key=lambda x: -x[1]["score"]), 1)}
                for symbol, r in results:
                    reason = r["gate_reason"]
                    if reason is None and not risk_on and cfg.regime_mode == "suppress":
                        reason = "Market risk-off (BTC below 200-day average)"
                    db.add(Signal(run=run, symbol=symbol, rank=ranks.get(symbol), score=r["score"],
                                  passed_gates=reason is None, gate_reason=reason, components=r["components"],
                                  close=r["close"], rsi=r["rsi"], rvol=r["rvol"], ret_1d=r["ret_1d"],
                                  ret_7d=r["ret_7d"], stop_price=r["stop_price"], exit_level=r["exit_level"]))
                run.coins_total = len(results)
                run.coins_passed = len(passed)
                run.status = RunStatus.succeeded
                run.finished_at = utcnow()
                db.commit()
                log.info("scan %s: %d coins scored, %d passed gates, regime %s",
                         candle_time, len(results), len(passed), run.regime.value)
                return len(results)
            except Exception as e:  # keep a record of the failure, never crash the loop
                db.rollback()
                run.status, run.error, run.finished_at = RunStatus.failed, str(e)[:2000], utcnow()
                db.add(run)
                db.commit()
                log.exception("scan failed")
                return 0

    # ── Backtests & retention ──────────────────────────────────────────────────

    async def process_backtests(self) -> None:
        with SessionLocal() as db:
            job = db.scalar(select(BacktestRun).where(BacktestRun.status == RunStatus.queued)
                            .order_by(BacktestRun.id).limit(1).with_for_update(skip_locked=True))
            if not job:
                return
            job.status = RunStatus.running
            db.commit()
            job_id, params = job.id, dict(job.params)
        try:
            metrics, curve = await run_backtest(self.api, params)
            status, error = RunStatus.succeeded, None
        except Exception as e:
            log.exception("backtest %s failed", job_id)
            metrics, curve, status, error = None, None, RunStatus.failed, str(e)[:2000]
        with SessionLocal() as db:
            job = db.get(BacktestRun, job_id)
            job.metrics, job.equity_curve, job.status, job.error = metrics, curve, status, error
            job.finished_at = utcnow()
            db.commit()

    def apply_retention(self) -> None:
        now = utcnow()
        with SessionLocal() as db:
            c = db.execute(delete(Candle).where(
                Candle.open_time < now - timedelta(days=RETENTION["candles_days"]))).rowcount
            r = db.execute(delete(ScanRun).where(
                ScanRun.candle_time < now - timedelta(days=RETENTION["scan_runs_days"]))).rowcount
            t = db.execute(delete(RefreshToken).where(
                RefreshToken.expires_at < now - timedelta(days=RETENTION["dead_tokens_days"]))).rowcount
            db.commit()
        self.last_retention = now
        log.info("retention: removed %s candles, %s scan runs, %s expired sessions", c, r, t)

    # ── Main loop ──────────────────────────────────────────────────────────────

    async def run_forever(self) -> None:
        await self.refresh_universe()
        await self.refresh_btc_daily()
        await self.ensure_history()
        while True:
            try:
                if utcnow() - self.last_universe_refresh > UNIVERSE_REFRESH:
                    await self.refresh_universe()
                    await self.refresh_btc_daily()
                    await self.ensure_history()
                newest = await self.poll()
                if newest is not None:
                    await asyncio.to_thread(self.scan, newest)
                await self.process_backtests()
                if utcnow() - self.last_retention > timedelta(hours=24):
                    self.apply_retention()
            except BinanceError as e:
                log.warning("Binance unavailable: %s (retrying)", e)
            except Exception:
                log.exception("worker loop error (retrying)")
            await asyncio.sleep(POLL_SECONDS)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    with engine.connect() as conn:
        while not conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": ADVISORY_LOCK_ID}).scalar():
            log.info("another worker is running; waiting")
            await asyncio.sleep(30)
        async with Binance() as api:
            await Worker(api).run_forever()


if __name__ == "__main__":
    asyncio.run(main())
