import { Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Change, CoinAvatar, Empty, ErrorNote, Loading, Panel, ScoreBar } from "../components/ui";
import { api } from "../lib/api";
import { base, price, timeAgo } from "../lib/format";
import { useApi } from "../lib/useApi";

interface Item { symbol: string; note: string | null; created_at: string; score: number | null; close: number | null; ret_1d: number | null }

export default function Watchlist() {
  const { data, error, loading, reload } = useApi<Item[]>("/api/watchlist", 60_000);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;

  const remove = async (symbol: string) => { await api(`/api/watchlist/${symbol}`, { method: "DELETE" }); reload(); };

  return (
    <Panel title="Watchlist" subtitle={`${data?.length ?? 0} of 50 coins`}>
      {data?.length ? (
        <table className="w-full">
          <thead className="border-b border-line"><tr>
            <th className="th">Coin</th><th className="th">Score now</th><th className="th text-right">Price</th>
            <th className="th text-right">24h</th><th className="th text-right">Added</th><th className="th" />
          </tr></thead>
          <tbody className="divide-y divide-line">
            {data.map((w) => (
              <tr key={w.symbol} className="hover:bg-ink-850">
                <td className="td"><Link to={`/coin/${w.symbol}`} className="flex items-center gap-3 font-semibold text-white">
                  <CoinAvatar symbol={w.symbol} />{base(w.symbol)}</Link></td>
                <td className="td">{w.score != null ? <ScoreBar score={w.score} /> : <span className="text-xs text-mute">Not scored (filtered out)</span>}</td>
                <td className="td num text-right text-white">{price(w.close)}</td>
                <td className="td text-right"><Change v={w.ret_1d} /></td>
                <td className="td text-right text-xs text-mute">{timeAgo(w.created_at)}</td>
                <td className="td text-right">
                  <button onClick={() => remove(w.symbol)} className="rounded-lg p-2 text-mute hover:bg-down/10 hover:text-down" aria-label={`Remove ${w.symbol}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty title="Your watchlist is empty">Open any coin from the screener and add it to follow its score here.</Empty>}
    </Panel>
  );
}
