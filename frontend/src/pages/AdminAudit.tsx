import clsx from "clsx";
import { useState } from "react";
import { ErrorNote, Loading, Panel } from "../components/ui";
import { useApi } from "../lib/useApi";

interface Entry { id: number; actor_email: string | null; action: string; target: string | null; ip: string | null; meta: Record<string, any>; created_at: string }
const ACTIONS = ["", "login_success", "login_failed", "account_locked", "refresh_token_reuse_detected", "password_changed",
  "user_created", "user_updated", "settings_changed", "backtest_queued", "watchlist_add"];
const danger = new Set(["login_failed", "account_locked", "refresh_token_reuse_detected", "login_blocked_locked"]);
const PAGE = 25;

export default function AdminAudit() {
  const [action, setAction] = useState("");
  const [email, setEmail] = useState("");
  const [page, setPage] = useState(0);
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
  if (action) params.set("action", action);
  if (email) params.set("email", email);
  const { data, error, loading } = useApi<{ total: number; items: Entry[] }>(`/api/admin/audit?${params}`, 15_000);

  return (
    <Panel title="Audit log" subtitle="Append-only · enforced by the database">
      <div className="flex flex-wrap gap-3 border-b border-line px-5 py-4">
        <select className="input max-w-[260px]" value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }}>
          {ACTIONS.map((a) => <option key={a} value={a}>{a || "All actions"}</option>)}
        </select>
        <input className="input max-w-[240px]" placeholder="Filter by email" value={email} onChange={(e) => { setEmail(e.target.value); setPage(0); }} />
        <span className="ml-auto self-center text-xs text-mute">{data?.total ?? 0} entries</span>
      </div>
      {error ? <div className="p-5"><ErrorNote message={error} /></div> : loading && !data ? <Loading /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="border-b border-line"><tr>
              <th className="th">When</th><th className="th">Who</th><th className="th">Action</th><th className="th">Target</th><th className="th">IP</th><th className="th">Details</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {data!.items.map((e) => (
                <tr key={e.id}>
                  <td className="td num whitespace-nowrap text-xs text-mute">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="td text-white">{e.actor_email ?? "—"}</td>
                  <td className="td"><span className={clsx("chip", danger.has(e.action) ? "border-down/30 bg-down/10 text-down" : "border-line bg-ink-800 text-soft")}>{e.action}</span></td>
                  <td className="td text-soft">{e.target ?? "—"}</td>
                  <td className="td num text-xs text-mute">{e.ip ?? "—"}</td>
                  <td className="td max-w-[280px] truncate text-xs text-mute" title={JSON.stringify(e.meta)}>
                    {Object.keys(e.meta).length ? JSON.stringify(e.meta) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button className="btn-ghost px-3 py-1.5 text-xs" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
        <button className="btn-ghost px-3 py-1.5 text-xs" disabled={!data || (page + 1) * PAGE >= data.total} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </Panel>
  );
}
