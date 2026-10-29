"use client";

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  cleanEmailBody,
  displayFrom,
  formatRelativeTime,
  initialsFromEmail,
  linkifySegments,
  previewText,
} from "@/lib/email-body";
import { hasRenderableHtml } from "@/lib/email-html";
import {
  ensureNotificationPermission,
  getDesktopNotifEnabled,
  getSoundEnabled,
  notificationPermission,
  notifyNewMails,
  playNewMailSound,
  setDesktopNotifEnabled,
  setSoundEnabled,
  unlockAudio,
} from "@/lib/notify";
import {
  isPushActive,
  pushSupported,
  registerServiceWorker,
  subscribeWebPush,
} from "@/lib/push-client";

type AttachmentMeta = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  storagePath: string;
};

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
  bodyPreview?: string;
  hasHtml?: boolean;
  attachmentsJson?: string | null;
  createdAt: string;
};

function parseAttachments(json?: string | null): AttachmentMeta[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as AttachmentMeta[]) : [];
  } catch {
    return [];
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

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

function InboxPageInner() {
  const searchParams = useSearchParams();
  const openFromUrl = searchParams.get("open");

  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<Message | null>(null);
  const [aliases, setAliases] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const openedFromUrlRef = useRef<string | null>(null);

  const [replyOpen, setReplyOpen] = useState(false);
  const [replyFrom, setReplyFrom] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [replyResult, setReplyResult] = useState("");
  const [replyError, setReplyError] = useState("");

  const [soundOn, setSoundOn] = useState(true);
  const [, setDesktopOn] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastCheckAt, setLastCheckAt] = useState<Date | null>(null);
  const [pollFlash, setPollFlash] = useState(false);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">("default");
  const [pushActive, setPushActive] = useState(false);
  const [alertInfo, setAlertInfo] = useState("");
  const [bodyTab, setBodyTab] = useState<"html" | "text">("html");

  const knownIdsRef = useRef<Set<string> | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    selectedIdRef.current = selected?.id ?? null;
  }, [selected?.id]);

  useEffect(() => {
    setSoundOn(getSoundEnabled());
    setDesktopOn(getDesktopNotifEnabled());
    setNotifPerm(notificationPermission());
    // Detect existing web-push subscription so the big button can hide
    void (async () => {
      try {
        await registerServiceWorker();
        const active = await isPushActive();
        setPushActive(active);
      } catch {
        setPushActive(false);
      }
    })();
  }, []);

  async function enableAlerts() {
    setError("");
    setAlertInfo("");

    // 1) Unlock audio from this user click (required by browsers)
    const audioOk = await unlockAudio();
    setSoundOn(true);
    setSoundEnabled(true);
    playNewMailSound(true);

    // 2) Request notification permission from this same click
    const perm = await ensureNotificationPermission();
    setNotifPerm(perm);

    if (perm === "granted") {
      setDesktopOn(true);
      setDesktopNotifEnabled(true);

      // 3) Web Push (works even when browser is closed, if OS allows)
      let pushMsg = "";
      let active = false;
      if (pushSupported()) {
        await registerServiceWorker();
        const push = await subscribeWebPush();
        active = Boolean(push.ok);
        pushMsg = push.ok
          ? " Web Push aktif (bisa notif meski tab ditutup)."
          : ` Web Push gagal: ${push.error || "unknown"}`;
      } else {
        pushMsg = " Browser ini tidak support Web Push background.";
      }
      setPushActive(active);

      try {
        new Notification("xme-mail siap", {
          body: "Notifikasi email baru aktif." + pushMsg,
          icon: "/icons/icon-192.png?v=3",
          tag: "xme-mail-ready",
        });
      } catch {
        /* ignore */
      }
      setAlertInfo(
        (audioOk ? "Suara + notifikasi aktif." : "Notifikasi aktif. Suara mungkin masih diblok browser.") +
          pushMsg
      );
      // auto-hide success banner
      window.setTimeout(() => setAlertInfo(""), 4000);
      return;
    }

    if (perm === "denied") {
      setDesktopOn(false);
      setDesktopNotifEnabled(false);
      setPushActive(false);
      setError(
        "Browser memblokir notifikasi. Buka ikon gembok di address bar → Site settings → Notifications → Allow, lalu klik Aktifkan notif lagi."
      );
      return;
    }

    if (perm === "unsupported") {
      setDesktopOn(false);
      setDesktopNotifEnabled(false);
      setPushActive(false);
      setAlertInfo(
        audioOk
          ? "Suara aktif. Browser ini tidak support Notification API."
          : "Browser tidak support notifikasi desktop."
      );
      return;
    }

    // default / dismissed
    setDesktopOn(false);
    setDesktopNotifEnabled(false);
    setPushActive(false);
    setAlertInfo("Popup izin ditutup. Klik lagi tombol Aktifkan push notif.");
  }

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      // Light payload: server strips heavy bodies but provides bodyPreview
      const res = await fetch("/api/messages?direction=inbound&limit=100", {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const list: Message[] = data.messages || [];

      // Detect brand-new messages after first successful load
      const prev = knownIdsRef.current;
      if (prev) {
        const fresh = list.filter((m) => !prev.has(m.id));
        if (fresh.length) {
          notifyNewMails(
            fresh.map((m) => ({
              id: m.id,
              from: displayFrom(m.fromAddr),
              subject: m.subject || "(no subject)",
            })),
            (id) => {
              // best-effort open when user clicks notification
              void (async () => {
                const r = await fetch(`/api/messages/${id}`);
                const d = await r.json();
                if (r.ok && d.message) {
                  setSelected(d.message);
                  setMessages((cur) =>
                    cur.map((x) => (x.id === id ? { ...x, isRead: true } : x))
                  );
                }
              })();
            }
          );
          setPollFlash(true);
          window.setTimeout(() => setPollFlash(false), 2500);
        }
      }
      knownIdsRef.current = new Set(list.map((m) => m.id));

      setMessages(list);
      setLastCheckAt(new Date());

      const selId = selectedIdRef.current;
      if (selId) {
        const still = list.find((m) => m.id === selId);
        if (!still) setSelected(null);
        else
          setSelected((prevSel) =>
            prevSel ? { ...prevSel, isRead: still.isRead } : prevSel
          );
      }
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "Error");
    } finally {
      if (!silent) setLoading(false);
      initialLoadDone.current = true;
    }
  }, []);

  useEffect(() => {
    void load();
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
  }, [load]);

  // Auto-refresh every 12s while tab visible
  useEffect(() => {
    if (!autoRefresh) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void load({ silent: true });
    };
    const id = window.setInterval(tick, 12_000);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [autoRefresh, load]);

  const openMessage = useCallback(
    async (id: string) => {
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
      setAliases((current) => {
        const match = current.find((a) => a.toLowerCase() === to);
        if (match) setReplyFrom(match);
        else if (current[0]) setReplyFrom(current[0]);
        return current;
      });
    },
    []
  );

  // Deep-link from Web Push: /dashboard/inbox?open=<messageId>
  useEffect(() => {
    if (!openFromUrl) return;
    if (openedFromUrlRef.current === openFromUrl) return;
    openedFromUrlRef.current = openFromUrl;
    void openMessage(openFromUrl);
    // Clean query from URL without reload (keeps history tidy)
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("open");
      window.history.replaceState({}, "", url.pathname + (url.search || ""));
    } catch {
      /* ignore */
    }
  }, [openFromUrl, openMessage]);

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

  async function deleteMessage(id: string) {
    if (!confirm("Hapus pesan ini?")) return;
    setError("");
    const res = await fetch(`/api/messages/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Gagal hapus pesan");
      return;
    }
    setMessages((prev) => prev.filter((m) => m.id !== id));
    if (selected?.id === id) {
      setSelected(null);
      setReplyOpen(false);
    }
    setReplyResult("Pesan dihapus");
  }

  async function deleteAllInbound() {
    if (!confirm("Hapus SEMUA pesan di Inbox? Tindakan ini tidak bisa dibatalkan.")) return;
    setError("");
    const res = await fetch("/api/messages", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allInbound: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Gagal hapus inbox");
      return;
    }
    setMessages([]);
    setSelected(null);
    setReplyOpen(false);
    setReplyResult(`Inbox dikosongkan (${data.count ?? 0} pesan)`);
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
      const body = (m.bodyPreview ?? cleanEmailBody(m.textBody, m.htmlBody)).toLowerCase();
      return (
        m.subject.toLowerCase().includes(q) ||
        m.fromAddr.toLowerCase().includes(q) ||
        m.toAddr.toLowerCase().includes(q) ||
        body.includes(q)
      );
    });
  }, [messages, query, filter]);

  // One-line previews: prefer server-provided preview, else compute once per list
  const previews = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of filtered) {
      map.set(
        m.id,
        m.bodyPreview ?? previewText(cleanEmailBody(m.textBody, m.htmlBody), 90)
      );
    }
    return map;
  }, [filtered]);

  const selectedBody = selected ? cleanEmailBody(selected.textBody, selected.htmlBody) : "";
  const selectedBodyParts = useMemo(() => linkifySegments(selectedBody), [selectedBody]);
  const selectedAttachments = useMemo(
    () => (selected ? parseAttachments(selected.attachmentsJson) : []),
    [selected]
  );
  // Real HTML view available when message has an htmlBody that sanitizes cleanly
  const selectedHtml = selected?.htmlBody;
  const hasHtmlView = useMemo(
    () => (selectedHtml ? hasRenderableHtml(selectedHtml) : false),
    [selectedHtml]
  );

  // Default to HTML view when the message has one; fall back to text
  useEffect(() => {
    setBodyTab(hasHtmlView ? "html" : "text");
  }, [hasHtmlView]);

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
        <div className="flex flex-wrap gap-2 items-center">
          <label className="notify-toggle" title="Auto-refresh inbox tiap 12 detik">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto</span>
          </label>
          <label className="notify-toggle" title="Suara saat email baru">
            <input
              type="checkbox"
              checked={soundOn}
              onChange={(e) => {
                const on = e.target.checked;
                setSoundOn(on);
                setSoundEnabled(on);
                if (on) void unlockAudio().then(() => playNewMailSound(true));
              }}
            />
            <span>Suara</span>
          </label>
          {pushActive ? (
            <span className="notify-toggle" title="Web Push aktif di browser ini" style={{ cursor: "default" }}>
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
              <span>Push aktif</span>
            </span>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void enableAlerts()}
              title="Aktifkan notifikasi desktop + Web Push (background) + suara"
            >
              Aktifkan push notif
            </button>
          )}
          {unreadCount > 0 ? (
            <button className="btn btn-ghost btn-sm" type="button" onClick={markAllRead}>
              Tandai semua dibaca
            </button>
          ) : null}
          {messages.length > 0 ? (
            <button className="btn btn-danger btn-sm" type="button" onClick={deleteAllInbound}>
              Hapus semua
            </button>
          ) : null}
          <button
            className={`btn btn-ghost btn-sm ${pollFlash ? "btn-primary" : ""}`}
            type="button"
            onClick={() => load()}
            title={lastCheckAt ? `Cek terakhir: ${lastCheckAt.toLocaleTimeString("id-ID")}` : "Refresh"}
          >
            {pollFlash ? "Email baru!" : "Refresh"}
          </button>
        </div>
      </div>

      {notifPerm !== "granted" ? (
        <div className="alert alert-info">
          Belum ada izin notifikasi browser. Klik tombol <b>Aktifkan notif & suara</b> di atas —
          popup izin hanya muncul dari klik tombol itu (bukan otomatis).
          {notifPerm === "denied" ? (
            <span>
              {" "}
              Status sekarang: <b>diblokir</b>. Buka ikon gembok URL → Notifications → Allow.
            </span>
          ) : null}
        </div>
      ) : null}
      {error ? <div className="alert alert-error">{error}</div> : null}
      {alertInfo ? <div className="alert alert-success">{alertInfo}</div> : null}
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
                const preview = previews.get(m.id) || "";
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
                        <div className={`mail-from ${unread ? "unread-text" : ""}`} title={m.fromAddr}>
                          {unread ? <span className="unread-dot" aria-hidden /> : null}
                          {displayFrom(m.fromAddr)}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="mail-time">{formatRelativeTime(m.createdAt)}</div>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            title="Hapus"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteMessage(m.id);
                            }}
                          >
                            🗑
                          </button>
                        </div>
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
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => deleteMessage(selected.id)}
                  >
                    Hapus
                  </button>
                </div>
              </div>

              {selectedAttachments.length > 0 ? (
                <div className="attach-list space-y-3">
                  <div className="muted text-xs uppercase tracking-wide">
                    Lampiran ({selectedAttachments.length})
                  </div>

                  {/* Full image previews inside the reader */}
                  <div className="space-y-3">
                    {selectedAttachments
                      .filter((a) => a.contentType.startsWith("image/"))
                      .map((a) => {
                        const href = `/api/messages/${selected.id}/attachments/${a.id}`;
                        return (
                          <a
                            key={`preview-${a.id}`}
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="attach-preview-card"
                            title={a.filename}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={href} alt={a.filename} className="attach-preview-img" />
                            <div className="attach-preview-meta">
                              <span className="attach-name">{a.filename}</span>
                              <span className="attach-size">{formatBytes(a.size)} · klik untuk buka</span>
                            </div>
                          </a>
                        );
                      })}
                  </div>

                  {/* Non-image files as chips */}
                  <div className="flex flex-wrap gap-2">
                    {selectedAttachments
                      .filter((a) => !a.contentType.startsWith("image/"))
                      .map((a) => {
                        const href = `/api/messages/${selected.id}/attachments/${a.id}`;
                        return (
                          <a
                            key={a.id}
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="attach-chip"
                            title={a.filename}
                          >
                            <span className="attach-icon">📎</span>
                            <span className="min-w-0">
                              <span className="attach-name">{a.filename}</span>
                              <span className="attach-size">{formatBytes(a.size)}</span>
                            </span>
                          </a>
                        );
                      })}
                  </div>
                </div>
              ) : null}

              {hasHtmlView && selectedBody ? (
                <div className="view-toggle" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={bodyTab === "html"}
                    className={bodyTab === "html" ? "active" : ""}
                    onClick={() => setBodyTab("html")}
                  >
                    Tampilan email
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={bodyTab === "text"}
                    className={bodyTab === "text" ? "active" : ""}
                    onClick={() => setBodyTab("text")}
                  >
                    Teks sederhana
                  </button>
                </div>
              ) : null}

              {bodyTab === "html" && hasHtmlView ? (
                <div className="mail-html-frame-wrap">
                  <iframe
                    src={`/api/messages/${selected.id}/html`}
                    title="Email HTML"
                    sandbox="allow-popups allow-popups-to-escape-sandbox"
                    className="mail-html-frame"
                  />
                </div>
              ) : (
                <div className="mail-body">
                  {selectedBodyParts.map((part, i) =>
                    part.type === "link" ? (
                      <a
                        key={`${i}-${part.value.slice(0, 24)}`}
                        href={part.value}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mail-link"
                      >
                        {part.value}
                      </a>
                    ) : (
                      <span key={i}>{part.value}</span>
                    )
                  )}
                </div>
              )}

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

export default function InboxPage() {
  return (
    <Suspense fallback={<div className="muted p-6">Memuat inbox...</div>}>
      <InboxPageInner />
    </Suspense>
  );
}
