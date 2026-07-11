"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useState, useEffect, useCallback } from "react";
import { CommandBar } from "./command-bar";
import { BluRidgeLogo } from "./bluridge-logo";
import { LiveClock } from "./live-clock";

// ── SVG Icons ────────────────────────────────────────────────────────
const FILL_ICONS = new Set(["home", "assistant", "agreement"]);

function Icon({ d, name, size = 16 }: { d: string; name?: string; size?: number }) {
  const filled = name && FILL_ICONS.has(name);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  home:       "M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z",
  assistant:  "M13 10V3L4 14h7v7l9-11h-7z",
  agreement:  "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z",
  invoice:    "M9 14l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  payroll:    "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z",
  time:       "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  expense:    "M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z",
  buyers:     "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  bell:       "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
  ai:         "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
  search:     "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  signout:    "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
  chevron:    "M19 9l-7 7-7-7",
};

const NAV_SECTIONS = [
  {
    label: "Operations",
    items: [
      { href: "/ceo",            label: "Overview",    icon: "home",      exact: true },
      { href: "/ceo/assistant",  label: "Assistant",   icon: "assistant" },
    ],
  },
  {
    label: "Documents",
    items: [
      { href: "/ceo/clients",    label: "Buyers",      icon: "buyers" },
      { href: "/ceo/agreements", label: "Agreements",  icon: "agreement" },
      { href: "/ceo/invoices",   label: "Invoices",    icon: "invoice" },
      { href: "/ceo/expenses",   label: "Expenses",    icon: "expense" },
    ],
  },
  {
    label: "People & Time",
    items: [
      { href: "/ceo/employees",  label: "Employees",   icon: "payroll" },
      { href: "/ceo/payroll",    label: "Payroll",     icon: "payroll" },
      { href: "/ceo/time",       label: "Time Tracker",icon: "time" },
    ],
  },
];

export function CeoShell({
  children,
  userName,
}: {
  children: React.ReactNode;
  userName?: string | null;
}) {
  const pathname = usePathname();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const openCmd = useCallback(() => setCmdOpen(true), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function toggleSection(label: string) {
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  return (
    <div className="min-h-screen flex">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside
        className="w-[220px] shrink-0 flex flex-col fixed top-0 left-0 h-screen z-30"
        style={{
          background: "#0a0c12",
          borderRight: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Brand — pure SVG, seamlessly embedded */}
        <div className="px-4 pt-5 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <Link href="/ceo" className="block">
            <BluRidgeLogo size={34} />
          </Link>
        </div>

        {/* Command search */}
        <button
          type="button"
          onClick={openCmd}
          className="mx-3 mt-3 flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--text-dim)",
            cursor: "pointer",
          }}
        >
          <Icon d={ICONS.search} name="search" size={13} />
          <span className="flex-1 text-left">Command Center…</span>
          <span className="cmd-shortcut"><kbd>⌘</kbd><kbd>K</kbd></span>
        </button>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {NAV_SECTIONS.map((section) => {
            const isCollapsed = collapsed[section.label];
            return (
              <div key={section.label} className="mb-1">
                {/* Section header */}
                <button
                  type="button"
                  onClick={() => toggleSection(section.label)}
                  className="w-full flex items-center justify-between px-3 py-1.5 mb-0.5 rounded"
                  style={{ cursor: "pointer", background: "transparent", border: "none" }}
                >
                  <span className="text-[0.6rem] tracking-[0.18em] uppercase font-semibold"
                    style={{ color: "var(--text-dim)" }}>
                    {section.label}
                  </span>
                  <motion.span
                    animate={{ rotate: isCollapsed ? -90 : 0 }}
                    transition={{ duration: 0.18 }}
                    style={{ color: "var(--text-dim)", display: "flex" }}
                  >
                    <Icon d={ICONS.chevron} name="chevron" size={10} />
                  </motion.span>
                </button>

                {/* Items */}
                <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      style={{ overflow: "hidden" }}
                    >
                      {section.items.map((item) => {
                        const active = item.exact
                          ? pathname === item.href
                          : pathname === item.href || pathname.startsWith(item.href + "/");
                        return (
                          <Link key={item.href} href={item.href} className="block relative mb-0.5">
                            {active && (
                              <motion.div
                                layoutId="nav-pill"
                                className="absolute inset-0 rounded-lg"
                                style={{ background: "rgba(99,102,241,0.1)", borderLeft: "2px solid var(--accent)" }}
                                transition={{ type: "spring", stiffness: 400, damping: 36 }}
                              />
                            )}
                            <span
                              className={cn(
                                "relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-[0.83rem] transition-colors duration-150",
                                active ? "font-medium" : "",
                              )}
                              style={{
                                color: active ? "rgba(255,255,255,0.9)" : "var(--text-muted)",
                              }}
                            >
                              <span style={{ color: active ? "var(--accent-bright)" : "var(--text-dim)", transition: "color 0.15s", flexShrink: 0 }}>
                                <Icon d={ICONS[item.icon as keyof typeof ICONS]} name={item.icon} size={15} />
                              </span>
                              {item.label}
                            </span>
                          </Link>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ background: "var(--accent-dim)", border: "1px solid rgba(99,102,241,0.3)", color: "var(--accent-bright)" }}
            >
              {(userName || "C").slice(0, 1).toUpperCase()}
            </div>
            <p className="text-xs truncate flex-1" style={{ color: "var(--text-muted)" }}>
              {userName}
            </p>
            <button
              type="button"
              title="Sign out"
              className="transition-colors"
              style={{ color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", display: "flex" }}
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <Icon d={ICONS.signout} name="signout" size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 pl-[220px]">
        {/* Top bar */}
        <div
          className="sticky top-0 z-20 px-8 h-14 flex items-center justify-between gap-4"
          style={{
            background: "rgba(10,12,18,0.9)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          {/* Breadcrumb */}
          <BreadCrumb pathname={pathname} />

          {/* Right controls */}
          <div className="flex items-center gap-3">
            {/* Clock */}
            <LiveClock />

            {/* Divider */}
            <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.07)" }} />

            {/* AI Assistant */}
            <Link
              href="/ceo/assistant"
              title="AI Assistant"
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
              style={{
                background: "rgba(99,102,241,0.08)",
                border: "1px solid rgba(99,102,241,0.2)",
                color: "var(--accent-bright)",
              }}
            >
              <Icon d={ICONS.ai} name="ai" size={15} />
            </Link>

            {/* Notifications */}
            <button
              type="button"
              title="Notifications"
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-all relative"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              <Icon d={ICONS.bell} name="bell" size={15} />
              {/* Dot */}
              <span
                className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--accent)" }}
              />
            </button>

            {/* Command */}
            <button
              type="button"
              onClick={openCmd}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "var(--text-dim)",
                cursor: "pointer",
              }}
            >
              <Icon d={ICONS.search} name="search" size={12} />
              <span className="cmd-shortcut"><kbd>⌘</kbd><kbd>K</kbd></span>
            </button>
          </div>
        </div>

        {/* Page content */}
        <div className="px-8 py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Command Bar */}
      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}

function BreadCrumb({ pathname }: { pathname: string }) {
  const segments = pathname.replace("/ceo", "").split("/").filter(Boolean);
  return (
    <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
      <Link href="/ceo"
        className="text-[0.7rem] tracking-[0.15em] uppercase font-semibold transition-colors hover:text-foreground"
        style={{ color: "var(--text-dim)" }}>
        BluRidge
      </Link>
      {segments.map((seg, i) => (
        <span key={i} className="flex items-center gap-2">
          <span style={{ color: "var(--text-dim)", fontSize: "0.75rem" }}>›</span>
          <span
            style={{ color: i === segments.length - 1 ? "var(--text)" : "var(--text-muted)" }}
            className="capitalize text-sm"
          >
            {seg}
          </span>
        </span>
      ))}
    </div>
  );
}
