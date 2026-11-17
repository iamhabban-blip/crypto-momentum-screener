import clsx from "clsx";
import {
  Activity, ClipboardList, FlaskConical, LayoutDashboard, LogOut, Radar, Search, Settings2, Shield, Star, UserCog, Users,
} from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { DemoBanner } from "../demo/DemoBits";
import { useAuth } from "../lib/auth";

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-8 w-8" />
      <div>
        <div className="text-[15px] font-bold tracking-tight text-white">Trendscope</div>
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-mute">Momentum screener</div>
      </div>
    </div>
  );
}

function Item({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <NavLink to={to} end={to === "/"}
      className={({ isActive }) => clsx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
        isActive ? "border border-violet-500/30 bg-violet-500/10 text-white shadow-[inset_0_0_20px_rgba(124,92,255,0.08)]"
          : "border border-transparent text-mute hover:bg-ink-850 hover:text-soft")}>
      <span className="[&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span>{children}
    </NavLink>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, signOut, can } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const search = (e: FormEvent) => {
    e.preventDefault();
    const s = q.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (s) navigate(`/coin/${s.endsWith("USDT") ? s : s + "USDT"}`);
    setQ("");
  };

  return (
    <div className="flex min-h-screen">
      <div className="hidden w-[248px] shrink-0 border-r border-line bg-ink-900/60 lg:block">
      <aside className="sticky top-0 flex h-screen flex-col px-4 py-6">
        <Logo />
        <nav className="mt-8 flex flex-col gap-1">
          <Item to="/" icon={<LayoutDashboard />}>Dashboard</Item>
          <Item to="/screener" icon={<Radar />}>Screener</Item>
          <Item to="/watchlist" icon={<Star />}>Watchlist</Item>
          <Item to="/backtests" icon={<FlaskConical />}>Backtests</Item>
          <Item to="/method" icon={<ClipboardList />}>How it works</Item>
        </nav>
        {can("admin") && (
          <>
            <div className="label mb-2 mt-8 px-3">Admin</div>
            <nav className="flex flex-col gap-1">
              <Item to="/admin/users" icon={<Users />}>Users</Item>
              <Item to="/admin/settings" icon={<Settings2 />}>Screener settings</Item>
              <Item to="/admin/audit" icon={<Shield />}>Audit log</Item>
            </nav>
          </>
        )}
        <div className="mt-auto">
          <NavLink to="/account" className="flex items-center gap-3 rounded-xl border border-line bg-ink-850 p-3 hover:bg-ink-800">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet-400 to-violet-700 text-sm font-bold text-white">
              {user?.full_name?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">{user?.full_name}</div>
              <div className="text-xs capitalize text-mute">{user?.role}</div>
            </div>
            <UserCog className="h-4 w-4 text-mute" />
          </NavLink>
          <button onClick={signOut} className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-mute hover:text-soft">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        <header className="flex flex-wrap items-center justify-between gap-4 px-6 pb-2 pt-7 lg:px-10">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight text-white">{greeting}, {user?.full_name?.split(" ")[0]}</h1>
            <p className="mt-1 text-sm text-mute">Here's how the market is setting up this hour.</p>
          </div>
          <form onSubmit={search} className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a coin, e.g. SOL" className="input pl-10" aria-label="Search coin" />
          </form>
        </header>
        <main className="flex-1 px-6 pb-10 pt-5 lg:px-10">{children}</main>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-6 py-4 text-xs text-mute lg:px-10">
          <span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5 text-violet-400" />
            Trendscope ranks setups by transparent rules. It's a screener, not financial advice.</span>
          <span>Built by Habban · Data: Binance Spot</span>
        </footer>
      </div>
    </div>
  );
}
