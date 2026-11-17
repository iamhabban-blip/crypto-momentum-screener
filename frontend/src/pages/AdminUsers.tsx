import clsx from "clsx";
import { KeyRound, LockOpen, LogOut, Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ErrorNote, Loading, Panel } from "../components/ui";
import { api, type Role, type User } from "../lib/api";
import { useAuth } from "../lib/auth";
import { timeAgo } from "../lib/format";
import { useApi } from "../lib/useApi";

const roleStyle: Record<Role, string> = {
  admin: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  analyst: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  viewer: "border-line bg-ink-800 text-mute",
};

function CreateUser({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ email: "", full_name: "", role: "viewer" as Role, password: "" });
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await api("/api/admin/users", { method: "POST", json: f }); onDone(); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <form onSubmit={submit} className="grid gap-3 border-b border-line p-5 md:grid-cols-5">
      <input className="input" placeholder="Full name" required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
      <input className="input" type="email" placeholder="Email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
        <option value="viewer">Viewer</option><option value="analyst">Analyst</option><option value="admin">Admin</option>
      </select>
      <input className="input" type="password" placeholder="Temporary password (12+)" required autoComplete="new-password"
        value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      <button className="btn-primary"><Plus className="h-4 w-4" />Create user</button>
      {err && <div className="md:col-span-5"><ErrorNote message={err} /></div>}
    </form>
  );
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const { data, error, loading, reload } = useApi<User[]>("/api/admin/users");
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setNote(null);
    try { await fn(); setNote(ok); reload(); } catch (e: any) { setNote(e.message); }
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;

  return (
    <Panel title="Users" subtitle="Access control"
      action={<button className="btn-ghost" onClick={() => setCreating(!creating)}>
        {creating ? <><X className="h-4 w-4" />Cancel</> : <><Plus className="h-4 w-4" />New user</>}</button>}>
      {creating && <CreateUser onDone={() => { setCreating(false); reload(); }} />}
      {note && <div className="border-b border-line px-5 py-3 text-sm text-soft">{note}</div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-line"><tr>
            <th className="th">User</th><th className="th">Role</th><th className="th">Status</th><th className="th">Last sign-in</th><th className="th text-right">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-line">
            {data!.map((u) => {
              const locked = u.locked_until && new Date(u.locked_until) > new Date();
              const self = u.id === me?.id;
              return (
                <tr key={u.id}>
                  <td className="td"><div className="font-semibold text-white">{u.full_name}{self && <span className="ml-2 text-xs text-mute">(you)</span>}</div>
                    <div className="text-xs text-mute">{u.email}</div></td>
                  <td className="td">
                    <select disabled={self} value={u.role} className={clsx("chip cursor-pointer bg-transparent", roleStyle[u.role])}
                      onChange={(e) => act(() => api(`/api/admin/users/${u.id}`, { method: "PATCH", json: { role: e.target.value } }), `Role updated for ${u.email}.`)}>
                      <option value="viewer">viewer</option><option value="analyst">analyst</option><option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="td">
                    {!u.is_active ? <span className="chip border-down/30 bg-down/10 text-down">Deactivated</span>
                      : locked ? <span className="chip border-amber-500/30 bg-amber-500/10 text-amber-400">Locked</span>
                        : <span className="chip border-up/30 bg-up/10 text-up">Active</span>}
                  </td>
                  <td className="td text-xs text-mute">{timeAgo(u.last_login_at)}</td>
                  <td className="td">
                    <div className="flex justify-end gap-1.5">
                      {locked && <button className="btn-ghost px-2.5 py-1.5 text-xs" title="Unlock"
                        onClick={() => act(() => api(`/api/admin/users/${u.id}/unlock`, { method: "POST" }), `${u.email} unlocked.`)}><LockOpen className="h-3.5 w-3.5" />Unlock</button>}
                      <button className="btn-ghost px-2.5 py-1.5 text-xs" title="Reset password"
                        onClick={() => {
                          const p = prompt(`New temporary password for ${u.email} (12+ characters):`);
                          if (p) act(() => api(`/api/admin/users/${u.id}/reset-password`, { method: "POST", json: { new_password: p } }), `Password reset for ${u.email}. Their sessions were ended.`);
                        }}><KeyRound className="h-3.5 w-3.5" />Reset</button>
                      <button className="btn-ghost px-2.5 py-1.5 text-xs" title="End all sessions"
                        onClick={() => act(() => api(`/api/admin/users/${u.id}/revoke-sessions`, { method: "POST" }), `All sessions ended for ${u.email}.`)}><LogOut className="h-3.5 w-3.5" />Sessions</button>
                      {!self && <button className={u.is_active ? "btn-danger px-2.5 py-1.5 text-xs" : "btn-ghost px-2.5 py-1.5 text-xs"}
                        onClick={() => act(() => api(`/api/admin/users/${u.id}`, { method: "PATCH", json: { is_active: !u.is_active } }),
                          `${u.email} ${u.is_active ? "deactivated" : "reactivated"}.`)}>{u.is_active ? "Deactivate" : "Reactivate"}</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
