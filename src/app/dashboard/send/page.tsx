"use client";

import { FormEvent, useEffect, useState } from "react";

type Alias = {
  id: string;
  localPart: string;
  canSend: boolean;
  active: boolean;
  domain: { name: string };
};

export default function SendPage() {
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/aliases")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Failed");
        const list = (d.aliases || []).filter((a: Alias) => a.active && a.canSend);
        setAliases(list);
        if (list[0]) setFrom(`${list[0].localPart}@${list[0].domain.name}`);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function onSend(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult("");
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal kirim");
      setResult(
        data.simulated
          ? `Queued lokal (RESEND_API_KEY belum di-set). Message id: ${data.message?.id}`
          : `Terkirim. Provider id: ${data.providerId || "-"}`
      );
      setSubject("");
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="page-title">Send email</h1>
        <p className="page-sub">Kirim via Resend dari alias domain kamu</p>
      </div>

      <form onSubmit={onSend} className="card p-5 md:p-6 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">From</label>
            <select className="field" value={from} onChange={(e) => setFrom(e.target.value)} required>
              {aliases.map((a) => {
                const addr = `${a.localPart}@${a.domain.name}`;
                return (
                  <option key={a.id} value={addr}>
                    {addr}
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="label">To</label>
            <input
              className="field"
              type="email"
              placeholder="user@gmail.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <label className="label">Subject</label>
          <input
            className="field"
            placeholder="Subjek email"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="label">Body</label>
          <textarea
            className="field min-h-[180px]"
            placeholder="Tulis pesan..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            required
          />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button className="btn btn-primary" disabled={loading} type="submit">
            {loading ? "Mengirim..." : "Kirim email"}
          </button>
          <span className="muted text-xs">Powered by Resend</span>
        </div>
      </form>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {result ? <div className="alert alert-success">{result}</div> : null}
    </div>
  );
}
