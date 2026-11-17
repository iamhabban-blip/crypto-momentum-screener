"""End-to-end: simulated Binance -> worker -> database -> scan results, including gap repair."""

import asyncio

import pandas as pd
from aiohttp.test_utils import TestServer
from sqlalchemy import create_engine, func, select, text

from app.config import get_settings
from app.db import SessionLocal
from app.models import Candle, ScanRun, Signal
from engine.binance import Binance
from engine.simulator import NAMES, Market, make_app
from engine.worker import Worker, load_frame

HOUR_MS = 3_600_000


def _clear_market_tables():
    owner = create_engine(get_settings().migrations_url)
    with owner.begin() as c:
        c.execute(text("TRUNCATE candles, symbols, scan_runs, signals CASCADE"))
    owner.dispose()


def test_worker_ingests_scans_and_repairs_gaps():
    _clear_market_tables()

    async def scenario():
        market = Market(n_coins=12, days=120, now_ms=(1_790_000_000_000 // HOUR_MS) * HOUR_MS + 20 * 60_000)
        market.speed = 0  # freeze the clock; we move it by hand
        server = TestServer(make_app(market))
        await server.start_server()
        try:
            async with Binance(str(server.make_url(""))) as api:
                w = Worker(api)
                await w.refresh_universe()
                await w.refresh_btc_daily()
                await w.ensure_history()
                newest = await w.poll()
                assert w.scan(newest) > 0

                # Simulate 3 hours of downtime, then come back 5 minutes after an hour closes.
                market.jump_ms += 3 * HOUR_MS
                newest2 = await w.poll()
                assert newest2 - newest == pd.Timedelta(hours=3)
                for s in w.universe:
                    df = load_frame(SessionLocal(), s)
                    gaps = df.index.to_series().diff().dropna()
                    assert (gaps == pd.Timedelta(hours=1)).all(), f"gap left in {s}"
                assert w.scan(newest2) > 0
                assert w.scan(newest2) == 0  # the same candle is never scanned twice
                return w.universe
        finally:
            await server.close()

    universe = asyncio.run(scenario())
    with SessionLocal() as db:
        runs = db.scalars(select(ScanRun).order_by(ScanRun.id)).all()
        assert len(runs) == 2 and all(r.status.value == "succeeded" for r in runs)
        latest = db.scalars(select(Signal).where(Signal.scan_run_id == runs[-1].id)).all()
        ranked = sorted([s for s in latest if s.rank], key=lambda s: s.rank)
        assert [s.rank for s in ranked] == list(range(1, len(ranked) + 1))
        assert all(a.score >= b.score for a, b in zip(ranked, ranked[1:]))
        young = [n for n in latest if n.symbol == f"{NAMES[11]}USDT"]  # last coin: listed 10 days ago
        assert all(n.rank is None for n in young)
        assert db.scalar(select(func.count()).select_from(Candle).where(Candle.interval == "1d")) > 100
        assert "BTCUSDT" in universe


def test_backtest_runs_walk_forward():
    _clear_market_tables()
    from app.models import BacktestRun, RunStatus

    async def scenario():
        market = Market(n_coins=12, days=200, now_ms=(1_790_000_000_000 // HOUR_MS) * HOUR_MS + 20 * 60_000)
        market.speed = 0
        server = TestServer(make_app(market))
        await server.start_server()
        try:
            async with Binance(str(server.make_url(""))) as api:
                w = Worker(api)
                await w.refresh_universe()
                with SessionLocal() as db:
                    db.add(BacktestRun(status=RunStatus.queued, params={
                        "days": 90, "top_k": 3, "hold_hours": 24, "min_score": 50, "fee_pct": 0.1,
                        "regime_filter": False}))
                    db.commit()
                await w.process_backtests()
        finally:
            await server.close()

    asyncio.run(scenario())
    with SessionLocal() as db:
        run = db.scalar(select(BacktestRun))
        assert run.status == RunStatus.succeeded, run.error
        m = run.metrics
        assert m["walk_forward"]["periods"] == m["window"]["test_periods"] > 30
        assert set(m) >= {"universe", "btc", "default_weights", "excess_vs_universe_pct", "caveats"}
        assert len(run.equity_curve) == m["window"]["test_periods"]
        # walk-forward never uses a weight set chosen with future data: training periods have no choice
        assert m["window"]["training_periods"] >= 10
