// Verifies the browser engine (src/demo/engine.ts) matches the Python engine exactly.
// Fixture: candles + Python results produced by backend/engine (see docs). Run:
//   node --experimental-strip-types scripts/parity-check.ts <fixture.json>
import { readFileSync } from "node:fs";
import { DEFAULT_WEIGHTS, runBacktest, scoreLatest, type Bars, type Config } from "../src/demo/engine.ts";

const fx = JSON.parse(readFileSync(process.argv[2], "utf8"));
const toBars = (rows: any[][]): Bars => ({
  t: rows.map((r) => r[0]), o: rows.map((r) => +r[1]), h: rows.map((r) => +r[2]), l: rows.map((r) => +r[3]),
  c: rows.map((r) => +r[4]), v: rows.map((r) => +r[5]), qv: rows.map((r) => +r[7]),
});
const cfg: Config = { min_quote_volume_24h: 2_000_000, min_history_days: 30, regime_mode: "flag", weights: { ...DEFAULT_WEIGHTS } };
const frames: Record<string, Bars> = {};
for (const [s, rows] of Object.entries<any[][]>(fx.frames)) frames[s] = toBars(rows);
const btc = frames.BTCUSDT; delete frames.BTCUSDT;
const btcMap = new Map(btc.t.map((t, i) => [t, btc.c[i]]));
let worst = 0, n = 0;
const close = (a: any, b: any, label: string) => {
  if (a === null || b === null) { if (a !== b) throw new Error(`${label}: ${a} vs ${b}`); return; }
  const d = Math.abs(a - b); worst = Math.max(worst, d); n++;
  if (d > 1e-6) throw new Error(`${label}: ts ${a} vs py ${b}`);
};
for (const [s, b] of Object.entries(frames)) {
  const last = (k: keyof Bars) => (b[k] as number[]).slice(-1000);
  const bars = { t: last("t"), o: last("o"), h: last("h"), l: last("l"), c: last("c"), v: last("v"), qv: last("qv") };
  const hd = (b.t[b.t.length - 1] - fx.listing[s]) / 86_400_000;
  const r = scoreLatest(bars, btcMap, cfg, hd)!;
  const py = fx.py_scores[s];
  close(r.score, py.score, `${s} score`); close(r.rsi, py.rsi, `${s} rsi`); close(r.rvol, py.rvol, `${s} rvol`);
  close(r.stop_price, py.stop, `${s} stop`);
  for (const k of Object.keys(py.comp)) close(r.components[k].score, py.comp[k], `${s} ${k}`);
  if (r.gate_reason !== py.gate) throw new Error(`${s} gate: ${r.gate_reason} vs ${py.gate}`);
}
const daily = { t: fx.daily.map((r: any[]) => r[0]), c: fx.daily.map((r: any[]) => +r[4]) };
const { metrics, curve } = runBacktest(frames, btc, daily, cfg, fx.listing,
  { days: 150, top_k: 3, hold_hours: 72, min_score: 50, fee_pct: 0.1, regime_filter: true });
for (const k of ["walk_forward", "default_weights", "universe", "btc"] as const) {
  for (const m of Object.keys(fx.py_metrics[k])) close((metrics as any)[k][m], fx.py_metrics[k][m], `backtest ${k}.${m}`);
}
close(metrics.excess_vs_universe_pct, fx.py_metrics.excess_vs_universe_pct, "excess");
close(metrics.window.test_periods, fx.py_metrics.window.test_periods, "test periods");
close(metrics.risk_off_periods, fx.py_metrics.risk_off_periods, "risk-off periods");
close(curve[curve.length - 1].strategy, fx.py_curve_last.strategy, "equity end");
console.log(`PARITY OK: ${n} values compared across ${Object.keys(frames).length} coins + backtest; max abs diff ${worst.toExponential(2)}`);
