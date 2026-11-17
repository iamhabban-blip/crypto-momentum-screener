import { BookOpen, Filter, Scale, ShieldCheck } from "lucide-react";
import { Panel } from "../components/ui";
import { FACTORS } from "../lib/format";

const sources = [
  ["Liu, Tsyvinski & Wu (2022), Common Risk Factors in Cryptocurrency, Journal of Finance",
    "Market, size and momentum factors explain most of the cross-section of crypto returns."],
  ["Han, Kang & Ryu, Time-Series and Cross-Sectional Momentum in the Cryptocurrency Market",
    "Under realistic assumptions, time-series momentum is strong while cross-sectional momentum is weak."],
  ["Bianchi & Dickerson, Trading Volume in Cryptocurrency Markets",
    "Abnormal volume combined with past returns predicts future returns."],
];

export default function Method() {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="1. Gates: who gets ranked" subtitle="Must pass all">
        <ul className="space-y-4 p-5 text-sm">
          <li className="flex gap-3"><Filter className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" /><div><b className="text-white">Liquidity.</b> <span className="text-mute">24-hour trading volume above the admin-set minimum (2M USDT by default). Thin coins are easy to push around.</span></div></li>
          <li className="flex gap-3"><Filter className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" /><div><b className="text-white">History.</b> <span className="text-mute">Listed for at least 30 days with complete hourly candles. New listings behave erratically.</span></div></li>
          <li className="flex gap-3"><Filter className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" /><div><b className="text-white">Market regime.</b> <span className="text-mute">When Bitcoin is below its 200-day average the market is risk-off. Signals are flagged, or hidden if the admin chooses.</span></div></li>
        </ul>
      </Panel>
      <Panel title="2. Score: six factors, 0 to 100" subtitle="Weighted sum">
        <ul className="space-y-3 p-5 text-sm">
          {FACTORS.map((f) => (
            <li key={f.key} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-violet-500 text-[10px] font-bold text-white">{f.short}</span>
              <div><b className="text-white">{f.label}.</b> <span className="text-mute">{f.explain}</span></div>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="3. Risk: every signal comes with an exit" subtitle="Before you enter">
        <div className="space-y-3 p-5 text-sm text-mute">
          <p className="flex gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-down" />Stop 2 × ATR(14) below the close: wide enough to survive normal noise.</p>
          <p className="flex gap-3"><Scale className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />Trend exit when price closes below the 50-hour EMA.</p>
          <p>Momentum works on average and fails hard in crashes. Trendscope ranks setups; it never tells you to buy.</p>
        </div>
      </Panel>
      <Panel title="4. Evidence behind the rules" subtitle="Research">
        <ul className="space-y-4 p-5 text-sm">
          {sources.map(([t, d]) => (
            <li key={t} className="flex gap-3"><BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
              <div><div className="text-white">{t}</div><div className="text-mute">{d}</div></div></li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
