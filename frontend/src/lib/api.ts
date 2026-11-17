import { DemoError, demoApi } from "../demo/mock";

/** True in the GitHub Pages live demo build (VITE_DEMO=1): requests are answered in the browser. */
export const DEMO = import.meta.env.VITE_DEMO === "1";

// API client. The access token lives only in memory (never localStorage, so XSS can't steal a
// long-lived credential). The refresh token is an httpOnly cookie the browser sends to /api/auth.

export type Role = "viewer" | "analyst" | "admin";
export interface User {
  id: string; email: string; full_name: string; role: Role; is_active: boolean;
  locked_until: string | null; last_login_at: string | null; created_at: string;
}
export interface FactorDetail { score: number | null; weight: number; raw?: Record<string, number | boolean | null> }
export interface Signal {
  symbol: string; rank: number | null; score: number; passed_gates: boolean; gate_reason: string | null;
  components: Record<string, FactorDetail>; close: number; rsi: number | null; rvol: number | null;
  ret_1d: number | null; ret_7d: number | null; stop_price: number | null; exit_level: number | null;
}
export interface ScanRun {
  id: number; candle_time: string; finished_at: string | null; status: string;
  regime: "risk_on" | "risk_off" | null; btc_close: number | null; btc_sma200d: number | null;
  coins_total: number; coins_passed: number; weights: Record<string, number>;
}
export interface Candle { t: string; o: number; h: number; l: number; c: number; v: number }
export interface Backtest {
  id: number; created_at: string; finished_at: string | null; status: string;
  params: Record<string, number | boolean>; metrics: any; equity_curve: any[] | null; error: string | null;
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSignedOut: () => void = () => {};

export function setSignedOutHandler(fn: () => void) { onSignedOut = fn; }
export function setAccessToken(t: string | null) { accessToken = t; }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function doRefresh(): Promise<boolean> {
  if (DEMO) {
    try { const b = await demoApi("/api/auth/refresh", "POST"); accessToken = b.access_token; sessionUser = b.user; return true; }
    catch { return false; }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch("/api/auth/refresh", {
      method: "POST", credentials: "same-origin", headers: { "X-Requested-With": "trendscope" },
    });
    if (r.status === 409) { await sleep(600); continue; } // another tab is mid-refresh
    if (!r.ok) return false;
    const body = await r.json();
    accessToken = body.access_token;
    sessionUser = body.user;
    return true;
  }
  return false;
}

/** Single-flight: many requests failing at once trigger only one refresh. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}

export let sessionUser: User | null = null;

export async function api<T = any>(path: string, opts: RequestInit & { json?: unknown } = {}, retry = true): Promise<T> {
  if (DEMO) {
    try { return await demoApi(path, opts.method ?? "GET", opts.json); }
    catch (e) {
      if (e instanceof DemoError) {
        if (e.status === 401 && !path.startsWith("/api/auth/login")) { accessToken = null; onSignedOut(); }
        throw new ApiError(e.status, e.message);
      }
      throw new ApiError(502, `Couldn't reach Binance's public market data: ${(e as Error).message}`);
    }
  }
  const headers = new Headers(opts.headers);
  headers.set("X-Requested-With", "trendscope");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  let body = opts.body;
  if (opts.json !== undefined) { headers.set("Content-Type", "application/json"); body = JSON.stringify(opts.json); }
  const r = await fetch(path, { ...opts, headers, body, credentials: "same-origin" });
  if (r.status === 401 && retry && !path.startsWith("/api/auth/login")) {
    if (await refreshSession()) return api<T>(path, opts, false);
    accessToken = null;
    onSignedOut();
  }
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const d = (await r.json()).detail;
      msg = typeof d === "string" ? d : Array.isArray(d) ? d.map((x: any) => x.msg).join(" ") : msg;
    } catch { /* not JSON */ }
    throw new ApiError(r.status, msg);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

export async function login(email: string, password: string): Promise<User> {
  const body = await api<{ access_token: string; user: User }>("/api/auth/login", { method: "POST", json: { email, password } });
  accessToken = body.access_token;
  sessionUser = body.user;
  return body.user;
}

export async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }, false); } finally { accessToken = null; sessionUser = null; }
}
