"""Indicator maths. RSI and ATR use Wilder's smoothing seeded with a simple average, which is the
method TradingView and the Binance chart use, so values match what traders see on a chart."""

import numpy as np
import pandas as pd


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def _wilder(values: np.ndarray, n: int) -> np.ndarray:
    """Wilder's running average (RMA), seeded with the SMA of the first n values."""
    out = np.full(len(values), np.nan)
    if len(values) < n:
        return out
    avg = np.nanmean(values[:n])
    out[n - 1] = avg
    for i in range(n, len(values)):
        avg = (avg * (n - 1) + values[i]) / n
        out[i] = avg
    return out


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff().to_numpy()[1:]
    gain = _wilder(np.clip(delta, 0, None), n)
    loss = _wilder(np.clip(-delta, 0, None), n)
    with np.errstate(divide="ignore", invalid="ignore"):
        rs = gain / loss
        values = np.where(loss == 0, np.where(gain == 0, 50.0, 100.0), 100 - 100 / (1 + rs))
    values[np.isnan(gain)] = np.nan
    return pd.Series(np.concatenate([[np.nan], values]), index=close.index)


def atr(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 14) -> pd.Series:
    prev = close.shift(1)
    tr = pd.concat([high - low, (high - prev).abs(), (low - prev).abs()], axis=1).max(axis=1)
    tr.iloc[0] = high.iloc[0] - low.iloc[0]
    return pd.Series(_wilder(tr.to_numpy(), n), index=close.index)
