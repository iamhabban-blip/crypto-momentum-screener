import { BarChart3, Eye, EyeOff, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorNote } from "../components/ui";
import { useAuth } from "../lib/auth";
import { DEMO } from "../lib/api";
import { DEMO_EMAIL, DEMO_PASSWORD } from "../demo/mock";
import { REPO_URL } from "../demo/DemoBits";

const points = [
  { icon: <Sparkles className="h-4 w-4" />, title: "Rules you can read",
    text: "Six research-backed factors, each explained in plain English on every coin." },
  { icon: <BarChart3 className="h-4 w-4" />, title: "Backtested honestly",
    text: "Walk-forward tested with fees, against random picks and simply holding BTC." },
  { icon: <ShieldCheck className="h-4 w-4" />, title: "Secure by design",
    text: "Argon2 passwords, rotating sessions, role-based access and an append-only audit log." },
];

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(DEMO ? DEMO_EMAIL : "");
  const [password, setPassword] = useState(DEMO ? DEMO_PASSWORD : "");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden border-r border-line lg:block"
        style={{ background: "radial-gradient(80% 60% at 20% 10%, rgba(124,92,255,0.35), transparent 60%), radial-gradient(60% 50% at 90% 90%, rgba(245,165,36,0.14), transparent 60%), #08090D" }}>
        <svg className="absolute inset-x-0 bottom-0 h-72 w-full opacity-40" viewBox="0 0 600 200" preserveAspectRatio="none" aria-hidden>
          <path d="M0 170 C80 160 110 120 170 130 S260 90 320 100 400 40 470 55 560 20 600 10" fill="none" stroke="#9A84FF" strokeWidth="2" />
          <path d="M0 185 C90 180 130 160 190 165 S290 140 350 145 430 120 500 118 570 100 600 95" fill="none" stroke="#F5A524" strokeWidth="1.5" strokeDasharray="4 6" />
        </svg>
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-10 w-10" />
            <span className="text-lg font-bold text-white">Trendscope</span>
          </div>
          <div className="max-w-md">
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-white">
              Find the coins that are <span className="bg-gradient-to-r from-violet-300 to-amber-400 bg-clip-text text-transparent">actually trending</span>.
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-soft/80">
              Every hour Trendscope scores the Binance Spot market on momentum, volume and strength, then shows you exactly why each coin ranks where it does.
            </p>
            <div className="mt-10 space-y-5">
              {points.map((p) => (
                <div key={p.title} className="flex gap-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/15 text-violet-300">{p.icon}</div>
                  <div>
                    <div className="text-sm font-semibold text-white">{p.title}</div>
                    <div className="text-sm text-mute">{p.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="text-xs text-mute">A screener, not financial advice. Built by Habban.</div>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-10 w-10" /></div>
          <h2 className="text-2xl font-semibold tracking-tight text-white">Sign in</h2>
          <p className="mt-1.5 text-sm text-mute">Accounts are created by an administrator.</p>
          {DEMO && (
            <div className="mt-6 rounded-xl border border-violet-500/30 bg-violet-500/10 p-4 text-sm">
              <div className="font-semibold text-white">Live demo</div>
              <div className="mt-1 text-xs leading-relaxed text-soft">
                The demo login is filled in for you: <span className="font-mono text-violet-200">{DEMO_EMAIL}</span> / <span className="font-mono text-violet-200">{DEMO_PASSWORD}</span>.
                Market data is live from Binance; accounts and settings are sample data in your browser.{" "}
                <a href={REPO_URL} className="font-semibold text-violet-200 underline-offset-2 hover:underline" target="_blank" rel="noreferrer">See the source</a>.
              </div>
            </div>
          )}
          <div className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-soft">Email</span>
              <input className="input" type="email" autoComplete="username" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-soft">Password</span>
              <div className="relative">
                <input className="input pr-10" type={show ? "text" : "password"} autoComplete="current-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-mute hover:text-soft">
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            {error && <ErrorNote message={error} />}
            <button className="btn-primary w-full" disabled={busy}>
              <Lock className="h-4 w-4" />{busy ? "Signing in…" : "Sign in securely"}
            </button>
          </div>
          <p className="mt-6 text-center text-xs text-mute">
            After 5 wrong attempts an account is locked for 15 minutes.
          </p>
        </form>
      </div>
    </div>
  );
}
