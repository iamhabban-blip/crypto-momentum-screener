import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { Loading } from "./components/ui";
import "./index.css";
import { AuthProvider, useAuth } from "./lib/auth";
import type { Role } from "./lib/api";
import Account from "./pages/Account";
import AdminAudit from "./pages/AdminAudit";
import AdminSettings from "./pages/AdminSettings";
import AdminUsers from "./pages/AdminUsers";
import Backtests from "./pages/Backtests";
import Coin from "./pages/Coin";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Method from "./pages/Method";
import Screener from "./pages/Screener";
import Watchlist from "./pages/Watchlist";

function Guard({ role, children }: { role?: Role; children: React.ReactNode }) {
  const { user, ready, can } = useAuth();
  if (!ready) return <div className="min-h-screen"><Loading label="Restoring your session…" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (role && !can(role)) return <Layout><div className="card p-10 text-center text-sm text-mute">Your role doesn't have access to this page.</div></Layout>;
  return <Layout>{children}</Layout>;
}

function App() {
  const { user, ready } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={ready && user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<Guard><Dashboard /></Guard>} />
      <Route path="/screener" element={<Guard><Screener /></Guard>} />
      <Route path="/coin/:symbol" element={<Guard><Coin /></Guard>} />
      <Route path="/watchlist" element={<Guard><Watchlist /></Guard>} />
      <Route path="/backtests" element={<Guard><Backtests /></Guard>} />
      <Route path="/method" element={<Guard><Method /></Guard>} />
      <Route path="/account" element={<Guard><Account /></Guard>} />
      <Route path="/admin/users" element={<Guard role="admin"><AdminUsers /></Guard>} />
      <Route path="/admin/settings" element={<Guard role="admin"><AdminSettings /></Guard>} />
      <Route path="/admin/audit" element={<Guard role="admin"><AdminAudit /></Guard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider><App /></AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
