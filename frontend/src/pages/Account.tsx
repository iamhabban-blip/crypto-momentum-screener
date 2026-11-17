import { KeyRound, LogOut } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ErrorNote, Panel } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Account() {
  const { user, signOut } = useAuth();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const change = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/auth/change-password", { method: "POST", json: { current_password: cur, new_password: next } });
      setMsg({ ok: true, text: "Password changed. Every session has been signed out; please sign in again." });
      setTimeout(signOut, 2500);
    } catch (err: any) { setMsg({ ok: false, text: err.message }); }
  };

  const everywhere = async () => {
    await api("/api/auth/logout-all", { method: "POST" });
    await signOut();
  };

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Panel title="Your account" subtitle="Profile">
        <dl className="divide-y divide-line text-sm">
          {[["Name", user?.full_name], ["Email", user?.email], ["Role", user?.role],
            ["Last sign-in", user?.last_login_at ? new Date(user.last_login_at).toLocaleString() : "—"]].map(([k, v]) => (
            <div key={k} className="flex justify-between px-5 py-3.5"><dt className="text-mute">{k}</dt><dd className="capitalize text-white">{v}</dd></div>
          ))}
        </dl>
        <div className="p-5">
          <button onClick={everywhere} className="btn-ghost"><LogOut className="h-4 w-4" />Sign out on all devices</button>
        </div>
      </Panel>
      <Panel title="Change password" subtitle="Security">
        <form onSubmit={change} className="space-y-4 p-5">
          <input className="input" type="password" placeholder="Current password" autoComplete="current-password"
            value={cur} onChange={(e) => setCur(e.target.value)} required />
          <input className="input" type="password" placeholder="New password (12+ characters)" autoComplete="new-password"
            value={next} onChange={(e) => setNext(e.target.value)} required />
          <p className="text-xs text-mute">A long passphrase beats a short complex one. Common passwords are rejected.</p>
          {msg && (msg.ok ? <div className="rounded-xl border border-up/30 bg-up/10 px-4 py-3 text-sm text-up">{msg.text}</div>
            : <ErrorNote message={msg.text} />)}
          <button className="btn-primary"><KeyRound className="h-4 w-4" />Update password</button>
        </form>
      </Panel>
    </div>
  );
}
