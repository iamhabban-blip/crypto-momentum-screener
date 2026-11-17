import clsx from "clsx";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Signal } from "../lib/api";
import { base, price } from "../lib/format";
import { Change, CoinAvatar, FactorChips, ScoreBar } from "./ui";

type Key = "rank" | "score" | "ret_1d" | "ret_7d" | "rsi" | "rvol";

export default function SignalsTable({ signals, compact = false }: { signals: Signal[]; compact?: boolean }) {
  const navigate = useNavigate();
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "rank", dir: 1 });

  const rows = useMemo(() => {
    const v = (s: Signal) => (sort.key === "rank" ? s.rank ?? 1e9 : (s[sort.key] as number | null) ?? -1e9);
    return [...signals].sort((a, b) => (v(a) - v(b)) * sort.dir);
  }, [signals, sort]);

  const Th = ({ k, children, right }: { k?: Key; children: React.ReactNode; right?: boolean }) => (
    <th className={clsx("th", right && "text-right")}>
      {k ? (
        <button className="inline-flex items-center gap-1 uppercase tracking-[0.08em] hover:text-soft"
          onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (-s.dir as 1 | -1) : k === "rank" ? 1 : -1 }))}>
          {children}
          {sort.key === k && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
        </button>
      ) : children}
    </th>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px]">
        <thead className="border-b border-line">
          <tr>
            <Th k="rank">#</Th>
            <Th>Coin</Th>
            <Th k="score">Score</Th>
            <Th>Factors</Th>
            <Th right>Price</Th>
            <Th k="ret_1d" right>24h</Th>
            {!compact && <Th k="ret_7d" right>7d</Th>}
            <Th k="rsi" right>RSI</Th>
            <Th k="rvol" right>RVOL</Th>
            {!compact && <Th right>Stop (2×ATR)</Th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((s) => (
            <tr key={s.symbol} onClick={() => navigate(`/coin/${s.symbol}`)}
              className="cursor-pointer transition hover:bg-violet-500/[0.04]">
              <td className="td">
                <span className={clsx("num inline-flex h-7 min-w-7 items-center justify-center rounded-lg px-1.5 text-xs font-bold",
                  s.rank && s.rank <= 3 ? "bg-amber-500/15 text-amber-400" : "bg-ink-800 text-mute")}>{s.rank ?? "–"}</span>
              </td>
              <td className="td">
                <div className="flex items-center gap-3">
                  <CoinAvatar symbol={s.symbol} />
                  <div>
                    <div className="font-semibold text-white">{base(s.symbol)}<span className="ml-1 text-xs font-normal text-mute">/USDT</span></div>
                    {s.gate_reason && <div className="text-xs text-mute">{s.gate_reason}</div>}
                  </div>
                </div>
              </td>
              <td className="td"><ScoreBar score={s.score} /></td>
              <td className="td"><FactorChips components={s.components} /></td>
              <td className="td num text-right text-white">{price(s.close)}</td>
              <td className="td text-right"><Change v={s.ret_1d} /></td>
              {!compact && <td className="td text-right"><Change v={s.ret_7d} /></td>}
              <td className={clsx("td num text-right", (s.rsi ?? 0) >= 80 ? "text-down" : (s.rsi ?? 0) >= 50 ? "text-white" : "text-mute")}>
                {s.rsi?.toFixed(1) ?? "—"}
              </td>
              <td className={clsx("td num text-right", (s.rvol ?? 0) >= 2 ? "font-semibold text-amber-400" : "text-soft")}>
                {s.rvol?.toFixed(2) ?? "—"}
              </td>
              {!compact && <td className="td num text-right text-mute">{price(s.stop_price)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
