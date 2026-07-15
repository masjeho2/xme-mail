"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  cleanEmailBody,
  formatRelativeTime,
  initialsFromEmail,
  previewText,
} from "@/lib/email-body";

type Message = {
  id: string;
  direction: string;
  status: string;
  isRead?: boolean;
  fromAddr: string;
  toAddr: string;
  subject: string;
  textBody?: string | null;
  htmlBody?: string | null;
  createdAt: string;
};

type Alias = {
  id: string;
  localPart: string;
  canSend: boolean;
  active: boolean;
  domain: { name: string };
};

function extractEmail(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  if (m) return m[1].trim();
  return addr.trim();
}

function replySubject(subject: string): string {
  const s = (subject || "").trim();
  if (!s || s === "(no subject)") return "Re: (no subject)";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export default function InboxPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<Message | null>(null);
  const [aliases, setAliases] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [replyOpen, setReplyOpen] = useState(false);
  const [replyFrom, setReplyFrom] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [replyResult, setReplyResult] = useState("");
  const [replyError, setReplyError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/messages?direction=inbound&limit=100");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const list: Message[] = data.messages || [];
      setMessages(list);
      if (selected) {
        const still = list.find((m) => m.id === selected.id);
        if (!still) setSelected(null);
        else setSelected((prev) => (prev ? { ...prev, isRead: still.isRead } : prev));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    fetch("/api/aliases")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) return;
        const list = ((d.aliases || []) as Alias[])
          .filter((a) => a.active && a.canSend)
          .map((a) => `${a.localPart}@${a.domain.name}`);
        setAliases(list);
        if (list[0]) setReplyFrom(list[0]);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openMessage(id: string) {
    setError("");
    setReplyOpen(false);
    setReplyResult("");
    setReplyError("");
    setReplyText("");
    const res = await fetch(`/api/messages/${id}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Gagal buka pesan");
      return;
    }
    const msg: Message = data.message;
    setSelected(msg);
    // Reflect read state in list immediately
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, isRead: true } : m)));

    const to = extractEmail(msg.toAddr).toLowerCase();
    const match = aliases.find((a) => a.toLowerCase() === to);
    if (match) setReplyFrom(match);
    else if (aliases[0]) setReplyFrom(aliases[0]);
  }

  async function toggleRead(id: string, isRead: boolean) {
    const res = await fetch(`/api/messages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRead }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Gagal update status baca");
      return;
    }
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, isRead } : m)));
    if (selected?.id === id) setSelected((s) => (s ? { ...s, isRead } : s));
  }

  async function markAllRead() {
    const res = await fetch("/api/messages/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allInbound: true, isRead: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Gagal tandai semua");
      return;
    }
    setMessages((prev) => prev.map((m) => ({ ...m, isRead: true })));
    if (selected) setSelected({ ...selected, isRead: true });
  }

  const unreadCount = useMemo(
    () => messages.filter((m) => !m.isRead).length,
    [messages]
  );

  const filtered = useMemo(() => {
    let list = messages;
    if (filter === "unread") list = list.filter((m) => !m.isRead);
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => {
      const body = cleanEmailBody(m.textBody, m.htmlBody).toLowerCase();
      return (
        m.subject.toLowerCase().includes(q) ||
        m.fromAddr.toLowerCase().includes(q) ||
        m.toAddr.toLowerCase().includes(q) ||
        body.includes(q)
      );
    });
  }, [messages, query, filter]);

  const selectedBody = selected ? cleanEmailBody(selected.textBody, selected.htmlBody) : "";

  async function onReply(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setReplyLoading(true);
    setReplyError("");
    setReplyResult("");
    try {
      const to = extractEmail(selected.fromAddr);
      const subject = replySubject(selected.subject);
      const quoted = selectedBody
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
      const text = `${replyText.trim()}\n\nOn ${new Date(selected.createdAt).toLocaleString("id-ID")}, ${selected.fromAddr} wrote:\n${quoted}`;

      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: replyFrom, to, subject, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal kirim balasan");

      setReplyResult(
        data.simulated
          ? `Queued lokal. id: ${data.message?.id}`
          : `Balasan terkirim. Provider id: ${data.providerId || "-"}`
      );
      setReplyText("");
      setReplyOpen(false);
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Error");
    } finally {
      setReplyLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            Inbox
            {unreadCount > 0 ? <span className="count-pill">{unreadCount} baru</span> : null}
          </h1>
          <p className="page-sub">Email masuk via Cloudflare → Worker → panel</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {unreadCount > 0 ? (
            <button className="btn btn-ghost btn-sm" type="button" onClick={markAllRead}>
              Tandai semua dibaca
            </button>
          ) : null}
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => load()}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {replyResult ? <div className="alert alert-success">{replyResult}</div> : null}

      <div className="inbox-shell">
        <div className="card mail-list">
          <div className="p-3 border-b border-[var(--border-soft)] space-y-2">
            <input
              className="field"
              placeholder="Cari subject, pengirim, isi..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1">
                <button
                  type="button"
                  className={`btn btn-sm ${filter === "all" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setFilter("all")}
                >
                  Semua
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${filter === "unread" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setFilter("unread")}
                >
                  Belum dibaca{unreadCount ? ` (${unreadCount})` : ""}
                </button>
              </div>
              <div className="muted text-xs">
                {loading ? "Memuat..." : `${filtered.length} pesan`}
              </div>
            </div>
          </div>

          <div className="mail-list-scroll">
            {loading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="skeleton h-14" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty-state">
                <div>
                  <div className="text-2xl mb-2">📭</div>
                  <div className="font-medium text-[var(--text)]">
                    {filter === "unread" ? "Tidak ada yang belum dibaca" : "Inbox kosong"}
                  </div>
                  <div className="text-sm mt-1">
                    {filter === "unread" ? "Semua email sudah dibaca" : "Belum ada email inbound"}
                  </div>
                </div>
              </div>
            ) : (
              filtered.map((m) => {
                const preview = previewText(cleanEmailBody(m.textBody, m.htmlBody), 90);
                const active = selected?.id === m.id;
                const unread = !m.isRead;
                return (
                  <div
                    key={m.id}
                    className={`mail-item ${active ? "active" : ""} ${unread ? "unread" : ""}`}
                    onClick={() => openMessage(m.id)}
                  >
                    <div className="avatar">{initialsFromEmail(m.fromAddr)}</div>
                    <div className="min-w-0">
                      <div className="mail-meta">
                        <div className={`mail-from ${unread ? "unread-text" : ""}`}>
                          {unread ? <span className="unread-dot" aria-hidden /> : null}
                          {m.fromAddr}
                        </div>
                        <div className="mail-time">{formatRelativeTime(m.createdAt)}</div>
                      </div>
                      <div className={`mail-subject ${unread ? "unread-text" : ""}`}>
                        {m.subject || "(no subject)"}
                      </div>
                      <div className="mail-preview">{preview}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="card mail-reader p-4 md:p-5">
          {!selected ? (
            <div className="empty-state flex-1">
              <div>
                <div className="text-2xl mb-2">✉️</div>
                <div className="font-medium text-[var(--text)]">Pilih pesan</div>
                <div className="text-sm mt-1">Klik email di kiri untuk membaca / membalas</div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="avatar">{initialsFromEmail(selected.fromAddr)}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-xl font-semibold leading-snug">
                    {selected.subject || "(no subject)"}
                  </div>
                  <div className="mt-2 space-y-1 text-sm">
                    <div>
                      <span className="muted">From </span>
                      <span className="mono">{selected.fromAddr}</span>
                    </div>
                    <div>
                      <span className="muted">To </span>
                      <span className="mono">{selected.toAddr}</span>
                    </div>
                    <div className="muted text-xs">
                      {new Date(selected.createdAt).toLocaleString("id-ID", {
                        dateStyle: "full",
                        timeStyle: "short",
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 items-end">
                  <span className={`badge ${selected.isRead ? "badge-green" : "badge-blue"}`}>
                    {selected.isRead ? "dibaca" : "baru"}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => toggleRead(selected.id, !selected.isRead)}
                  >
                    {selected.isRead ? "Tandai belum dibaca" : "Tandai dibaca"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setReplyOpen((v) => !v);
                      setReplyError("");
                    }}
                  >
                    {replyOpen ? "Tutup" : "Balas"}
                  </button>
                </div>
              </div>

              <div className="mail-body">{selectedBody}</div>

              {replyOpen ? (
                <form onSubmit={onReply} className="reply-box space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="label">From</label>
                      <select
                        className="field"
                        value={replyFrom}
                        onChange={(e) => setReplyFrom(e.target.value)}
                        required
                      >
                        {aliases.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">To</label>
                      <input className="field" value={extractEmail(selected.fromAddr)} readOnly />
                    </div>
                  </div>
                  <div>
                    <label className="label">Subject</label>
                    <input className="field" value={replySubject(selected.subject)} readOnly />
                  </div>
                  <div>
                    <label className="label">Balasan</label>
                    <textarea
                      className="field min-h-[120px]"
                      placeholder="Tulis balasan..."
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      required
                    />
                  </div>
                  {replyError ? <div className="alert alert-error">{replyError}</div> : null}
                  <div className="flex gap-2">
                    <button className="btn btn-primary" type="submit" disabled={replyLoading}>
                      {replyLoading ? "Mengirim..." : "Kirim balasan"}
                    </button>
                    <button className="btn btn-ghost" type="button" onClick={() => setReplyOpen(false)}>
                      Batal
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
