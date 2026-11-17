"""Simulated Binance market-data API for tests and the offline demo (`docker compose --profile demo`).

Serves the same endpoints the worker uses (exchangeInfo, ticker/24hr, klines) from a
deterministic random market of fictional coins, so the whole app can be tried without network
access to Binance. Coins are clearly fictional (ticker suffix "X") so nobody mistakes them for
real prices.

    python -m engine.simulator --port 9100
"""

import argparse
import time

import numpy as np
from aiohttp import web

HOUR_MS = 3_600_000
DAY_MS = 86_400_000
NAMES = ["ORBX", "NOVX", "KITEX", "LUMX", "AXIX", "VOLTX", "MERIX", "ZENX", "PYRX", "SOLAX", "TIDEX",
         "FLUXX", "ARCX", "QUIX", "HALOX", "NEBX", "RIFTX", "ECHOX", "JADEX", "OPALX", "WAVEX", "BOLTX",
         "CORAX", "DUSKX", "EMBRX", "FERNX", "GLOWX", "HIVEX", "IRISX", "JOLTX", "KARMX", "LYNXX"]


class Market:
    def __init__(self, n_coins: int = 32, days: int = 900, seed: int = 11, now_ms: int | None = None):
        rng = np.random.default_rng(seed)
        self.real_start = time.time()
        self.now0 = now_ms or int(time.time() * 1000)
        self.hours = days * 24
        self.t0 = (self.now0 // HOUR_MS - self.hours + 1) * HOUR_MS  # first candle open time
        self.coins = {"BTCUSDT": self._path(rng, 30_000, 0.00004, 0.005, 25_000, 0.0)}
        for i, name in enumerate(NAMES[:n_coins]):
            price = float(rng.choice([0.05, 0.4, 1.5, 7, 30, 120]))
            drift = rng.normal(0.00005, 0.0002)
            vol = rng.uniform(0.008, 0.02)
            base_volume = rng.choice([3e4, 2e5, 1e6]) / price * (0.15 if i % 6 == 5 else 1)
            self.coins[f"{name}USDT"] = self._path(rng, price, drift, vol, base_volume, rng.uniform(0.002, 0.006))
        # One coin listed only 10 days ago, to exercise the "minimum history" gate.
        young = f"{NAMES[n_coins - 1]}USDT"
        self.listing = {s: self.t0 for s in self.coins}
        self.listing[young] = (self.now0 // HOUR_MS - 240) * HOUR_MS
        self.speed = 1.0
        self.jump_ms = 0

    @staticmethod
    def _path(rng, price, drift, vol, base_volume, burst_rate):
        n = 900 * 24 + 48
        regimes = np.repeat(rng.normal(drift, abs(drift) * 4 + 1e-4, n // 240 + 1), 240)[:n]
        rets = rng.normal(0, vol, n) + regimes
        bursts = rng.random(n) < burst_rate
        rets[bursts] += np.abs(rng.normal(0.02, 0.015, bursts.sum()))
        # Keep long-run drift realistic: total move over the whole history between roughly -60% and +150%.
        target = rng.uniform(-0.9, 0.9)
        rets += (target - rets.sum()) / n
        close = price * np.exp(np.cumsum(rets))
        volume = base_volume * rng.gamma(3, 1 / 3, n) * np.where(bursts, rng.uniform(3, 8, n), 1)
        return {"close": close, "volume": volume}

    def now(self) -> int:
        return int(self.now0 + (time.time() - self.real_start) * 1000 * self.speed + self.jump_ms)

    def _candle(self, sym: str, h: int, now: int) -> list:
        """Hour index h -> Binance kline row. The current hour is returned partially formed."""
        p = self.coins[sym]
        open_time = self.t0 + h * HOUR_MS
        prev = p["close"][h - 1] if h > 0 else p["close"][0]
        full_close = p["close"][h]
        frac = min(1.0, max(0.02, (now - open_time) / HOUR_MS))
        close = prev + (full_close - prev) * frac
        rng = np.random.default_rng(h * 7919 + len(sym))
        wick = abs(rng.normal(0, 0.003))
        high = max(prev, close) * (1 + wick)
        low = min(prev, close) * (1 - wick * 0.8)
        vol = p["volume"][h] * frac
        return [open_time, f"{prev:.8g}", f"{high:.8g}", f"{low:.8g}", f"{close:.8g}", f"{vol:.4f}",
                open_time + HOUR_MS - 1, f"{vol * close:.4f}", 100, "0", "0", "0"]

    def klines(self, sym: str, interval: str, limit: int, start: int | None, end: int | None) -> list:
        now = self.now()
        cur = (now - self.t0) // HOUR_MS
        first_h = max(0, (self.listing[sym] - self.t0) // HOUR_MS)
        if interval == "1h":
            last_h = cur if end is None else min(cur, (end - self.t0) // HOUR_MS)
            lo = first_h if start is None else max(first_h, -(-(start - self.t0) // HOUR_MS))
            hs = range(lo, last_h + 1)
            hs = hs[:limit] if start is not None else hs[-limit:]
            return [self._candle(sym, h, now) for h in hs]
        if interval == "1d":
            day0 = self.t0 // DAY_MS + 1
            cur_d = now // DAY_MS
            first_d = max(day0, -(-self.listing[sym] // DAY_MS))
            lo = first_d if start is None else max(first_d, -(-start // DAY_MS))
            ds = range(lo, cur_d + 1)
            ds = ds[:limit] if start is not None else ds[-limit:]
            out = []
            for d in ds:
                hs = [h for h in range((d * DAY_MS - self.t0) // HOUR_MS, ((d + 1) * DAY_MS - self.t0) // HOUR_MS)
                      if 0 <= h <= cur]
                rows = [self._candle(sym, h, now) for h in hs]
                if not rows:
                    continue
                vol = sum(float(r[5]) for r in rows)
                out.append([d * DAY_MS, rows[0][1], f"{max(float(r[2]) for r in rows):.8g}",
                            f"{min(float(r[3]) for r in rows):.8g}", rows[-1][4],
                            f"{vol:.4f}", (d + 1) * DAY_MS - 1, f"{sum(float(r[7]) for r in rows):.4f}", 0, "0", "0", "0"])
            return out
        raise ValueError(interval)


def make_app(market: Market) -> web.Application:
    app = web.Application()

    async def exchange_info(_):
        return web.json_response({"symbols": [
            {"symbol": s, "status": "TRADING", "baseAsset": s[:-4], "quoteAsset": "USDT"} for s in market.coins]
            + [{"symbol": "USDCUSDT", "status": "TRADING", "baseAsset": "USDC", "quoteAsset": "USDT"}]})

    async def ticker(_):
        now = market.now()
        cur = (now - market.t0) // HOUR_MS
        out = []
        for s in market.coins:
            rows = market.klines(s, "1h", 24, None, None)
            qv = sum(float(r[7]) for r in rows)
            first, last = float(rows[0][1]), float(rows[-1][4])
            out.append({"symbol": s, "quoteVolume": f"{qv:.2f}", "lastPrice": f"{last:.8g}",
                        "priceChangePercent": f"{(last / first - 1) * 100:.2f}"})
        out.append({"symbol": "USDCUSDT", "quoteVolume": "9e9", "lastPrice": "1", "priceChangePercent": "0"})
        return web.json_response(out)

    async def klines(request):
        q = request.query
        sym = q.get("symbol", "")
        if sym not in market.coins:
            return web.json_response({"code": -1121, "msg": "Invalid symbol."}, status=400)
        rows = market.klines(sym, q.get("interval", "1h"), min(int(q.get("limit", 500)), 1000),
                             int(q["startTime"]) if "startTime" in q else None,
                             int(q["endTime"]) if "endTime" in q else None)
        return web.json_response(rows, headers={"x-mbx-used-weight-1m": "10"})

    async def server_time(_):
        return web.json_response({"serverTime": market.now()})

    app.router.add_get("/api/v3/exchangeInfo", exchange_info)
    app.router.add_get("/api/v3/ticker/24hr", ticker)
    app.router.add_get("/api/v3/klines", klines)
    app.router.add_get("/api/v3/time", server_time)
    return app


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9100)
    ap.add_argument("--host", default="0.0.0.0")
    a = ap.parse_args()
    web.run_app(make_app(Market()), host=a.host, port=a.port, print=None)
