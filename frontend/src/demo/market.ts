// Live market data for the browser demo, straight from Binance's public market-data API.
import { regimeSeries, scoreLatest, type Bars, type Config } from "./engine";

const BASE = "https://data-api.binance.vision";
const STABLE = new Set(["USDC", "FDUSD", "RLUSD", "USD1", "TUSD", "BUSD", "DAI", "USDP", "EUR", "GBP", "EURC", "USDT", "AEUR", "PYUSD", "XUSD", "BFUSD"]);
const H = 3_600_000;

async function get(path: string, attempt = 0): Promise<any> {
  const r = await fetch(BASE + path);
  if (r.ok) return r.json();
  if ((r.status === 429 || r.status >= 500) && attempt < 3) { await new Promise((s) => setTimeout(s, 1500 * (attempt + 1))); return get(path, attempt + 1); }
  throw new Error(`Binance returned ${r.status}`);
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>, onDone?: () => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); onDone?.(); }
  }));
  return out;
}

export function toBars(rows: any[][]): Bars {
  return { t: rows.map((r) => r[0]), o: rows.map((r) => +r[1]), h: rows.map((r) => +r[2]), l: rows.map((r) => +r[3]),
    c: rows.map((r) => +r[4]), v: rows.map((r) => +r[5]), qv: rows.map((r) => +r[7]) };
}

export interface Universe { symbol: string; quote_volume_24h: number }

export async function universe(): Promise<Universe[]> {
  const [info, tickers] = await Promise.all([get("/api/v3/exchangeInfo?permissions=SPOT"), get("/api/v3/ticker/24hr")]);
  const meta = new Map<string, any>(info.symbols.filter((s: any) => s.status === "TRADING" && s.quoteAsset === "USDT").map((s: any) => [s.symbol, s]));
  return tickers.flatMap((t: any) => {
    const s = meta.get(t.symbol);
    if (!s) return [];
    const b = s.baseAsset as string;
    if (STABLE.has(b) || !/^[A-Za-z0-9]{1,10}$/.test(b)) return [];
    return [{ symbol: t.symbol, quote_volume_24h: +t.quoteVolume }];
  });
}

export interface Snapshot {
  candleTime: number; finishedAt: number; bars: Record<string, Bars>; btc: Bars;
  daily: { t: number[]; c: number[] }; total: number;
}

/** Loads the last 1000 closed 1h candles for every coin above the volume filter (+ BTC). */
export async function loadSnapshot(minVolume: number, onProgress: (done: number, total: number) => void): Promise<Snapshot> {
  const all = await universe();
  const syms = all.filter((u) => u.quote_volume_24h >= minVolume).map((u) => u.symbol);
  if (!syms.includes("BTCUSDT")) syms.push("BTCUSDT");
  let done = 0;
  onProgress(0, syms.length);
  const rows = await pool(syms, 8, (s) => get(`/api/v3/klines?symbol=${s}&interval=1h&limit=1000`).catch(() => null),
    () => onProgress(++done, syms.length));
  const bars: Record<string, Bars> = {};
  syms.forEach((s, i) => { const r = rows[i]; if (r && r.length > 1) bars[s] = toBars(r.slice(0, -1)); }); // drop forming candle
  const dailyRows = (await get("/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=400")).slice(0, -1);
  const btc = bars.BTCUSDT;
  return { candleTime: btc.t[btc.t.length - 1], finishedAt: Date.now(), bars, btc,
    daily: { t: dailyRows.map((r: any[]) => r[0]), c: dailyRows.map((r: any[]) => +r[4]) }, total: syms.length };
}

/** Same rules as the backend worker's scan(). */
export function scan(snap: Snapshot, cfg: Config) {
  const btcMap = new Map(snap.btc.t.map((t, i) => [t, snap.btc.c[i]]));
  const reg = regimeSeries(snap.daily.t, snap.daily.c);
  const last = reg[reg.length - 1];
  const riskOn = !last || Number.isNaN(last.sma200) ? true : last.risk_on;
  const results: any[] = [];
  for (const [symbol, b] of Object.entries(snap.bars)) {
    if (b.t[b.t.length - 1] !== snap.candleTime) continue;
    // 1000 hourly candles = 41 days; a coin with fewer is younger than that.
    const historyDays = b.t.length >= 1000 ? Infinity : (snap.candleTime - b.t[0]) / 86_400_000;
    const r = scoreLatest(b, btcMap, cfg, historyDays);
    if (r) results.push({ symbol, ...r });
  }
  const passed = results.filter((r) => r.gate_reason === null);
  const rankable = riskOn || cfg.regime_mode === "flag" ? passed : [];
  const ranks = new Map([...rankable].sort((a, b) => b.score - a.score).map((r, i) => [r.symbol, i + 1]));
  const signals = results.map((r) => {
    let reason = r.gate_reason;
    if (reason === null && !riskOn && cfg.regime_mode === "suppress") reason = "Market risk-off (BTC below 200-day average)";
    return { ...r, rank: ranks.get(r.symbol) ?? null, gate_reason: reason, passed_gates: reason === null };
  });
  return {
    run: { id: 1, candle_time: new Date(snap.candleTime).toISOString(), finished_at: new Date(snap.finishedAt).toISOString(),
      status: "succeeded", regime: riskOn ? "risk_on" : "risk_off", btc_close: last?.close ?? null,
      btc_sma200d: last && !Number.isNaN(last.sma200) ? last.sma200 : null, coins_total: results.length,
      coins_passed: passed.length, weights: cfg.weights },
    signals,
  };
}

export async function loadBacktestData(symbols: string[], days: number, onProgress: (d: number, t: number) => void) {
  const warmupDays = Math.ceil(450 / 24) + 3;
  const start = Date.now() - (days + warmupDays) * 86_400_000;
  const want = [...new Set([...symbols, "BTCUSDT"])];
  let done = 0;
  onProgress(0, want.length);
  const fetchRange = async (s: string) => {
    const out: any[][] = [];
    let cursor = start;
    for (;;) {
      const batch = await get(`/api/v3/klines?symbol=${s}&interval=1h&limit=1000&startTime=${cursor}`);
      out.push(...batch);
      if (batch.length < 1000) break;
      cursor = batch[batch.length - 1][0] + 1;
    }
    return out.slice(0, -1);
  };
  const got = await pool(want, 6, (s) => fetchRange(s).catch(() => [] as any[][]), () => onProgress(++done, want.length));
  const frames: Record<string, Bars> = {};
  want.forEach((s, i) => { if (got[i].length) frames[s] = toBars(got[i]); });
  const btc = frames.BTCUSDT; delete frames.BTCUSDT;
  const listing: Record<string, number> = {};
  await pool(Object.keys(frames), 6, async (s) => {
    const r = await get(`/api/v3/klines?symbol=${s}&interval=1d&limit=1&startTime=0`).catch(() => null);
    if (r?.length) listing[s] = r[0][0];
  });
  const dailyRows = (await get("/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000")).slice(0, -1);
  return { frames, btc, listing, daily: { t: dailyRows.map((r: any[]) => r[0]), c: dailyRows.map((r: any[]) => +r[4]) } };
}

export { H };
