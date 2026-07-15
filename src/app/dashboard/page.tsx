"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatRelativeTime } from "@/lib/email-body";

type Stats = {
  domains: number;
  aliases: number;
  inbound24h: number;
  outbound24h: number;
  failed24h: number;
  unreadInbound?: number;
};

type Recent = {
  id: string;
  direction: string;
  status: string;
  isRead?: boolean;
  fromAddr: string;
  toAddr: string;
  subject: string;
  createdAt: string;
};

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Failed");
        setStats(d.stats);
        setRecent(d.recent || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const cards = [
    { label: "Belum dibaca", value: stats?.unreadInbound, tone: "blue" },
    { label: "Inbound 24h", value: stats?.inbound24h, tone: "green" },
    { label: "Outbound 24h", value: stats?.outbound24h, tone: "green" },
    { label: "Aliases", value: stats?.aliases, tone: "blue" },
    { label: "Failed 24h", value: stats?.failed24h, tone: "red" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Ringkasan email x-me.cloud · 24 jam terakhir</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/inbox" className="btn btn-ghost btn-sm">
            Buka Inbox
            {stats?.unreadInbound ? ` (${stats.unreadInbound})` : ""}
          </Link>
          <Link href="/dashboard/send" className="btn btn-primary btn-sm">
            Kirim email
          </Link>
        </div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="card stat-card">
            <div className="muted text-[11px] uppercase tracking-[0.08em] font-semibold">
              {c.label}
            </div>
            <div className="stat-value">
              {loading ? <span className="skeleton inline-block h-8 w-12" /> : (c.value ?? "—")}
            </div>
          </div>
        ))}
      </div>

      <div className="card p-4 md:p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-lg">Recent activity</h2>
            <p className="muted text-sm">Inbound & outbound terbaru</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Dir</th>
                <th>Status</th>
                <th>Read</th>
                <th>From</th>
                <th>To</th>
                <th>Subject</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7}>
                    <div className="skeleton h-10 w-full" />
                  </td>
                </tr>
              ) : recent.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    Belum ada pesan
                  </td>
                </tr>
              ) : (
                recent.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <span className={`badge ${m.direction === "inbound" ? "badge-blue" : "badge-green"}`}>
                        {m.direction}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          m.status === "failed"
                            ? "badge-red"
                            : m.status === "sent"
                              ? "badge-green"
                              : "badge-yellow"
                        }`}
                      >
                        {m.status}
                      </span>
                    </td>
                    <td>
                      {m.direction === "inbound" ? (
                        <span className={`badge ${m.isRead ? "badge-green" : "badge-blue"}`}>
                          {m.isRead ? "read" : "baru"}
                        </span>
                      ) : (
                        <span className="muted text-xs">—</span>
                      )}
                    </td>
                    <td className="mono text-sm">{m.fromAddr}</td>
                    <td className="mono text-sm">{m.toAddr}</td>
                    <td className={`max-w-[220px] truncate ${m.direction === "inbound" && !m.isRead ? "font-semibold" : ""}`}>
                      {m.subject || "(no subject)"}
                    </td>
                    <td className="muted text-sm whitespace-nowrap">
                      {formatRelativeTime(m.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
