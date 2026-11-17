// Browser port of backend/engine/scoring.py and backend/engine/backtest.py (simulate).
// Kept line-for-line equivalent; parity with the Python engine is checked by
// frontend/scripts/parity-check.ts against identical candles.

export const FACTOR_KEYS = ["trend", "volume", "relative_strength", "breakout", "rsi", "no_chase"] as const;
export type FactorKey = (typeof FACTOR_KEYS)[number];
export type Weights = Record<FactorKey, number>;
export const DEFAULT_WEIGHTS: Weights = { trend: 30, volume: 20, relative_strength: 15, breakout: 15, rsi: 10, no_chase: 10 };
export const RVOL_LOOKBACK = 249;
export const MIN_BARS = RVOL_LOOKBACK + 1 + 200;

export interface Bars { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[]; qv: number[] }
export interface Config { min_quote_volume_24h: number; min_history_days: number; regime_mode: "flag" | "suppress"; weights: Weights }

const nan = Number.NaN;
const isNum = (x: number) => !Number.isNaN(x);
const clip01 = (x: number) => (Number.isNaN(x) ? nan : Math.min(1, Math.max(0, x)));

export function ema(s: number[], n: number): number[] {
  const out = new Array(s.length).fill(nan);
  const a = 2 / (n + 1);
  let prev = nan;
  for (let i = 0; i < s.length; i++) {
    prev = i === 0 ? s[0] : a * s[i] + (1 - a) * prev;
    if (i >= n - 1) out[i] = prev;
  }
  return out;
}

function wilder(values: number[], n: number): number[] {
  const out = new Array(values.length).fill(nan);
  if (values.length < n) return out;
  let avg = 0;
  for (let i = 0; i < n; i++) avg += values[i];
  avg /= n;
  out[n - 1] = avg;
  for (let i = n; i < values.length; i++) { avg = (avg * (n - 1) + values[i]) / n; out[i] = avg; }
  return out;
}

export function rsi(c: number[], n = 14): number[] {
  const d = c.slice(1).map((x, i) => x - c[i]);
  const g = wilder(d.map((x) => Math.max(x, 0)), n);
  const l = wilder(d.map((x) => Math.max(-x, 0)), n);
  const out = [nan];
  for (let i = 0; i < d.length; i++) {
    if (Number.isNaN(g[i])) out.push(nan);
    else if (l[i] === 0) out.push(g[i] === 0 ? 50 : 100);
    else out.push(100 - 100 / (1 + g[i] / l[i]));
  }
  return out;
}

export function atr(h: number[], l: number[], c: number[], n = 14): number[] {
  const tr = h.map((hi, i) => (i === 0 ? hi - l[0] : Math.max(hi - l[i], Math.abs(hi - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
  return wilder(tr, n);
}

const ret = (c: number[], k: number) => c.map((x, i) => (i >= k ? x / c[i - k] - 1 : nan));
function rollingPrevMax(h: number[], w: number) {
  return h.map((_, i) => { if (i < w) return nan; let m = -Infinity; for (let j = i - w; j < i; j++) m = Math.max(m, h[j]); return m; });
}

export interface Features {
  close: number[]; ret_1d: number[]; ret_3d: number[]; ret_7d: number[]; ema50: number[]; ema200: number[];
  ema50_rising: boolean[]; rvol: number[]; up_candle: boolean[]; high_72h: number[]; high_7d: number[];
  rsi: number[]; atr: number[]; atr_pct: number[]; quote_volume_24h: number[]; btc_ret_7d: number[];
}

/** btcClose: map from open-time ms to BTC close (forward-filled onto this coin's bars). */
export function features(b: Bars, btcClose: Map<number, number>): Features {
  const c = b.c, n = c.length;
  const e50 = ema(c, 50), e200 = ema(c, 200);
  const rvol = new Array(n).fill(nan);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (i >= 1) sum += b.v[i - 1];
    if (i >= RVOL_LOOKBACK + 1) sum -= b.v[i - 1 - RVOL_LOOKBACK];
    if (i >= RVOL_LOOKBACK) rvol[i] = b.v[i] / (sum / RVOL_LOOKBACK);
  }
  const qv24 = new Array(n).fill(nan);
  let q = 0;
  for (let i = 0; i < n; i++) { q += b.qv[i]; if (i >= 24) q -= b.qv[i - 24]; if (i >= 23) qv24[i] = q; }
  let last = nan;
  const btc = b.t.map((t) => { const v = btcClose.get(t); if (v !== undefined) last = v; return last; });
  const r = rsi(c, 14), a = atr(b.h, b.l, c, 14);
  return {
    close: c, ret_1d: ret(c, 24), ret_3d: ret(c, 72), ret_7d: ret(c, 168), ema50: e50, ema200: e200,
    ema50_rising: e50.map((x, i) => i >= 24 && x > e50[i - 24]),
    rvol, up_candle: c.map((x, i) => x > b.o[i]),
    high_72h: rollingPrevMax(b.h, 72), high_7d: rollingPrevMax(b.h, 168),
    rsi: r, atr: a, atr_pct: a.map((x, i) => x / c[i]), quote_volume_24h: qv24,
    btc_ret_7d: btc.map((x, i) => (i >= 168 ? x / btc[i - 168] - 1 : nan)),
  };
}

export type Components = Record<FactorKey, number[]>;

export function components(f: Features): Components {
  const n = f.close.length;
  const out = Object.fromEntries(FACTOR_KEYS.map((k) => [k, new Array(n).fill(nan)])) as Components;
  for (let i = 0; i < n; i++) {
    const valid = [f.ret_7d[i], f.ema200[i], f.rvol[i], f.high_7d[i], f.rsi[i], f.atr[i], f.btc_ret_7d[i]].every(isNum);
    if (!valid) continue;
    const c = f.close[i];
    const returnsUp = (+(f.ret_1d[i] > 0) + +(f.ret_3d[i] > 0) + +(f.ret_7d[i] > 0)) / 3;
    const structure = (+(c > f.ema50[i]) + +(c > f.ema200[i]) + +(f.ema50[i] > f.ema200[i]) + +f.ema50_rising[i]) / 4;
    out.trend[i] = 0.5 * returnsUp + 0.5 * structure;
    out.volume[i] = f.up_candle[i] ? clip01((f.rvol[i] - 1) / 2) : 0;
    out.relative_strength[i] = clip01((f.ret_7d[i] - f.btc_ret_7d[i]) / 0.2);
    out.breakout[i] = c > f.high_7d[i] ? 1 : c > f.high_72h[i] ? 0.6 : c >= 0.98 * f.high_72h[i] ? 0.3 : 0;
    const r = f.rsi[i];
    out.rsi[i] = r >= 50 && r <= 70 ? 1 : (r >= 45 && r < 50) || (r > 70 && r <= 75) ? 0.6 : r > 75 && r <= 80 ? 0.3 : 0;
    const chase = f.ret_1d[i] > 0.3 ? 0 : f.ret_1d[i] > 0.2 ? 0.5 : 1;
    out.no_chase[i] = f.atr_pct[i] > 0.05 ? chase * 0.5 : chase;
  }
  return out;
}

export function totalScore(comp: Components, w: Weights, i: number): number {
  let s = 0, ws = 0;
  for (const k of FACTOR_KEYS) { const v = comp[k][i]; if (Number.isNaN(v)) return nan; s += v * w[k]; ws += w[k]; }
  return (s * 100) / ws;
}

export function regimeSeries(dailyT: number[], dailyClose: number[]) {
  return dailyClose.map((c, i) => {
    let sma = nan;
    if (i >= 199) { let s = 0; for (let j = i - 199; j <= i; j++) s += dailyClose[j]; sma = s / 200; }
    return { t: dailyT[i], close: c, sma200: sma, risk_on: c > sma };
  });
}

export function gateReason(f: Features, i: number, cfg: Config, historyDays: number): string | null {
  if (!isNum(f.ret_7d[i]) || !isNum(f.ema200[i]) || !isNum(f.rvol[i])) return "Not enough candle history yet";
  if (historyDays < cfg.min_history_days) return `Listed less than ${cfg.min_history_days} days`;
  if (!(f.quote_volume_24h[i] >= cfg.min_quote_volume_24h)) return "24h volume below filter";
  return null;
}

const num = (x: number) => (Number.isNaN(x) ? null : x);

export function scoreLatest(b: Bars, btc: Map<number, number>, cfg: Config, historyDays: number) {
  if (!b.c.length) return null;
  const f = features(b, btc);
  const comp = components(f);
  const i = b.c.length - 1;
  const total = totalScore(comp, cfg.weights, i);
  const score = Number.isNaN(total) ? 0 : total;
  const detail: Record<string, any> = {};
  for (const k of FACTOR_KEYS) detail[k] = { score: num(comp[k][i]), weight: cfg.weights[k] };
  detail.trend.raw = { ret_1d: num(f.ret_1d[i]), ret_3d: num(f.ret_3d[i]), ret_7d: num(f.ret_7d[i]), ema50: num(f.ema50[i]), ema200: num(f.ema200[i]), ema50_rising: f.ema50_rising[i] };
  detail.volume.raw = { rvol: num(f.rvol[i]), up_candle: f.up_candle[i] };
  detail.relative_strength.raw = { ret_7d: num(f.ret_7d[i]), btc_ret_7d: num(f.btc_ret_7d[i]) };
  detail.breakout.raw = { high_72h: num(f.high_72h[i]), high_7d: num(f.high_7d[i]) };
  detail.rsi.raw = { rsi: num(f.rsi[i]) };
  detail.no_chase.raw = { ret_1d: num(f.ret_1d[i]), atr_pct: num(f.atr_pct[i]) };
  const close = b.c[i];
  return {
    score: Math.round(Math.max(0, Math.min(100, score)) * 100) / 100,
    gate_reason: gateReason(f, i, cfg, historyDays),
    components: detail, close, rsi: num(f.rsi[i]), rvol: num(f.rvol[i]), ret_1d: num(f.ret_1d[i]), ret_7d: num(f.ret_7d[i]),
    stop_price: Number.isNaN(f.atr[i]) ? null : close - 2 * f.atr[i], exit_level: num(f.ema50[i]),
    history: { t: b.t.slice(-72), score: b.t.slice(-72).map((_, j) => num(totalScore(comp, cfg.weights, i - 71 + j))) },
  };
}

// ── Backtest (port of engine/backtest.py: build_panel + simulate) ──────────────

export function weightSets(): Record<string, Weights> {
  const sets: Record<string, Weights> = { default: { ...DEFAULT_WEIGHTS } };
  sets.equal = Object.fromEntries(FACTOR_KEYS.map((k) => [k, 100 / FACTOR_KEYS.length])) as Weights;
  for (const f of FACTOR_KEYS) {
    const w = { ...DEFAULT_WEIGHTS };
    const donor: FactorKey = f === "trend" ? "volume" : "trend";
    w[f] += 10; w[donor] -= 10;
    sets[`more_${f}`] = w;
  }
  return sets;
}

interface PanelRow { comp: Record<FactorKey, number>; fwd: number }

function mean(xs: number[]) { const v = xs.filter(isNum); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : nan; }
function std(xs: number[]) { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); }
const r2 = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

function stats(rIn: number[], ppy: number) {
  const r = rIn.map((x) => (Number.isNaN(x) ? 0 : x));
  let eq = 1, peak = 1, dd = 0;
  for (const x of r) { eq *= 1 + x; peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1); }
  const vol = r.length > 1 ? std(r) : nan;
  return {
    periods: r.length, avg_return_pct: r2(mean(r) * 100, 3), hit_rate_pct: r2((r.filter((x) => x > 0).length / (r.length || 1)) * 100, 1),
    total_return_pct: r.length ? r2((eq - 1) * 100, 2) : 0, max_drawdown_pct: r.length ? r2(dd * 100, 2) : 0,
    sharpe: vol > 0 ? r2((mean(r) / vol) * Math.sqrt(ppy), 2) : null,
  };
}

export interface BacktestParams { days: number; top_k: number; hold_hours: number; min_score: number; fee_pct: number; regime_filter: boolean }

export function runBacktest(frames: Record<string, Bars>, btc1h: Bars, btcDaily: { t: number[]; c: number[] }, cfg: Config,
  listing: Record<string, number>, p: BacktestParams) {
  const H = 3_600_000, hold = p.hold_hours;
  const btcMap = new Map(btc1h.t.map((t, i) => [t, btc1h.c[i]]));
  // panel: time -> rows that passed the gates at that time
  const panel = new Map<number, PanelRow[]>();
  let tMax = 0;
  for (const [sym, b] of Object.entries(frames)) {
    if (b.c.length < MIN_BARS + hold) continue;
    const f = features(b, btcMap);
    const comp = components(f);
    const first = listing[sym] ?? b.t[0];
    for (let i = 0; i < b.c.length; i++) {
      tMax = Math.max(tMax, b.t[i]);
      const ok = FACTOR_KEYS.every((k) => isNum(comp[k][i])) && f.quote_volume_24h[i] >= cfg.min_quote_volume_24h
        && (b.t[i] - first) / 86_400_000 >= cfg.min_history_days;
      if (!ok) continue;
      const fwd = i + hold < b.c.length ? b.c[i + hold] / b.c[i] - 1 : nan;
      const row: PanelRow = { comp: Object.fromEntries(FACTOR_KEYS.map((k) => [k, comp[k][i]])) as any, fwd };
      (panel.get(b.t[i]) ?? panel.set(b.t[i], []).get(b.t[i])!).push(row);
    }
  }
  const start = Math.floor((tMax - p.days * 86_400_000) / H) * H;
  const times: number[] = [];
  for (let t = start; t <= tMax - hold * H; t += hold * H) times.push(t);

  const reg = regimeSeries(btcDaily.t.map((t) => t + 86_400_000), btcDaily.c); // known after the day closes
  const cost = (2 * p.fee_pct) / 100;
  const sets = weightSets();
  const names = Object.keys(sets);
  const rows = times.map((t) => {
    const g = panel.get(t) ?? [];
    let ri = -1;
    for (let i = 0; i < reg.length && reg[i].t <= t; i++) ri = i;
    const riskOn = ri < 0 || Number.isNaN(reg[ri].sma200) ? true : reg[ri].risk_on;
    const b0 = btcMap.get(t), b1 = btcMap.get(t + hold * H);
    const row: Record<string, any> = { t, risk_on: riskOn, btc: b0 && b1 ? b1 / b0 - 1 : nan, coins: g.length };
    if (!g.length) { row.universe = 0; for (const n of names) row[n] = 0; return row; }
    row.universe = mean(g.map((x) => x.fwd)) - cost;
    for (const n of names) {
      const w = sets[n];
      const ws = FACTOR_KEYS.reduce((a, k) => a + w[k], 0);
      const picks = g.map((x) => ({ s: (FACTOR_KEYS.reduce((a, k) => a + x.comp[k] * w[k], 0) * 100) / ws, fwd: x.fwd }))
        .filter((x) => x.s >= p.min_score).sort((a, b) => b.s - a.s).slice(0, p.top_k);
      row[n] = !picks.length || (p.regime_filter && !riskOn) ? 0 : mean(picks.map((x) => x.fwd)) - cost;
    }
    return row;
  });

  const warm = Math.max(10, Math.floor(rows.length * 0.4));
  rows.forEach((row, i) => {
    if (i < warm) { row.walk_forward = nan; row.chosen = null; return; }
    const past = rows.slice(0, i);
    let best = names[0], bestV = -Infinity;
    for (const n of names) { const v = mean(past.map((r) => r[n] - r.universe)); if (v > bestV) { bestV = v; best = n; } }
    row.walk_forward = row[best]; row.chosen = best;
  });
  const test = rows.slice(warm);
  const ppy = (365 * 24) / hold;
  const chosen: Record<string, number> = {};
  test.forEach((r) => { chosen[r.chosen] = (chosen[r.chosen] ?? 0) + 1; });
  const metrics = {
    window: { start: test.length ? new Date(test[0].t).toISOString() : null, end: test.length ? new Date(test[test.length - 1].t).toISOString() : null,
      training_periods: warm, test_periods: test.length },
    walk_forward: stats(test.map((r) => r.walk_forward), ppy), default_weights: stats(test.map((r) => r.default), ppy),
    universe: stats(test.map((r) => r.universe), ppy), btc: stats(test.map((r) => r.btc), ppy),
    excess_vs_universe_pct: test.length ? r2(mean(test.map((r) => r.walk_forward - r.universe)) * 100, 3) : null,
    risk_off_periods: test.filter((r) => !r.risk_on).length,
    avg_coins_per_period: test.length ? r2(mean(test.map((r) => r.coins)), 1) : 0,
    weights_chosen: chosen, weight_sets: sets,
    caveats: [
      "Uses today's coin list (survivorship bias): delisted coins are missing.",
      "Fills at the hourly close; real fills may be worse on thin books.",
      "Past results don't guarantee future returns. This is a screener, not advice.",
    ],
  };
  let es = 1, eu = 1, eb = 1;
  const curve = test.map((r) => {
    es *= 1 + (Number.isNaN(r.walk_forward) ? 0 : r.walk_forward); eu *= 1 + (Number.isNaN(r.universe) ? 0 : r.universe);
    eb *= 1 + (Number.isNaN(r.btc) ? 0 : r.btc);
    return { t: new Date(r.t).toISOString(), strategy: r2(es, 4), universe: r2(eu, 4), btc: r2(eb, 4) };
  });
  return { metrics, curve };
}
