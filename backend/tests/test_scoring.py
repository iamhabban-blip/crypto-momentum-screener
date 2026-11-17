import numpy as np
import pandas as pd

from engine.indicators import rsi
from engine.scoring import DEFAULT_WEIGHTS, MIN_BARS, ScreenerConfig, components, features, score_latest, total_score


def frame(closes, volumes=None, start="2026-01-01"):
    idx = pd.date_range(start, periods=len(closes), freq="h", tz="UTC")
    c = pd.Series(closes, index=idx, dtype=float)
    o = c.shift(1).fillna(c.iloc[0])
    v = pd.Series(volumes if volumes is not None else np.full(len(c), 1000.0), index=idx)
    return pd.DataFrame({"open": o, "high": np.maximum(o, c) * 1.002, "low": np.minimum(o, c) * 0.998,
                         "close": c, "volume": v, "quote_volume": v * c})


def reference_rsi(closes, n=14):
    """Straight loop of TradingView's ta.rsi for comparison."""
    d = np.diff(closes)
    g, l = np.clip(d, 0, None), np.clip(-d, 0, None)
    ag, al = g[:n].mean(), l[:n].mean()
    for i in range(n, len(d)):
        ag = (ag * (n - 1) + g[i]) / n
        al = (al * (n - 1) + l[i]) / n
    return 100 - 100 / (1 + ag / al)


def test_rsi_matches_tradingview_method():
    rng = np.random.default_rng(1)
    closes = 100 * np.exp(np.cumsum(rng.normal(0, 0.01, 500)))
    assert abs(rsi(pd.Series(closes)).iloc[-1] - reference_rsi(closes)) < 1e-9


def test_steady_uptrend_scores_high_and_downtrend_low():
    n = MIN_BARS + 50
    up = frame(np.linspace(100, 160, n), np.r_[np.full(n - 1, 1000.0), 3500.0])
    down = frame(np.linspace(160, 100, n))
    btc = pd.Series(np.full(n, 50_000.0), index=up.index)
    cfg = ScreenerConfig(min_quote_volume_24h=0, min_history_days=1)
    s_up = score_latest(up, btc, cfg, history_days=60)
    s_down = score_latest(down, btc, cfg, history_days=60)
    assert s_up["gate_reason"] is None
    assert s_up["score"] > 70 and s_down["score"] < 25
    assert s_up["components"]["volume"]["score"] == 1.0       # RVOL 3.5 on an up candle
    assert s_up["stop_price"] < s_up["close"]


def test_volume_spike_on_red_candle_scores_zero():
    n = MIN_BARS + 10
    closes = np.r_[np.linspace(100, 120, n - 1), 118.0]
    df = frame(closes, np.r_[np.full(n - 1, 1000.0), 5000.0])
    comp = components(features(df, pd.Series(50_000.0, index=df.index)))
    assert comp["volume"].iloc[-1] == 0


def test_gates():
    n = MIN_BARS + 10
    df = frame(np.linspace(100, 120, n))
    btc = pd.Series(50_000.0, index=df.index)
    assert score_latest(df, btc, ScreenerConfig(min_quote_volume_24h=1e12), 60)["gate_reason"] == "24h volume below filter"
    assert "Listed less than" in score_latest(df, btc, ScreenerConfig(min_quote_volume_24h=0), 5)["gate_reason"]
    short = frame(np.linspace(100, 120, 100))
    assert score_latest(short, btc.iloc[:100], ScreenerConfig(min_quote_volume_24h=0), 60)["gate_reason"] \
        == "Not enough candle history yet"


def test_score_is_bounded_and_weights_matter():
    n = MIN_BARS + 30
    rng = np.random.default_rng(3)
    df = frame(100 * np.exp(np.cumsum(rng.normal(0.0005, 0.01, n))))
    comp = components(features(df, pd.Series(50_000.0, index=df.index))).dropna()
    s = total_score(comp, DEFAULT_WEIGHTS)
    assert ((s >= 0) & (s <= 100)).all()
    only_rsi = {k: (100 if k == "rsi" else 0) for k in DEFAULT_WEIGHTS}
    assert set(np.round(total_score(comp, only_rsi).unique(), 6)) <= {0, 30, 60, 100}
