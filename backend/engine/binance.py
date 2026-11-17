"""Minimal async Binance Spot REST client: polite rate limiting, retries, and Binance's own
weight header used as a brake so the app never gets banned."""

import asyncio
import logging
import os
from datetime import datetime, timezone

import aiohttp

log = logging.getLogger("binance")

STABLECOINS = {"USDC", "FDUSD", "RLUSD", "USD1", "TUSD", "BUSD", "DAI", "USDP", "EUR", "GBP", "EURC",
               "USDT", "AEUR", "PYUSD", "XUSD", "BFUSD"}
WEIGHT_SOFT_LIMIT = 4500  # Binance's limit is 6000/min; slow down well before it


class BinanceError(RuntimeError):
    pass


class Binance:
    def __init__(self, base_url: str | None = None, concurrency: int = 10):
        self.base = (base_url or os.environ.get("BINANCE_BASE_URL") or "https://api.binance.com").rstrip("/")
        self._sem = asyncio.Semaphore(concurrency)
        self._session: aiohttp.ClientSession | None = None
        self.used_weight = 0

    async def __aenter__(self):
        self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30, connect=10))
        return self

    async def __aexit__(self, *exc):
        if self._session:
            await self._session.close()

    async def _get(self, path: str, params: dict | None = None, retries: int = 4):
        assert self._session is not None, "use `async with Binance()`"
        for attempt in range(retries + 1):
            async with self._sem:
                if self.used_weight > WEIGHT_SOFT_LIMIT:
                    await asyncio.sleep(10)
                try:
                    async with self._session.get(self.base + path, params=params) as r:
                        self.used_weight = int(r.headers.get("x-mbx-used-weight-1m", self.used_weight) or 0)
                        if r.status == 200:
                            return await r.json()
                        if r.status in (418, 429):
                            wait = int(r.headers.get("retry-after", "30"))
                            log.warning("Binance rate limit (%s), waiting %ss", r.status, wait)
                            await asyncio.sleep(wait)
                            continue
                        if r.status == 451:
                            raise BinanceError("Binance refused this location (HTTP 451). A VPN may be needed.")
                        body = await r.text()
                        if 400 <= r.status < 500:
                            raise BinanceError(f"HTTP {r.status} for {path}: {body[:200]}")
                except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                    if attempt == retries:
                        raise BinanceError(f"Network error for {path}: {e}") from e
            await asyncio.sleep(min(2 ** attempt, 20))
        raise BinanceError(f"Gave up on {path} after {retries + 1} attempts")

    async def usdt_universe(self) -> list[dict]:
        """Every trading USDT spot pair with its 24h stats (stablecoins and odd tickers removed)."""
        info, tickers = await asyncio.gather(self._get("/api/v3/exchangeInfo", {"permissions": "SPOT"}),
                                             self._get("/api/v3/ticker/24hr"))
        meta = {s["symbol"]: s for s in info["symbols"]
                if s.get("status") == "TRADING" and s.get("quoteAsset") == "USDT"}
        out = []
        for t in tickers:
            s = meta.get(t.get("symbol"))
            if not s:
                continue
            base = s["baseAsset"]
            if base in STABLECOINS or not base.isascii() or not base.isalnum() or not 1 <= len(base) <= 10:
                continue
            out.append({"symbol": s["symbol"], "base_asset": base, "quote_asset": "USDT",
                        "quote_volume_24h": float(t.get("quoteVolume") or 0),
                        "price_change_pct_24h": float(t.get("priceChangePercent") or 0),
                        "last_price": float(t.get("lastPrice") or 0)})
        return out

    async def klines(self, symbol: str, interval: str = "1h", limit: int = 1000,
                     start_ms: int | None = None, end_ms: int | None = None) -> list[list]:
        params = {"symbol": symbol, "interval": interval, "limit": limit}
        if start_ms is not None:
            params["startTime"] = start_ms
        if end_ms is not None:
            params["endTime"] = end_ms
        return await self._get("/api/v3/klines", params)

    async def klines_range(self, symbol: str, interval: str, start_ms: int, end_ms: int | None = None) -> list[list]:
        """All candles from start_ms onwards (paginates in blocks of 1000)."""
        out: list[list] = []
        cursor = start_ms
        while True:
            batch = await self.klines(symbol, interval, 1000, start_ms=cursor, end_ms=end_ms)
            if not batch:
                break
            out.extend(batch)
            if len(batch) < 1000:
                break
            cursor = batch[-1][0] + 1
        return out

    async def first_candle_time(self, symbol: str) -> datetime | None:
        rows = await self.klines(symbol, "1d", 1, start_ms=0)
        return ms_to_dt(rows[0][0]) if rows else None


def ms_to_dt(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def kline_to_row(symbol: str, interval: str, k: list) -> dict:
    return {"symbol": symbol, "interval": interval, "open_time": ms_to_dt(k[0]),
            "open": float(k[1]), "high": float(k[2]), "low": float(k[3]), "close": float(k[4]),
            "volume": float(k[5]), "quote_volume": float(k[7])}
