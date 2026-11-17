import { ArrowRight, Clock, Gauge, Layers, Star, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import SignalsTable from "../components/SignalsTable";
import { Change, CoinAvatar, Empty, ErrorNote, Kpi, Loading, Panel, RegimePill, Segmented, tooltipStyle } from "../components/ui";
import type { ScanRun, Signal } from "../lib/api";
import { base, price, timeAgo } from "../lib/format";
import { useApi } from "../lib/useApi";
import { LiveLoading } from "../demo/DemoBits";

interface Latest { run: ScanRun | null; signals: Signal[] }
interface BtcPoint { t: string; close: number; sma200: number | null }
interface WatchItem { symbol: string; score: number | null; close: number | null; ret_1d: number | null }

function nextScanIn(candleTime: string) {
  const next = new Date(candleTime).getTime() + 2 * 3600_000 + 60_000; // candle open + 1h close + 1h + ~1 min
  const mins = Math.max(0, Math.round((next - Date.now()) / 60_000));
  return mins > 60 ? "in about an hour" : `in ~${mins} min`;
}

export default function Dashboard() {
  const latest = useApi<Latest>("/api/signals/latest", 60_000);
  const [days, setDays] = useState(90);
  const btc = useApi<BtcPoint[]>(`/api/market/btc?days=${days}`);
  const watch = useApi<WatchItem[]>("/api/watchlist", 60_000);

  const run = latest.data?.run;
  const top = latest.data?.signals[0];
  const pctAbove = run?.btc_close && run.btc_sma200d ? run.btc_close / run.btc_sma200d - 1 : null;

  const chart = useMemo(() => (btc.data ?? []).map((p) => ({
    t: new Date(p.t).toLocaleDateString(undefined, { month: "short", day: "numeric" }), close: p.close, sma200: p.sma200,
  })), [btc.data]);

  if (latest.loading && !latest.data) return <LiveLoading />;
  if (latest.error) return <ErrorNote message={latest.error} />;
  if (!run) {
    return (
      <div className="card p-4">
        <Empty title="The first scan hasn't finished yet">
          The worker is loading price history from Binance. Results appear within a few minutes of the first start.
        </Empty>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<Gauge className="h-4 w-4" />} label="Market regime (BTC vs 200-day average)"
          value={run.regime === "risk_on" ? "Risk-on" : "Risk-off"}
          sub={<span className="flex items-center gap-2"><RegimePill regime={run.regime} />
            {pctAbove != null && <Change v={pctAbove} />}</span>} />
        <Kpi icon={<Layers className="h-4 w-4" />} label="Coins passing the gates"
          value={<>{run.coins_passed}<span className="text-base font-medium text-mute"> / {run.coins_total}</span></>}
          sub={<span className="text-mute">Liquidity, listing age and history checks</span>} />
        <Kpi tone="amber" icon={<TrendingUp className="h-4 w-4" />} label="Top-ranked setup"
          value={top ? <Link to={`/coin/${top.symbol}`} className="hover:text-amber-400">{base(top.symbol)} <span className="text-amber-400">{top.score.toFixed(0)}</span></Link> : "—"}
          sub={top && <span className="text-mute">Score out of 100 · <Change v={top.ret_1d} /> 24h</span>} />
        <Kpi icon={<Clock className="h-4 w-4" />} label="Last candle close scanned (1h)"
          value={new Date(new Date(run.candle_time).getTime() + 3600_000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          sub={<span className="text-mute">Updated {timeAgo(run.finished_at)} · next {nextScanIn(run.candle_time)}</span>} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Panel title="Bitcoin vs its 200-day average" subtitle="Market regime"
          action={<Segmented value={days} onChange={setDays}
            options={[{ value: 30, label: "30D" }, { value: 90, label: "90D" }, { value: 180, label: "180D" }]} />}>
          <div className="h-[290px] px-2 pb-3 pt-5">
            {btc.loading && !btc.data ? <Loading /> : (
              <ResponsiveContainer>
                <AreaChart data={chart} margin={{ left: 8, right: 16 }}>
                  <defs>
                    <linearGradient id="btcFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7C5CFF" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#7C5CFF" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1C2030" strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="t" stroke="#4B5268" fontSize={11} tickLine={false} axisLine={false} minTickGap={40} />
                  <YAxis stroke="#4B5268" fontSize={11} tickLine={false} axisLine={false} width={64}
                    domain={["auto", "auto"]} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [`$${price(v)}`, n === "close" ? "BTC close" : "200-day avg"]} />
                  <Area type="monotone" dataKey="close" stroke="#9A84FF" strokeWidth={2} fill="url(#btcFill)" />
                  <Line type="monotone" dataKey="sma200" stroke="#F5A524" strokeWidth={1.6} strokeDasharray="5 5" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="flex gap-5 border-t border-line px-5 py-3 text-xs text-mute">
            <span className="flex items-center gap-2"><span className="h-0.5 w-4 rounded bg-violet-400" />BTC daily close</span>
            <span className="flex items-center gap-2"><span className="h-0.5 w-4 rounded border-t border-dashed border-amber-500" />200-day average</span>
            <span className="ml-auto hidden sm:block">Above the line = risk-on. Most altcoins struggle when BTC is below it.</span>
          </div>
        </Panel>

        <Panel title="Watchlist" subtitle="Your coins" action={<Link to="/watchlist" className="text-xs font-semibold text-violet-300 hover:text-violet-200">Manage</Link>}>
          {watch.data && watch.data.length ? (
            <ul className="divide-y divide-line">
              {watch.data.slice(0, 6).map((w) => (
                <li key={w.symbol}>
                  <Link to={`/coin/${w.symbol}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-ink-850">
                    <CoinAvatar symbol={w.symbol} size={30} />
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-white">{base(w.symbol)}</div>
                      <div className="num text-xs text-mute">{price(w.close)}</div>
                    </div>
                    <div className="text-right">
                      <div className="num text-sm font-bold text-white">{w.score?.toFixed(0) ?? "—"}</div>
                      <Change v={w.ret_1d} className="text-xs" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing here yet">
              <span className="inline-flex items-center gap-1">Open any coin and tap <Star className="h-3.5 w-3.5" /> to follow it.</span>
            </Empty>
          )}
        </Panel>
      </div>

      <Panel title="Top setups this hour" subtitle="Ranked by score"
        action={<Link to="/screener" className="inline-flex items-center gap-1 text-xs font-semibold text-violet-300 hover:text-violet-200">
          Full screener <ArrowRight className="h-3.5 w-3.5" /></Link>}>
        {run.regime === "risk_off" && (
          <div className="border-b border-line bg-down/5 px-5 py-3 text-sm text-down">
            Bitcoin is below its 200-day average. Momentum setups fail more often in this regime - size down or wait.
          </div>
        )}
        {latest.data!.signals.length ? <SignalsTable signals={latest.data!.signals.slice(0, 10)} compact />
          : <Empty title="No coins passed the gates this hour" />}
      </Panel>
    </div>
  );
}
