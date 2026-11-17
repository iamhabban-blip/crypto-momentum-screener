"""Builds the fixture for frontend/scripts/parity-check.ts: simulated candles plus the Python
engine's results on them. The browser demo must reproduce these numbers exactly.

    python -m scripts.make_parity_fixture /tmp/fixture.json
"""
import json
import sys

import pandas as pd

from engine.backtest import _frame, build_panel, simulate
from engine.scoring import ScreenerConfig, score_latest
from engine.simulator import HOUR_MS, Market


def main(out: str) -> None:
    m = Market(n_coins=10, days=200, now_ms=(1_790_000_000_000 // HOUR_MS) * HOUR_MS + 20 * 60_000)
    m.speed = 0
    now = m.now()
    frames = {}
    for s in m.coins:
        rows, start = [], now - 260 * 86_400_000
        while True:
            batch = m.klines(s, "1h", 1000, start, None)
            rows += batch
            if len(batch) < 1000:
                break
            start = batch[-1][0] + 1
        frames[s] = rows[:-1]
    daily = m.klines("BTCUSDT", "1d", 1000, None, None)[:-1]
    cfg = ScreenerConfig(min_quote_volume_24h=2_000_000, min_history_days=30)
    pf = {s: _frame(r) for s, r in frames.items()}
    btc = pf.pop("BTCUSDT")
    listing = {s: pd.Timestamp(m.listing[s], unit="ms", tz="UTC") for s in pf}
    scores = {}
    for s, df in pf.items():
        r = score_latest(df.iloc[-1000:], btc["close"], cfg, (df.index[-1] - listing[s]).total_seconds() / 86400)
        scores[s] = {"score": r["score"], "gate": r["gate_reason"], "rsi": r["rsi"], "rvol": r["rvol"],
                     "stop": r["stop_price"], "comp": {k: v["score"] for k, v in r["components"].items()}}
    panel = build_panel(pf, btc, listing, 72, cfg.min_quote_volume_24h, cfg.min_history_days)
    metrics, curve = simulate(panel, btc, _frame(daily)["close"], days=150, top_k=3, hold_hours=72,
                              min_score=50, fee_pct=0.1, regime_filter=True)
    keep = ("walk_forward", "default_weights", "universe", "btc", "excess_vs_universe_pct", "window", "risk_off_periods")
    with open(out, "w") as f:
        json.dump({"frames": frames, "daily": daily, "listing": {s: int(m.listing[s]) for s in pf},
                   "py_scores": scores, "py_metrics": {k: metrics[k] for k in keep}, "py_curve_last": curve[-1]}, f)


if __name__ == "__main__":
    main(sys.argv[1])
