"use client";

import { FormEvent, useEffect, useState } from "react";

type Key = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string;
  active: boolean;
  lastUsedAt: string | null;
  createdAt: string;
};

export default function KeysPage() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    const res = await fetch("/api/keys");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");
    setKeys(data.keys || []);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSecret("");
    setCopied(false);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal");
      setSecret(data.secret);
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Revoke API key ini?")) return;
    const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Gagal");
      return;
    }
    await load();
  }

  async function copySecret() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">API Keys</h1>
        <p className="page-sub">Untuk app eksternal · header Authorization: Bearer xme_...</p>
      </div>

      <form onSubmit={onCreate} className="card p-4 md:p-5 flex flex-col md:flex-row gap-3 md:items-end">
        <div className="flex-1">
          <label className="label">Nama key</label>
          <input
            className="field"
            placeholder="otp-service"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <button className="btn btn-primary" disabled={loading} type="submit">
          {loading ? "..." : "Buat key"}
        </button>
      </form>

      {secret ? (
        <div className="alert alert-success">
          <div className="font-medium mb-2">Simpan secret ini sekarang (hanya sekali):</div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <code className="mono text-sm break-all flex-1 bg-black/20 rounded-lg px-3 py-2">
              {secret}
            </code>
            <button className="btn btn-ghost btn-sm" type="button" onClick={copySecret}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="card p-4 md:p-5 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Scopes</th>
              <th>Last used</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  Belum ada API key
                </td>
              </tr>
            ) : (
              keys.map((k) => (
                <tr key={k.id}>
                  <td className="font-medium">{k.name}</td>
                  <td className="mono text-sm">{k.keyPrefix}…</td>
                  <td>
                    <span className="badge badge-blue">{k.scopes}</span>
                  </td>
                  <td className="muted text-sm">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("id-ID") : "—"}
                  </td>
                  <td className="muted text-sm">{new Date(k.createdAt).toLocaleString("id-ID")}</td>
                  <td className="text-right">
                    <button className="btn btn-danger btn-sm" type="button" onClick={() => remove(k.id)}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
