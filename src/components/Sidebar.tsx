"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: "◈" },
  { href: "/dashboard/inbox", label: "Inbox", icon: "✉", badgeKey: "unread" as const },
  { href: "/dashboard/send", label: "Send", icon: "➤" },
  { href: "/dashboard/aliases", label: "Aliases", icon: "@" },
  { href: "/dashboard/domains", label: "Domains", icon: "◉" },
  { href: "/dashboard/keys", label: "API Keys", icon: "🔑" },
  { href: "/dashboard/docs", label: "API Docs", icon: "{}" },
];

export function Sidebar({
  email,
  open = false,
  onClose,
}: {
  email?: string;
  open?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    async function loadUnread() {
      try {
        const res = await fetch("/api/stats");
        const data = await res.json();
        if (!alive || !res.ok) return;
        setUnread(Number(data.stats?.unreadInbound || 0));
      } catch {
        // ignore
      }
    }
    loadUnread();
    const t = setInterval(loadUnread, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  return (
    <aside className={`card sidebar ${open ? "sidebar-open" : ""}`}>
      <div className="flex items-center gap-3 px-1 py-2 mb-5">
        <div className="brand-mark">XM</div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-[0.18em] text-blue-300/80">xme-mail</div>
          <div className="font-semibold leading-tight">Email Panel</div>
          <div className="muted text-xs mt-0.5 truncate">{email || "admin"}</div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm sidebar-close"
          aria-label="Close menu"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <nav className="space-y-1 flex-1">
        {links.map((l) => {
          const active =
            pathname === l.href || (l.href !== "/dashboard" && pathname.startsWith(l.href));
          const showBadge = l.badgeKey === "unread" && unread > 0;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`nav-link ${active ? "active" : ""}`}
              onClick={onClose}
            >
              <span className="nav-ico">{l.icon}</span>
              <span>{l.label}</span>
              {showBadge ? <span className="nav-badge">{unread > 99 ? "99+" : unread}</span> : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 pt-3 border-t border-[var(--border-soft)] space-y-2">
        <a
          className="nav-link"
          href={typeof window !== "undefined" ? window.location.origin : "/"}
          target="_blank"
          rel="noreferrer"
        >
          <span className="nav-ico">↗</span>
          <span className="text-sm">Open public URL</span>
        </a>
        <button className="btn btn-ghost w-full" onClick={logout} type="button">
          Logout
        </button>
      </div>
    </aside>
  );
}
