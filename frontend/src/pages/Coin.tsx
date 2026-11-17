import clsx from "clsx";
import { ArrowLeft, ShieldAlert, Star, Target } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Change, CoinAvatar, ErrorNote, Loading, Panel, ScoreRing, tooltipStyle } from "../components/ui";
import { api, type Candle, type Signal } from "../lib/api";
import { FACTORS, base, price } from "../lib/format";
import { useApi } from "../lib/useApi";

interface Detail { symbol: string; signal: Signal | null; candles: Candle[]; score_history: { t: string; score: number; rank: number | null }[]; on_watchlist: boolean }

function ema(values: number[], n: number) {
  const k = 2 / (n + 1);
  let prev: number | null = null;
  return values.map((v) => (prev = prev === null ? v : v * k + prev * (1 - k)));
}

function rawLine(key: string, raw: Record<string, any> | undefined): string {
  if (!raw) return "";
  const p = (x: number | null | undefined) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
  switch (key) {
    case "trend": return `1d ${p(raw.ret_1d)} · 3d ${p(raw.ret_3d)} · 7d ${p(raw.ret_7d)} · EMA50 ${raw.ema50_rising ? "rising" : "falling"}`;
    case "volume": return `RVOL ${raw.rvol?.toFixed(2) ?? "—"} on a ${raw.up_candle ? "green" : "red"} candle`;
    case "relative_strength": return `Coin 7d ${p(raw.ret_7d)} vs BTC ${p(raw.btc_ret_7d)}`;
    case "breakout": return `72h high ${price(raw.high_72h)} · 7d high ${price(raw.high_7d)}`;
    case "rsi": return `RSI(14) = ${raw.rsi?.toFixed(1) ?? "—"}`;
    case "no_chase": return `24h move ${p(raw.ret_1d)} · hourly range ${raw.atr_pct != null ? (raw.atr_pct * 100).toFixed(2) + "%" : "—"}`;
  }
  return "";
}

export default function Coin() {
  const { symbol = "" } = useParams();
  const { data, error, loading, reload } = useApi<Detail>(`/api/symbols/${symbol}`);
  const [busy, setBusy] = useState(false);

  const chart = useMemo(() => {
    if (!data) return [];
    const closes = data.candles.map((c) => c.c);
    const e50 = ema(closes, 50);
    return data.candles.map((c, i) => ({
      t: new Date(c.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" }),
      close: c.c, ema50: i >= 49 ? e50[i] : null,
    }));
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const s = data.signal;

  const toggleWatch = async () => {
    setBusy(true);
    try {
      if (data.on_watchlist) await api(`/api/watchlist/${data.symbol}`, { method: "DELETE" });
      else await api("/api/watchlist", { method: "POST", json: { symbol: data.symbol } });
      await reload();
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <Link to="/screener" className="inline-flex items-center gap-1.5 text-sm text-mute hover:text-soft"><ArrowLeft className="h-4 w-4" />Back to screener</Link>

      <div className="card card-glow flex flex-wrap items-center gap-6 p-6">
        <CoinAvatar symbol={data.symbol} size={52} />
        <div className="min-w-[180px] flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-white">{base(data.symbol)}</h2>
            <span className="text-sm text-mute">/ USDT · Binance Spot</span>
          </div>
          <div className="mt-1 flex items-center gap-3">
            <span className="num text-xl font-semibold text-white">{price(s?.close)}</span>
            <Change v={s?.ret_1d} /> <span className="text-xs text-mute">24h</span>
            <Change v={s?.ret_7d} /> <span className="text-xs text-mute">7d</span>
          </div>
          {s?.gate_reason && <div className="mt-2 text-sm text-amber-400">Not ranked: {s.gate_reason}</div>}
          {s?.rank && <div className="mt-2 text-sm text-mute">Ranked <span className="font-semibold text-white">#{s.rank}</span> this hour</div>}
        </div>
        {s && <ScoreRing score={s.score} />}
        <button onClick={toggleWatch} disabled={busy} className={data.on_watchlist ? "btn-ghost" : "btn-primary"}>
          <Star className={clsx("h-4 w-4", data.on_watchlist && "fill-amber-400 text-amber-400")} />
          {data.on_watchlist ? "On watchlist" : "Add to watchlist"}
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Panel title="Price, last 7 days" subtitle="1-hour closes">
          <div className="h-[300px] px-2 pb-3 pt-5">
            <ResponsiveContainer>
              <ComposedChart data={chart} margin={{ left: 8, right: 16 }}>
                <CartesianGrid stroke="#1C2030" strokeDasharray="3 6" vertical={false} />
                <XAxis dataKey="t" stroke="#4B5268" fontSize={11} tickLine={false} axisLine={false} minTickGap={50} />
                <YAxis stroke="#4B5268" fontSize={11} tickLine={false} axisLine={false} width={72} domain={["auto", "auto"]}
                  tickFormatter={(v) => price(v)} />
                <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [price(v), n === "close" ? "Close" : "EMA 50"]} />
                <Line type="monotone" dataKey="close" stroke="#9A84FF" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="ema50" stroke="#F5A524" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
                {s?.stop_price && <ReferenceLine y={s.stop_price} stroke="#F43F5E" strokeDasharray="3 4"
                  label={{ value: "stop", fill: "#F43F5E", fontSize: 11, position: "insideBottomRight" }} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Risk plan" subtitle="Shown with every signal">
          <div className="space-y-4 p-5">
            <div className="flex gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-down" />
              <div>
                <div className="text-sm font-semibold text-white">Stop: {price(s?.stop_price)}</div>
                <div className="text-xs text-mute">2 × the average hourly range (ATR 14) below the last close.</div>
              </div>
            </div>
            <div className="flex gap-3">
              <Target className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div>
                <div className="text-sm font-semibold text-white">Trend exit: close below {price(s?.exit_level)}</div>
                <div className="text-xs text-mute">The 50-hour EMA. Losing it means the trend has cooled.</div>
              </div>
            </div>
            <p className="rounded-xl border border-line bg-ink-850 p-3 text-xs leading-relaxed text-mute">
              Scores rank setups by rules; they don't predict prices. Always size positions so a stop-out is affordable.
            </p>
          </div>
        </Panel>
      </div>

      {s && (
        <Panel title="Why it scores what it scores" subtitle="Factor breakdown">
          <div className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-3">
            {FACTORS.map((f) => {
              const c = s.components[f.key];
              const pctVal = Math.round((c?.score ?? 0) * 100);
              return (
                <div key={f.key} className="bg-ink-900 p-5">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">{f.label}</div>
                    <div className="num text-xs text-mute">weight {c?.weight ?? 0}% · <span className="font-semibold text-white">{pctVal}%</span></div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-700">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-violet-600" style={{ width: `${Math.max(2, pctVal)}%` }} />
                  </div>
                  <div className="mt-3 text-xs leading-relaxed text-mute">{f.explain}</div>
                  <div className="num mt-2 text-xs text-soft">{rawLine(f.key, c?.raw)}</div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}
