// In-browser stand-in for the FastAPI backend, used only by the GitHub Pages live demo
// (built with VITE_DEMO=1). Market data and scores are LIVE from Binance; users, settings,
// audit log and watchlist are per-visitor sample data kept in this browser.

import { DEFAULT_WEIGHTS, runBacktest, type Config } from "./engine";
import { loadBacktestData, loadSnapshot, scan, type Snapshot } from "./market";

export const DEMO_EMAIL = "demo@trendscope.dev";
export const DEMO_PASSWORD = "live-demo";

export class DemoError extends Error { constructor(public status: number, message: string) { super(message); } }

const now = () => new Date().toISOString();
const ls = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem("ts_demo_" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem("ts_demo_" + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const ss = {
  get: (k: string) => { try { return sessionStorage.getItem("ts_demo_" + k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { v === null ? sessionStorage.removeItem("ts_demo_" + k) : sessionStorage.setItem("ts_demo_" + k, v); } catch { /* ignore */ } },
};

const demoUser = { id: "00000000-0000-4000-8000-000000000001", email: DEMO_EMAIL, full_name: "Demo Admin", role: "admin",
  is_active: true, locked_until: null, last_login_at: now(), created_at: "2026-11-01T09:00:00Z" };

let users: any[] = [
  demoUser,
  { id: "00000000-0000-4000-8000-000000000002", email: "sara@example.com", full_name: "Sara Malik", role: "analyst", is_active: true, locked_until: null, last_login_at: "2026-11-16T18:20:00Z", created_at: "2026-11-02T10:00:00Z" },
  { id: "00000000-0000-4000-8000-000000000003", email: "omar@example.com", full_name: "Omar Khan", role: "viewer", is_active: true, locked_until: new Date(Date.now() + 9 * 60_000).toISOString(), last_login_at: "2026-11-15T07:45:00Z", created_at: "2026-11-03T11:00:00Z" },
];
let auditId = 6;
const audit: any[] = [
  { id: 5, actor_email: "omar@example.com", action: "account_locked", target: null, ip: "203.0.113.24", meta: { minutes: 15 }, created_at: new Date(Date.now() - 6 * 60_000).toISOString() },
  { id: 4, actor_email: "omar@example.com", action: "login_failed", target: null, ip: "203.0.113.24", meta: { reason: "bad_password" }, created_at: new Date(Date.now() - 7 * 60_000).toISOString() },
  { id: 3, actor_email: DEMO_EMAIL, action: "user_created", target: "omar@example.com", ip: "198.51.100.7", meta: { role: "viewer" }, created_at: "2026-11-03T11:00:00Z" },
  { id: 2, actor_email: DEMO_EMAIL, action: "user_created", target: "sara@example.com", ip: "198.51.100.7", meta: { role: "analyst" }, created_at: "2026-11-02T10:00:00Z" },
  { id: 1, actor_email: "sara@example.com", action: "login_success", target: null, ip: "192.0.2.15", meta: {}, created_at: "2026-11-16T18:20:00Z" },
];
const log = (action: string, target: string | null = null, meta: Record<string, unknown> = {}) =>
  audit.unshift({ id: auditId++, actor_email: DEMO_EMAIL, action, target, ip: "this browser", meta, created_at: now() });

let cfg: Config = ls.get("settings", { min_quote_volume_24h: 2_000_000, min_history_days: 30, regime_mode: "flag", weights: { ...DEFAULT_WEIGHTS } });

// ── Live market snapshot (refreshed at most every 5 minutes) ─────────────────
let snap: Snapshot | null = null;
let loading: Promise<Snapshot> | null = null;
let loadedVolume = 0;
export const progress = { done: 0, total: 0, listeners: new Set<() => void>() };
const tick = (d: number, t: number) => { progress.done = d; progress.total = t; progress.listeners.forEach((f) => f()); };

async function snapshot(): Promise<Snapshot> {
  const fresh = snap && Date.now() - snap.finishedAt < 5 * 60_000 && loadedVolume <= cfg.min_quote_volume_24h;
  if (fresh) return snap!;
  loading ??= loadSnapshot(cfg.min_quote_volume_24h, tick).then((s) => { snap = s; loadedVolume = cfg.min_quote_volume_24h; return s; })
    .finally(() => { loading = null; });
  return loading;
}

// ── Backtests (computed in the browser on live history) ───────────────────────
const backtests: any[] = [];
let btId = 1;

async function executeBacktest(job: any) {
  job.status = "running";
  try {
    const s = await snapshot();
    const ranked = Object.keys(s.bars).filter((x) => x !== "BTCUSDT")
      .map((x) => ({ x, qv: s.bars[x].qv.slice(-24).reduce((a, b) => a + b, 0) })).sort((a, b) => b.qv - a.qv)
      .slice(0, job.params.coins).map((r) => r.x);
    const data = await loadBacktestData(ranked, job.params.days, (d, t) => { job.progress = `${d}/${t} coins downloaded`; });
    job.progress = "simulating…";
    await new Promise((r) => setTimeout(r, 30));
    const { metrics, curve } = runBacktest(data.frames, data.btc, data.daily, cfg, data.listing, job.params);
    job.metrics = { ...metrics, coins_tested: Object.keys(data.frames).length };
    job.equity_curve = curve;
    job.status = "succeeded";
  } catch (e: any) {
    job.status = "failed";
    job.error = e?.message ?? String(e);
  }
  job.finished_at = now();
}

// ── Router ────────────────────────────────────────────────────────────────────
function requireSession() {
  if (ss.get("session") !== "1") throw new DemoError(401, "Not signed in.");
}

export async function demoApi(path: string, method = "GET", body?: any): Promise<any> {
  const url = new URL(path, "https://demo.local");
  const p = url.pathname;
  const q = url.searchParams;

  if (p === "/api/auth/login" && method === "POST") {
    if (body?.email?.toLowerCase() !== DEMO_EMAIL || body?.password !== DEMO_PASSWORD)
      throw new DemoError(401, `Incorrect email or password. Use ${DEMO_EMAIL} / ${DEMO_PASSWORD}.`);
    ss.set("session", "1");
    log("login_success");
    return { access_token: "demo", token_type: "bearer", expires_in: 900, user: demoUser };
  }
  if (p === "/api/auth/refresh") { requireSession(); return { access_token: "demo", user: demoUser }; }
  if (p === "/api/auth/logout" || p === "/api/auth/logout-all") { ss.set("session", null); log("logout"); return undefined; }

  requireSession();

  if (p === "/api/auth/me") return demoUser;
  if (p === "/api/auth/change-password") throw new DemoError(400, "Passwords can't be changed in the live demo.");

  if (p === "/api/signals/latest") {
    const res = scan(await snapshot(), cfg);
    const sig = q.get("include_filtered") === "true" ? res.signals : res.signals.filter((s) => s.passed_gates);
    sig.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || b.score - a.score);
    return { run: res.run, signals: sig };
  }
  if (p === "/api/market/btc") {
    const s = await snapshot();
    const days = +(q.get("days") ?? 120);
    const c = s.daily.c;
    const pts = s.daily.t.map((t, i) => ({ t: new Date(t).toISOString(), close: c[i],
      sma200: i >= 199 ? c.slice(i - 199, i + 1).reduce((a, b) => a + b, 0) / 200 : null }));
    return pts.slice(-days);
  }
  const sym = p.match(/^\/api\/symbols\/([A-Z0-9]+)$/);
  if (sym) {
    const s = await snapshot();
    const b = s.bars[sym[1]];
    if (!b) throw new DemoError(404, "No data for this coin (it may be below the volume filter).");
    const res = scan(s, cfg).signals.find((x) => x.symbol === sym[1]) ?? null;
    const hours = +(q.get("hours") ?? 168);
    const n = b.t.length;
    const candles = b.t.slice(-hours).map((t, j) => { const i = n - Math.min(hours, n) + j;
      return { t: new Date(t).toISOString(), o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i] }; });
    const wl: any[] = ls.get("watchlist", []);
    return { symbol: sym[1], signal: res, candles, on_watchlist: wl.some((w) => w.symbol === sym[1]),
      score_history: res ? res.history.t.map((t: number, i: number) => ({ t: new Date(t).toISOString(), score: res.history.score[i], rank: null })) : [] };
  }

  if (p === "/api/watchlist") {
    const wl: any[] = ls.get("watchlist", []);
    if (method === "POST") {
      if (!wl.some((w) => w.symbol === body.symbol)) wl.unshift({ symbol: body.symbol, note: body.note ?? null, created_at: now() });
      ls.set("watchlist", wl); log("watchlist_add", body.symbol);
      return wl[0];
    }
    const res = snap ? scan(snap, cfg).signals : [];
    return wl.map((w) => { const s = res.find((x) => x.symbol === w.symbol);
      return { ...w, score: s?.score ?? null, close: s?.close ?? null, ret_1d: s?.ret_1d ?? null }; });
  }
  const wlDel = p.match(/^\/api\/watchlist\/([A-Z0-9]+)$/);
  if (wlDel && method === "DELETE") {
    ls.set("watchlist", ls.get<any[]>("watchlist", []).filter((w) => w.symbol !== wlDel[1])); log("watchlist_remove", wlDel[1]);
    return undefined;
  }

  if (p === "/api/backtests" && method === "POST") {
    if (backtests.some((b) => b.status === "queued" || b.status === "running")) throw new DemoError(409, "A backtest is already running.");
    const days = Math.min(body.days, 365), coins = 40;
    const job = { id: btId++, created_at: now(), finished_at: null, status: "queued",
      params: { ...body, days, coins }, metrics: null, equity_curve: null, error: null, progress: "starting…" };
    backtests.unshift(job);
    log("backtest_queued", String(job.id), job.params);
    executeBacktest(job);
    return job;
  }
  if (p === "/api/backtests") return backtests.map((b) => ({ ...b, error: b.status === "running" ? null : b.error }));

  if (p === "/api/admin/users" && method === "GET") return users;
  if (p === "/api/admin/users" && method === "POST") {
    if (users.some((u) => u.email === body.email.toLowerCase())) throw new DemoError(409, "A user with this email already exists.");
    if ((body.password ?? "").length < 12) throw new DemoError(422, "Use at least 12 characters.");
    const u = { id: crypto.randomUUID(), email: body.email.toLowerCase(), full_name: body.full_name, role: body.role, is_active: true,
      locked_until: null, last_login_at: null, created_at: now() };
    users = [...users, u]; log("user_created", u.email, { role: u.role });
    return u;
  }
  const um = p.match(/^\/api\/admin\/users\/([\w-]+)(?:\/(unlock|reset-password|revoke-sessions))?$/);
  if (um) {
    const u = users.find((x) => x.id === um[1]);
    if (!u) throw new DemoError(404, "User not found.");
    if (um[2] === "unlock") { u.locked_until = null; log("user_unlocked", u.email); return u; }
    if (um[2] === "reset-password") {
      if ((body.new_password ?? "").length < 12) throw new DemoError(422, "Use at least 12 characters.");
      log("password_reset_by_admin", u.email); return undefined;
    }
    if (um[2] === "revoke-sessions") { log("sessions_revoked_by_admin", u.email); return undefined; }
    if (u.id === demoUser.id && (body.role && body.role !== "admin" || body.is_active === false))
      throw new DemoError(400, "You can't remove your own admin access. Ask another admin.");
    Object.assign(u, body); log("user_updated", u.email, { changes: body });
    return u;
  }
  if (p === "/api/admin/settings") {
    if (method === "PUT") {
      const total = Object.values(body.weights as Record<string, number>).reduce((a, b) => a + b, 0);
      if (Math.abs(total - 100) > 0.01) throw new DemoError(422, "weights must add up to 100");
      log("settings_changed", "screener", { before: cfg, after: body });
      cfg = body; ls.set("settings", cfg);
    }
    return cfg;
  }
  if (p === "/api/admin/audit") {
    let rows = audit;
    if (q.get("action")) rows = rows.filter((r) => r.action === q.get("action"));
    if (q.get("email")) rows = rows.filter((r) => (r.actor_email ?? "").includes(q.get("email")!.toLowerCase()));
    const off = +(q.get("offset") ?? 0), lim = +(q.get("limit") ?? 50);
    return { total: rows.length, items: rows.slice(off, off + lim) };
  }
  throw new DemoError(404, "Not available in the live demo.");
}
