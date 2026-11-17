import clsx from "clsx";
import { RotateCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { ErrorNote, Loading, Panel } from "../components/ui";
import { api } from "../lib/api";
import { FACTORS } from "../lib/format";
import { useApi } from "../lib/useApi";

interface Settings { min_quote_volume_24h: number; min_history_days: number; regime_mode: "flag" | "suppress"; weights: Record<string, number> }
const DEFAULT_WEIGHTS = { trend: 30, volume: 20, relative_strength: 15, breakout: 15, rsi: 10, no_chase: 10 };

export default function AdminSettings() {
  const { data, error, loading } = useApi<Settings>("/api/admin/settings");
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (data) setS(data); }, [data]);

  if (loading || !s) return error ? <ErrorNote message={error} /> : <Loading />;
  const total = Object.values(s.weights).reduce((a, b) => a + b, 0);

  const save = async () => {
    setMsg(null);
    try {
      await api("/api/admin/settings", { method: "PUT", json: s });
      setMsg({ ok: true, text: "Saved. The next hourly scan uses these settings. The change is in the audit log." });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
  };

  return (
    <div className="grid max-w-6xl gap-6 xl:grid-cols-[1fr_380px]">
      <Panel title="Factor weights" subtitle="Must add up to 100"
        action={<span className={clsx("chip num", total === 100 ? "border-up/30 bg-up/10 text-up" : "border-down/30 bg-down/10 text-down")}>Total {total}</span>}>
        <div className="space-y-5 p-5">
          {FACTORS.map((f) => (
            <div key={f.key}>
              <div className="mb-2 flex justify-between text-sm"><span className="font-semibold text-white">{f.label}</span>
                <span className="num text-mute">{s.weights[f.key]}%</span></div>
              <input type="range" min={0} max={60} step={5} value={s.weights[f.key]} className="w-full accent-violet-500"
                onChange={(e) => setS({ ...s, weights: { ...s.weights, [f.key]: +e.target.value } })} />
              <div className="mt-1 text-xs text-mute">{f.explain}</div>
            </div>
          ))}
          <button className="btn-ghost" onClick={() => setS({ ...s, weights: { ...DEFAULT_WEIGHTS } })}><RotateCcw className="h-4 w-4" />Research defaults</button>
        </div>
      </Panel>
      <div className="space-y-6">
        <Panel title="Gates" subtitle="Who gets ranked">
          <div className="space-y-4 p-5">
            <label className="block"><span className="mb-1.5 block text-xs text-mute">Minimum 24h volume (USDT)</span>
              <input className="input num" type="number" min={0} step={100000} value={s.min_quote_volume_24h}
                onChange={(e) => setS({ ...s, min_quote_volume_24h: +e.target.value })} /></label>
            <label className="block"><span className="mb-1.5 block text-xs text-mute">Minimum days since listing</span>
              <input className="input num" type="number" min={1} max={365} value={s.min_history_days}
                onChange={(e) => setS({ ...s, min_history_days: +e.target.value })} /></label>
            <label className="block"><span className="mb-1.5 block text-xs text-mute">When BTC is below its 200-day average</span>
              <select className="input" value={s.regime_mode} onChange={(e) => setS({ ...s, regime_mode: e.target.value as Settings["regime_mode"] })}>
                <option value="flag">Keep ranking, show a risk-off warning</option>
                <option value="suppress">Don't rank any coins</option>
              </select></label>
          </div>
        </Panel>
        {msg && (msg.ok ? <div className="rounded-xl border border-up/30 bg-up/10 px-4 py-3 text-sm text-up">{msg.text}</div> : <ErrorNote message={msg.text} />)}
        <button className="btn-primary w-full" disabled={total !== 100} onClick={save}><Save className="h-4 w-4" />Save settings</button>
      </div>
    </div>
  );
}
