"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";

export function DashboardShell({
  email,
  children,
}: {
  email?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close drawer on route change (mobile)
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Prevent body scroll when drawer open on mobile
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="shell">
      <div className="mobile-topbar">
        <button
          type="button"
          className="btn btn-ghost btn-sm menu-btn"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
        >
          ☰ Menu
        </button>
        <div className="mobile-brand">
          <span className="brand-mark brand-mark-sm">XM</span>
          <span className="font-semibold text-sm">xme-mail</span>
        </div>
        <div className="w-[72px]" />
      </div>

      {open ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <div className="app-frame">
        <Sidebar email={email} open={open} onClose={() => setOpen(false)} />
        <main className="min-w-0 pb-6">{children}</main>
      </div>
    </div>
  );
}
