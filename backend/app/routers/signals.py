"""Screener results (read-only, any signed-in user)."""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import Candle, RunStatus, ScanRun, Signal, User, WatchlistItem
from ..schemas import CandleOut, LatestScanOut, ScanRunOut, SignalOut, SymbolDetailOut

router = APIRouter(prefix="/api", tags=["screener"])


def latest_run(db: Session) -> ScanRun | None:
    return db.scalar(select(ScanRun).where(ScanRun.status == RunStatus.succeeded)
                     .order_by(ScanRun.candle_time.desc()).limit(1))


@router.get("/signals/latest", response_model=LatestScanOut)
def latest_signals(include_filtered: bool = False, db: Session = Depends(get_db),
                   _: User = Depends(get_current_user)):
    run = latest_run(db)
    if run is None:
        return LatestScanOut(run=None, signals=[])
    q = select(Signal).where(Signal.scan_run_id == run.id)
    if not include_filtered:
        q = q.where(Signal.passed_gates)
    signals = db.scalars(q.order_by(Signal.rank.asc().nulls_last(), Signal.score.desc())).all()
    return LatestScanOut(run=ScanRunOut.model_validate(run), signals=[SignalOut.model_validate(s) for s in signals])


@router.get("/scans", response_model=list[ScanRunOut])
def scan_history(limit: int = Query(48, ge=1, le=500), db: Session = Depends(get_db),
                 _: User = Depends(get_current_user)):
    return db.scalars(select(ScanRun).order_by(ScanRun.candle_time.desc()).limit(limit)).all()


@router.get("/market/btc")
def btc_overview(days: int = Query(120, ge=7, le=400), db: Session = Depends(get_db),
                 _: User = Depends(get_current_user)):
    """BTC daily closes with the 200-day average that drives the risk-on / risk-off regime."""
    rows = db.execute(select(Candle.open_time, Candle.close)
                      .where(Candle.symbol == "BTCUSDT", Candle.interval == "1d")
                      .order_by(Candle.open_time.desc()).limit(days + 200)).all()[::-1]
    closes = [r.close for r in rows]
    out = []
    for i, r in enumerate(rows):
        sma = sum(closes[i - 199:i + 1]) / 200 if i >= 199 else None
        out.append({"t": r.open_time, "close": r.close, "sma200": sma})
    return out[-days:]


@router.get("/symbols/{symbol}", response_model=SymbolDetailOut)
def symbol_detail(symbol: str, hours: int = Query(168, ge=24, le=720), db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    symbol = symbol.upper()
    run = latest_run(db)
    signal = db.scalar(select(Signal).where(Signal.scan_run_id == run.id, Signal.symbol == symbol)) if run else None
    candles = db.execute(select(Candle).where(Candle.symbol == symbol, Candle.interval == "1h")
                         .order_by(Candle.open_time.desc()).limit(hours)).scalars().all()[::-1]
    if not candles and signal is None:
        raise HTTPException(404, "No data for this coin.")
    since = (run.candle_time if run else candles[-1].open_time) - timedelta(hours=72)
    history = db.execute(select(ScanRun.candle_time, Signal.score, Signal.rank)
                         .join(Signal, Signal.scan_run_id == ScanRun.id)
                         .where(Signal.symbol == symbol, ScanRun.candle_time >= since)
                         .order_by(ScanRun.candle_time)).all()
    watched = db.get(WatchlistItem, (user.id, symbol)) is not None
    return SymbolDetailOut(
        symbol=symbol,
        signal=SignalOut.model_validate(signal) if signal else None,
        candles=[CandleOut(t=c.open_time, o=c.open, h=c.high, l=c.low, c=c.close, v=c.volume) for c in candles],
        score_history=[{"t": h.candle_time, "score": h.score, "rank": h.rank} for h in history],
        on_watchlist=watched,
    )
