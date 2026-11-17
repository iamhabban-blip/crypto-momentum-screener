import clsx from "clsx";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import type { FactorDetail } from "../lib/api";
import { FACTORS, base, scoreTone } from "../lib/format";

export function CoinAvatar({ symbol, size = 32 }: { symbol: string; size?: number }) {
  const b = base(symbol);
  const hue = [...b].reduce((a, c) => a + c.charCodeAt(0) * 37, 0) % 360;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ring-1 ring-white/10"
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 65% 38%))` }}
      aria-hidden
    >
      {b.slice(0, 2)}
    </span>
  );
}

export function ScoreBar({ score, wide = false }: { score: number; wide?: boolean }) {
  const t = scoreTone(score);
  return (
    <div className="flex items-center gap-3">
      <span className={clsx("num w-9 text-right text-sm font-bold", t.text)}>{score.toFixed(0)}</span>
      <div className={clsx("h-1.5 overflow-hidden rounded-full bg-ink-700", wide ? "w-40" : "w-24")}>
        <div className={clsx("h-full rounded-full bg-gradient-to-r", t.bar)} style={{ width: `${Math.max(3, score)}%` }} />
      </div>
    </div>
  );
}

export function ScoreRing({ score, size = 96 }: { score: number; size?: number }) {
  const r = 42, c = 2 * Math.PI * r;
  const t = scoreTone(score);
  const color = score >= 75 ? "#22C55E" : score >= 60 ? "#F5A524" : score >= 40 ? "#9A84FF" : "#4B5268";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="-rotate-90">
        <circle cx="50" cy="50" r={r} stroke="#1B1F2E" strokeWidth="9" fill="none" />
        <circle cx="50" cy="50" r={r} stroke={color} strokeWidth="9" fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-2xl font-bold text-white">{score.toFixed(0)}</span>
        <span className={clsx("text-[10px] font-semibold uppercase tracking-wider", t.text)}>{t.label}</span>
      </div>
    </div>
  );
}

/** Six small squares, one per factor; brighter = stronger. Hover shows the factor name. */
export function FactorChips({ components }: { components: Record<string, FactorDetail> }) {
  return (
    <div className="flex gap-1">
      {FACTORS.map((f) => {
        const s = components[f.key]?.score ?? 0;
        return (
          <span key={f.key} title={`${f.label}: ${Math.round(s * 100)}%`}
            className={clsx("flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold",
              s >= 0.75 ? "bg-violet-500 text-white" : s >= 0.4 ? "bg-violet-500/35 text-violet-200"
                : s > 0 ? "bg-violet-500/15 text-violet-300/80" : "bg-ink-700 text-mute/60")}>
            {f.short}
          </span>
        );
      })}
    </div>
  );
}

export function Change({ v, className }: { v: number | null | undefined; className?: string }) {
  if (v == null) return <span className="text-mute">—</span>;
  return (
    <span className={clsx("num font-semibold", v >= 0 ? "text-up" : "text-down", className)}>
      {v >= 0 ? "+" : ""}{(v * 100).toFixed(2)}%
    </span>
  );
}

export function RegimePill({ regime }: { regime: "risk_on" | "risk_off" | null | undefined }) {
  if (!regime) return null;
  const on = regime === "risk_on";
  return (
    <span className={clsx("chip", on ? "border-up/30 bg-up/10 text-up" : "border-down/30 bg-down/10 text-down")}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", on ? "bg-up" : "bg-down")} />
      {on ? "Risk-on market" : "Risk-off market"}
    </span>
  );
}

export function Kpi({ label, value, sub, icon, tone = "violet" }:
  { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; tone?: "violet" | "amber" }) {
  return (
    <div className={clsx("card p-5", tone === "amber" ? "card-glow-amber" : "card-glow")}>
      <div className={clsx("mb-4 inline-flex h-9 w-9 items-center justify-center rounded-xl",
        tone === "amber" ? "bg-amber-500/15 text-amber-400" : "bg-violet-500/20 text-violet-300")}>{icon}</div>
      <div className="num text-[26px] font-bold leading-none tracking-tight text-white">{value}</div>
      <div className="mt-2 text-xs text-mute">{label}</div>
      {sub && <div className="mt-3 text-xs">{sub}</div>}
    </div>
  );
}

export function Panel({ title, subtitle, action, children, className }:
  { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("card", className)}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          {subtitle && <div className="label mb-1">{subtitle}</div>}
          <h2 className="text-[15px] font-semibold text-white">{title}</h2>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 p-10 text-sm text-mute"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
      <div className="text-sm font-semibold text-white">{title}</div>
      {children && <div className="max-w-md text-sm text-mute">{children}</div>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-down/30 bg-down/10 px-4 py-3 text-sm text-down">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{message}
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange }:
  { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-ink-850 p-1">
      {options.map((o) => (
        <button key={String(o.value)} onClick={() => onChange(o.value)}
          className={clsx("rounded-lg px-3 py-1.5 text-xs font-semibold transition",
            value === o.value ? "bg-violet-500/20 text-violet-200" : "text-mute hover:text-soft")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const tooltipStyle = {
  contentStyle: { background: "#0F1119", border: "1px solid #262B3D", borderRadius: 12, fontSize: 12, color: "#C9CEDB" },
  labelStyle: { color: "#8B93A7", marginBottom: 4 },
  itemStyle: { padding: 0 },
};
