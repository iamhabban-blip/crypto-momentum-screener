import { Code2, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import { Loading } from "../components/ui";
import { DEMO } from "../lib/api";
import { progress } from "./mock";

export const REPO_URL = "https://github.com/iamhabban-blip/crypto-momentum-screener";

export function DemoBanner() {
  if (!DEMO) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-violet-500/30 bg-gradient-to-r from-violet-600/25 via-violet-500/15 to-amber-500/15 px-4 py-2 text-center text-xs text-soft">
      <span className="inline-flex items-center gap-1.5 font-semibold text-white"><Radio className="h-3.5 w-3.5 animate-pulse text-up" />Live demo</span>
      <span>Real Binance market data, scored in your browser with the same rules as the backend. Users, settings and audit log are sample data and stay in this browser.</span>
      <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-violet-200 hover:text-white">
        <Code2 className="h-3.5 w-3.5" />Source code</a>
    </div>
  );
}

/** Loading state that shows live download progress in the demo. */
export function LiveLoading() {
  const [, force] = useState(0);
  useEffect(() => {
    if (!DEMO) return;
    const f = () => force((x) => x + 1);
    progress.listeners.add(f);
    return () => { progress.listeners.delete(f); };
  }, []);
  if (!DEMO) return <Loading />;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="card mx-auto mt-10 max-w-md p-8 text-center">
      <div className="text-sm font-semibold text-white">Loading live market data from Binance…</div>
      <div className="mt-1 text-xs text-mute">{progress.total ? `${progress.done} of ${progress.total} coins (last 1,000 hourly candles each)` : "Finding every USDT pair above the volume filter"}</div>
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-ink-700">
        <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-amber-400 transition-all" style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      <div className="mt-3 text-[11px] text-mute">Usually 5-15 seconds. Then every score is computed right here in your browser.</div>
    </div>
  );
}
