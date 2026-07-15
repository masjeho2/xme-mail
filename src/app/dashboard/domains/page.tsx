"use client";

import { FormEvent, useEffect, useState } from "react";

type Domain = {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  _count?: { aliases: number; messages: number };
};

export default function DomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const res = await fetch("/api/domains");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");
    setDomains(data.domains || []);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menambah domain");
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Domains</h1>
        <p className="page-sub">Domain yang diizinkan untuk alias & pengiriman</p>
      </div>

      <form onSubmit={onCreate} className="card p-4 md:p-5 flex flex-col md:flex-row gap-3 md:items-end">
        <div className="flex-1">
          <label className="label">Domain baru</label>
          <input
            className="field"
            placeholder="contoh.com"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <button className="btn btn-primary" disabled={loading} type="submit">
          {loading ? "Menyimpan..." : "Tambah domain"}
        </button>
      </form>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="card p-4 md:p-5 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Status</th>
              <th>Aliases</th>
              <th>Messages</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => (
              <tr key={d.id}>
                <td className="mono font-medium">{d.name}</td>
                <td>
                  <span className={`badge ${d.active ? "badge-green" : "badge-red"}`}>
                    {d.active ? "active" : "inactive"}
                  </span>
                </td>
                <td>{d._count?.aliases ?? 0}</td>
                <td>{d._count?.messages ?? 0}</td>
                <td className="muted text-sm">{new Date(d.createdAt).toLocaleString("id-ID")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
