"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const search = useSearchParams();
  const next = search.get("next") || "/dashboard";
  const [email, setEmail] = useState("admin@x-me.cloud");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login gagal");
        setLoading(false);
        return;
      }
      window.location.assign(next.startsWith("/") ? next : "/dashboard");
    } catch {
      setError("Tidak bisa terhubung ke server");
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="relative w-full max-w-md">
        <div className="login-glow" />
        <div className="card login-card">
          <div className="flex items-center gap-3 mb-7">
            <div className="brand-mark">XM</div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-blue-300/80">xme-mail</div>
              <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
            </div>
          </div>

          <p className="muted text-sm mb-6">
            Panel email multi-tenant untuk <span className="text-blue-200">x-me.cloud</span>
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                className="field"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                className="field"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {error ? <div className="alert alert-error">{error}</div> : null}

            <button className="btn btn-primary w-full" disabled={loading} type="submit">
              {loading ? "Masuk..." : "Masuk ke panel"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="login-wrap muted">Loading...</div>}>
      <LoginForm />
    </Suspense>
  );
}
