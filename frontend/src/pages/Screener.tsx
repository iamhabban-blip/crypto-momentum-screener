import { useMemo, useState } from "react";
import SignalsTable from "../components/SignalsTable";
import { Empty, ErrorNote, Panel, RegimePill } from "../components/ui";
import type { ScanRun, Signal } from "../lib/api";
import { FACTORS, hourLabel } from "../lib/format";
import { useApi } from "../lib/useApi";
import { LiveLoading } from "../demo/DemoBits";

export default function Screener() {
  const [showFiltered, setShowFiltered] = useState(false);
  const { data, error, loading } = useApi<{ run: ScanRun | null; signals: Signal[] }>(
    `/api/signals/latest?include_filtered=${showFiltered}`, 60_000);
  const [q, setQ] = useState("");
  const [minScore, setMinScore] = useState(0);

  const rows = useMemo(() => (data?.signals ?? []).filter((s) =>
    s.symbol.includes(q.toUpperCase()) && s.score >= minScore), [data, q, minScore]);

  if (loading && !data) return <LiveLoading />;
  if (error) return <ErrorNote message={error} />;
  const run = data?.run;

  return (
    <div className="space-y-6">
      <Panel title="Screener" subtitle={run ? `Candle closed ${hourLabel(run.candle_time)}` : "Waiting for first scan"}
        action={<RegimePill regime={run?.regime} />}>
        <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4">
          <input className="input max-w-[220px]" placeholder="Filter coins…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="flex items-center gap-3 text-sm text-mute">
            Min score
            <input type="range" min={0} max={90} step={5} value={minScore} onChange={(e) => setMinScore(+e.target.value)}
              className="accent-violet-500" />
            <span className="num w-6 font-semibold text-white">{minScore}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-mute">
            <input type="checkbox" checked={showFiltered} onChange={(e) => setShowFiltered(e.target.checked)} className="accent-violet-500" />
            Show coins that failed the gates
          </label>
          <span className="ml-auto text-xs text-mute">{rows.length} coins</span>
        </div>
        {rows.length ? <SignalsTable signals={rows} /> : <Empty title="No coins match these filters" />}
      </Panel>

      <div className="card grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
        {FACTORS.map((f) => (
          <div key={f.key} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-500 text-xs font-bold text-white">{f.short}</span>
            <div>
              <div className="text-sm font-semibold text-white">{f.label} <span className="font-normal text-mute">· weight {run?.weights?.[f.key] ?? "—"}%</span></div>
              <div className="text-xs leading-relaxed text-mute">{f.explain}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
