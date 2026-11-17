import clsx from "clsx";
import { FlaskConical, Info, Play } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Empty, ErrorNote, Kpi, Loading, Panel, tooltipStyle } from "../components/ui";
import { api, type Backtest } from "../lib/api";
import { useAuth } from "../lib/auth";
import { timeAgo } from "../lib/format";
import { useApi } from "../lib/useApi";

const rows: [string, string, (v: any) => string][] = [
  ["total_return_pct", "Total return", (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`],
  ["avg_return_pct", "Avg return per period", (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`],
  ["hit_rate_pct", "Winning periods", (v) => `${v.toFixed(0)}%`],
  ["max_drawdown_pct", "Worst drawdown", (v) => `${v.toFixed(1)}%`],
  ["sharpe", "Sharpe (annualised)", (v) => (v == null ? "—" : v.toFixed(2))],
];

function NewRun({ onQueued }: { onQueued: () => void }) {
  const [f, setF] = useState({ days: 365, top_k: 5, hold_hours: 72, min_score: 60, fee_pct: 0.1, regime_filter: true });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api("/api/backtests", { method: "POST", json: f }); onQueued(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const num = (k: keyof typeof f, label: string, min: number, max: number, step = 1) => (
    <label className="block"><span className="mb-1.5 block text-xs text-mute">{label}</span>
      <input className="input num" type="number" min={min} max={max} step={step} value={f[k] as number}
        onChange={(e) => setF({ ...f, [k]: +e.target.value })} /></label>
  );
  return (
    <form onSubmit={submit} className="grid items-end gap-4 p-5 sm:grid-cols-3 xl:grid-cols-7">
      {num("days", "Days tested", 60, 1095)}
      {num("top_k", "Coins held", 1, 20)}
      {num("hold_hours", "Hold (hours)", 6, 336)}
      {num("min_score", "Min score", 0, 100)}
      {num("fee_pct", "Fee per side %", 0, 1, 0.01)}
      <label className="flex h-[42px] items-center gap-2 text-sm text-soft">
        <input type="checkbox" className="accent-violet-500" checked={f.regime_filter}
          onChange={(e) => setF({ ...f, regime_filter: e.target.checked })} />Cash when risk-off</label>
      <button className="btn-primary" disabled={busy}><Play className="h-4 w-4" />{busy ? "Queuing…" : "Run backtest"}</button>
      {err && <div className="sm:col-span-3 xl:col-span-7"><ErrorNote message={err} /></div>}
    </form>
  );
}

export default function Backtests() {
  const { can } = useAuth();
  const list = useApi<Backtest[]>("/api/backtests", 5000);
  const [selected, setSelected] = useState<number | null>(null);
  const done = list.data?.filter((b) => b.status === "succeeded") ?? [];
  const current = list.data?.find((b) => b.id === selected) ?? done[0];
  const pending = list.data?.find((b) => b.status === "queued" || b.status === "running");
  const m = current?.metrics;

  const curve = useMemo(() => (current?.equity_curve ?? []).map((p: any) => ({
    t: new Date(p.t).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    Screener: +((p.strategy - 1) * 100).toFixed(2), "All gated coins": +((p.universe - 1) * 100).toFixed(2),
    "Hold BTC": +((p.btc - 1) * 100).toFixed(2),
  })), [current]);

  if (list.loading && !list.data) return <Loading />;
  if (list.error) return <ErrorNote message={list.error} />;

  return (
    <div className="space-y-6">
      {can("analyst") && (
        <Panel title="Run a backtest" subtitle="Walk-forward, fees included"
          action={pending && <span className="chip border-amber-500/30 bg-amber-500/10 text-amber-400">
            <FlaskConical className="h-3.5 w-3.5 animate-pulse" /> Backtest #{pending.id} {pending.status}…</span>}>
          <NewRun onQueued={list.reload} />
        </Panel>
      )}

      {!m ? (
        <div className="card"><Empty title="No finished backtests yet">
          {can("analyst") ? "Run one above. It downloads up to 3 years of hourly candles, so it can take several minutes." :
            "An analyst or admin can run one."}</Empty></div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={<FlaskConical className="h-4 w-4" />} label="Screener (walk-forward) total return"
              value={`${m.walk_forward.total_return_pct > 0 ? "+" : ""}${m.walk_forward.total_return_pct.toFixed(1)}%`}
              sub={<span className="text-mute">{m.window.test_periods} out-of-sample periods</span>} />
            <Kpi tone="amber" icon={<FlaskConical className="h-4 w-4" />} label="Edge vs all gated coins, per period"
              value={`${m.excess_vs_universe_pct > 0 ? "+" : ""}${m.excess_vs_universe_pct.toFixed(2)}%`}
              sub={<span className="text-mute">The honest test: better than random picks?</span>} />
            <Kpi icon={<FlaskConical className="h-4 w-4" />} label="Universe (random-pick) total return"
              value={`${m.universe.total_return_pct > 0 ? "+" : ""}${m.universe.total_return_pct.toFixed(1)}%`} />
            <Kpi icon={<FlaskConical className="h-4 w-4" />} label="Hold BTC total return"
              value={`${m.btc.total_return_pct > 0 ? "+" : ""}${m.btc.total_return_pct.toFixed(1)}%`} />
          </div>

          <Panel title="Cumulative return over the test window" subtitle={`Backtest #${current!.id} · ${timeAgo(current!.finished_at)}`}>
            <div className="h-[320px] px-2 pb-3 pt-5">
              <ResponsiveContainer>
                <LineChart data={curve} margin={{ left: 8, right: 16 }}>
                  <CartesianGrid stroke="#1C2030" strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="t" stroke="#4B5268" fontSize={11} tickLine={false} axisLine={false} minTickGap={50} />
                  <YAxis stroke="#4B5268" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                  <Tooltip {...tooltipStyle} formatter={(v: any) => `${v}%`} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#8B93A7" }} />
                  <Line type="monotone" dataKey="Screener" stroke="#9A84FF" strokeWidth={2.2} dot={false} />
                  <Line type="monotone" dataKey="All gated coins" stroke="#8B93A7" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="Hold BTC" stroke="#F5A524" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
            <Panel title="Results side by side" subtitle="Out-of-sample periods only">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-line"><tr>
                    <th className="th">Metric</th><th className="th text-right">Screener</th><th className="th text-right">Default weights</th>
                    <th className="th text-right">All gated coins</th><th className="th text-right">Hold BTC</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {rows.map(([k, label, f]) => (
                      <tr key={k}><td className="td text-mute">{label}</td>
                        {["walk_forward", "default_weights", "universe", "btc"].map((s) => (
                          <td key={s} className={clsx("td num text-right", s === "walk_forward" ? "font-semibold text-white" : "text-soft")}>
                            {m[s][k] == null ? "—" : f(m[s][k])}</td>))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel title="Read this before trusting it" subtitle="Method & caveats">
              <ul className="space-y-3 p-5 text-xs leading-relaxed text-mute">
                <li className="flex gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
                  Weights are picked only from earlier periods ({m.window.training_periods} training periods), then tested on later ones.</li>
                <li className="flex gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
                  {m.coins_tested} coins tested, about {m.avg_coins_per_period} passing the gates per period; {m.risk_off_periods} periods were risk-off.</li>
                {m.caveats.map((c: string) => (
                  <li key={c} className="flex gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />{c}</li>
                ))}
                <li className="text-[11px]">Settings: {Object.entries(current!.params).map(([k, v]) => `${k}=${v}`).join(" · ")}</li>
              </ul>
            </Panel>
          </div>
        </>
      )}

      {list.data && list.data.length > 1 && (
        <Panel title="History" subtitle="Recent runs">
          <div className="divide-y divide-line">
            {list.data.map((b) => (
              <button key={b.id} onClick={() => b.status === "succeeded" && setSelected(b.id)}
                className="flex w-full items-center justify-between px-5 py-3 text-left text-sm hover:bg-ink-850">
                <span className="text-white">#{b.id} · {b.params.days} days · top {b.params.top_k} · hold {b.params.hold_hours}h</span>
                <span className={clsx("text-xs", b.status === "failed" ? "text-down" : "text-mute")}>
                  {b.status === "failed" ? `failed: ${b.error?.slice(0, 60)}` : `${b.status} · ${timeAgo(b.created_at)}`}</span>
              </button>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
