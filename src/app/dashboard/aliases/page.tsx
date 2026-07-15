"use client";

import { FormEvent, useEffect, useState } from "react";

type Domain = { id: string; name: string };
type Alias = {
  id: string;
  localPart: string;
  forwardTo: string | null;
  canSend: boolean;
  active: boolean;
  isCatchAll: boolean;
  cfRuleId?: string | null;
  domain: Domain;
};

export default function AliasesPage() {
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [localPart, setLocalPart] = useState("");
  const [domainId, setDomainId] = useState("");
  const [forwardTo, setForwardTo] = useState("");
  const [cfSync, setCfSync] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    const [a, d] = await Promise.all([fetch("/api/aliases"), fetch("/api/domains")]);
    const aj = await a.json();
    const dj = await d.json();
    if (!a.ok) throw new Error(aj.error || "Failed aliases");
    if (!d.ok) throw new Error(dj.error || "Failed domains");
    setAliases(aj.aliases || []);
    setCfSync(Boolean(aj.cloudflareSync));
    setDomains(dj.domains || []);
    if (!domainId && dj.domains?.[0]?.id) setDomainId(dj.domains[0].id);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setInfo("");
    try {
      const res = await fetch("/api/aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          localPart,
          domainId,
          forwardTo: forwardTo || null,
          canSend: true,
          active: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal");
      setLocalPart("");
      setForwardTo("");
      if (data.cloudflare?.synced) {
        setInfo(`Alias dibuat + routing Cloudflare aktif (${data.alias.localPart}@${data.alias.domain.name})`);
      } else {
        setInfo("Alias dibuat (Cloudflare sync off / tidak diset)");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Hapus alias ini? Rule Cloudflare-nya juga akan dihapus.")) return;
    setError("");
    setInfo("");
    const res = await fetch(`/api/aliases/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Gagal hapus");
      return;
    }
    setInfo("Alias + routing Cloudflare dihapus");
    await load();
  }

  async function syncAll() {
    setSyncing(true);
    setError("");
    setInfo("");
    try {
      const res = await fetch("/api/cloudflare/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync gagal");
      setInfo(
        `Sync OK: ${data.synced} alias → CF. Catch-all disabled: ${data.catchAll?.disabled ?? 0}. Gagal: ${data.failed?.length || 0}`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Aliases</h1>
          <p className="page-sub">
            Alamat domain ·{" "}
            {cfSync ? (
              <span className="text-green-300">Cloudflare auto-sync ON</span>
            ) : (
              <span className="text-yellow-200">Cloudflare auto-sync OFF</span>
            )}
          </p>
        </div>
        {cfSync ? (
          <button className="btn btn-ghost btn-sm" type="button" disabled={syncing} onClick={syncAll}>
            {syncing ? "Syncing..." : "Sync semua ke Cloudflare"}
          </button>
        ) : null}
      </div>

      <div className="card p-4 text-sm muted leading-relaxed">
        <div className="text-[var(--text)] font-medium mb-1">Cara kerja</div>
        Tambah alias di sini → otomatis buat rule Email Routing di Cloudflare ke Worker <code className="mono">mail</code>.
        Hapus alias → rule CF ikut dihapus. Catch-all dimatikan supaya alamat random (mis. mas@) tidak masuk.
      </div>

      <form onSubmit={onCreate} className="card p-4 md:p-5 grid md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="label">Local part</label>
          <input
            className="field"
            placeholder="info"
            value={localPart}
            onChange={(e) => setLocalPart(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Domain</label>
          <select className="field" value={domainId} onChange={(e) => setDomainId(e.target.value)} required>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Forward to (opsional)</label>
          <input
            className="field"
            type="email"
            placeholder="kamu@gmail.com"
            value={forwardTo}
            onChange={(e) => setForwardTo(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" disabled={loading} type="submit">
          {loading ? "..." : "Tambah alias"}
        </button>
      </form>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {info ? <div className="alert alert-success">{info}</div> : null}

      <div className="card p-4 md:p-5 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Forward</th>
              <th>Send</th>
              <th>CF Routing</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {aliases.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  Belum ada alias
                </td>
              </tr>
            ) : (
              aliases.map((a) => (
                <tr key={a.id}>
                  <td className="mono font-medium">
                    {a.localPart}@{a.domain.name}
                  </td>
                  <td className="muted text-sm">{a.forwardTo || "—"}</td>
                  <td>
                    <span className={`badge ${a.canSend ? "badge-green" : "badge-yellow"}`}>
                      {a.canSend ? "can send" : "no send"}
                    </span>
                  </td>
                  <td>
                    {a.cfRuleId ? (
                      <span className="badge badge-green" title={a.cfRuleId}>
                        synced
                      </span>
                    ) : (
                      <span className="badge badge-yellow">not synced</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${a.active ? "badge-green" : "badge-red"}`}>
                      {a.active ? "active" : "off"}
                    </span>
                  </td>
                  <td className="text-right">
                    <button className="btn btn-danger btn-sm" type="button" onClick={() => remove(a.id)}>
                      Hapus
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
