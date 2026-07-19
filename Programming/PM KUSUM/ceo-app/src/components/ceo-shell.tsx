"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useState, useEffect, useCallback, type MouseEvent } from "react";
import { CommandBar } from "./command-bar";
import { BluRidgeLogo } from "./bluridge-logo";
import { LiveClock } from "./live-clock";

// ── SVG Icons ────────────────────────────────────────────────────────
const FILL_ICONS = new Set(["home", "assistant", "agreement"]);

function Icon({
  d,
  name,
  size = 16,
}: {
  d: string | readonly string[];
  name?: string;
  size?: number;
}) {
  const filled = name && FILL_ICONS.has(name);
  const paths = Array.isArray(d) ? d : [d];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths.map((path) => (
        <path key={path} d={path} />
      ))}
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
  projects:   "M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6",
  bell:       "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
  ai:         "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
  // Inbox tray — clearer at 15px than a flat envelope
  mail: [
    "M22 12h-6l-2 3h-4l-2-3H2",
    "M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z",
  ] as const,
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
      { href: "/ceo/mail",       label: "Mail",        icon: "mail" },
    ],
  },
  {
    label: "Documents",
    items: [
      { href: "/ceo/clients",    label: "Clients",     icon: "buyers" },
      { href: "/ceo/projects",   label: "PM KUSUM Projects", icon: "projects" },
      { href: "/ceo/financing",  label: "PM KUSUM Financing", icon: "invoice" },
      { href: "/ceo/agreements", label: "Agreements",  icon: "agreement", ownerOnly: true },
      { href: "/ceo/invoices",   label: "Invoices",    icon: "invoice" },
      { href: "/ceo/ledgers",    label: "Ledgers",     icon: "invoice" },
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
  canAccessAgreements = false,
}: {
  children: React.ReactNode;
  userName?: string | null;
  canAccessAgreements?: boolean;
}) {
  const pathname = usePathname();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [hoverTip, setHoverTip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);

  function showCollapsedTip(e: MouseEvent<HTMLElement>, text: string) {
    if (!navCollapsed) return;
    const r = e.currentTarget.getBoundingClientRect();
    setHoverTip({
      text,
      x: r.right + 10,
      y: r.top + r.height / 2,
    });
  }

  function hideCollapsedTip() {
    setHoverTip(null);
  }

  const openCmd = useCallback(() => setCmdOpen(true), []);

  useEffect(() => {
    try {
      setNavCollapsed(localStorage.getItem("br-nav-collapsed") === "1");
    } catch {
      /* ignore */
    }
  }, []);

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

  function toggleNavCollapsed() {
    setHoverTip(null);
    setNavCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("br-nav-collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const sidebarW = navCollapsed ? 72 : 220;

  return (
    <div className="min-h-screen flex">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside
        className="shrink-0 flex flex-col fixed top-0 left-0 h-screen z-30 transition-[width] duration-200"
        style={{
          width: sidebarW,
          background: "var(--bg-sidebar)",
          borderRight: "1px solid var(--border)",
        }}
      >
        {/* Brand — pure SVG, seamlessly embedded */}
        <div
          className={`flex items-center gap-2 pt-5 pb-4 ${navCollapsed ? "px-2 justify-center" : "px-4"}`}
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <Link href="/ceo" className="block min-w-0">
            {navCollapsed ? (
              <BluRidgeLogo size={28} markOnly />
            ) : (
              <BluRidgeLogo size={34} />
            )}
          </Link>
          {!navCollapsed && (
            <button
              type="button"
              title="Collapse sidebar"
              onClick={toggleNavCollapsed}
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
              style={{
                color: "var(--text-dim)",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--border)",
                cursor: "pointer",
              }}
            >
              <Icon d="M15 19l-7-7 7-7" name="chevron" size={14} />
            </button>
          )}
        </div>

        {/* Command search */}
        <button
          type="button"
          onClick={openCmd}
          title="Command Center"
          aria-label="Command Center"
          onMouseEnter={(e) => showCollapsedTip(e, "Command Center")}
          onMouseLeave={hideCollapsedTip}
          className={
            navCollapsed
              ? "mt-3 mx-2 flex items-center justify-center gap-2.5 rounded-lg px-2 py-2.5 text-xs transition-all"
              : "mt-3 mx-3 flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition-all"
          }
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--text-dim)",
            cursor: "pointer",
          }}
        >
          <Icon d={ICONS.search} name="search" size={13} />
          {!navCollapsed && (
            <>
              <span className="flex-1 text-left">Command Center…</span>
              <span className="cmd-shortcut"><kbd>⌘</kbd><kbd>K</kbd></span>
            </>
          )}
        </button>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {NAV_SECTIONS.map((section) => {
            const isCollapsed = collapsed[section.label];
            return (
              <div key={section.label} className="mb-1">
                {/* Section header */}
                {!navCollapsed && (
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
                )}

                {/* Items */}
                <AnimatePresence initial={false}>
                  {(navCollapsed || !isCollapsed) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      style={{ overflow: "hidden" }}
                    >
                      {section.items
                        .filter(
                          (item) =>
                            !("ownerOnly" in item && item.ownerOnly) ||
                            canAccessAgreements,
                        )
                        .map((item) => {
                        const active =
                          "exact" in item && item.exact
                            ? pathname === item.href
                            : pathname === item.href ||
                              pathname.startsWith(item.href + "/");
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            title={item.label}
                            aria-label={item.label}
                            onMouseEnter={(e) => showCollapsedTip(e, item.label)}
                            onMouseLeave={hideCollapsedTip}
                            className="relative mb-0.5 block"
                          >
                            {active && (
                              <motion.div
                                layoutId="nav-pill"
                                className="absolute inset-0 rounded-xl"
                                style={{
                                  background: "var(--grad-cta-soft)",
                                  boxShadow: "0 4px 18px rgba(139,92,246,0.18)",
                                }}
                                transition={{ type: "spring", stiffness: 400, damping: 36 }}
                              />
                            )}
                            <span
                              className={cn(
                                "relative flex items-center rounded-xl text-[0.83rem] transition-colors duration-150",
                                navCollapsed
                                  ? "justify-center px-2 py-2.5"
                                  : "gap-3 px-3 py-2.5",
                                active ? "font-medium" : "",
                              )}
                              style={{
                                color: active ? "#fff" : "var(--text-muted)",
                              }}
                            >
                              <span style={{ color: active ? "#fff" : "var(--text-dim)", transition: "color 0.15s", flexShrink: 0 }}>
                                <Icon d={ICONS[item.icon as keyof typeof ICONS]} name={item.icon} size={15} />
                              </span>
                              {!navCollapsed && item.label}
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
        <div className={`py-3 ${navCollapsed ? "px-2" : "px-3"}`} style={{ borderTop: "1px solid var(--border)" }}>
          {navCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                aria-label="Expand sidebar"
                onClick={toggleNavCollapsed}
                onMouseEnter={(e) => showCollapsedTip(e, "Expand sidebar")}
                onMouseLeave={hideCollapsedTip}
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{
                  color: "var(--text-muted)",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                }}
              >
                <Icon d="M9 5l7 7-7 7" name="chevron" size={14} />
              </button>
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
                style={{
                  background: "var(--accent-dim)",
                  border: "1px solid rgba(139,92,246,0.35)",
                  color: "var(--accent-bright)",
                }}
                aria-label={userName || "User"}
                onMouseEnter={(e) => showCollapsedTip(e, userName || "User")}
                onMouseLeave={hideCollapsedTip}
              >
                {(userName || "C").slice(0, 1).toUpperCase()}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{
                  background: "var(--accent-dim)",
                  border: "1px solid rgba(139,92,246,0.35)",
                  color: "var(--accent-bright)",
                }}
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
          )}
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────── */}
      <main
        className="flex-1 min-w-0 transition-[padding] duration-200"
        style={{ paddingLeft: sidebarW }}
      >
        {/* Top bar */}
        <div
          className="sticky top-0 z-20 px-8 h-14 flex items-center justify-between gap-4"
          style={{
            background: "rgba(7,7,8,0.88)",
            borderBottom: "1px solid var(--border)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          <div className="flex min-w-0 items-center gap-3">
            {navCollapsed && (
              <button
                type="button"
                title="Expand sidebar"
                onClick={toggleNavCollapsed}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{
                  color: "var(--text-muted)",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                }}
              >
                <Icon d="M9 5l7 7-7 7" name="chevron" size={14} />
              </button>
            )}
            <BreadCrumb pathname={pathname} />
          </div>

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
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
              style={{
                background: "var(--accent-dim)",
                border: "1px solid rgba(139,92,246,0.3)",
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

        {/* Page content — min-w-0 so wide tables can scroll inside main */}
        <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8 min-w-0 max-w-full">
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              className="min-w-0 max-w-full"
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

      {hoverTip && navCollapsed && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[80] -translate-y-1/2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium shadow-lg"
          style={{
            left: hoverTip.x,
            top: hoverTip.y,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            color: "var(--text)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          }}
        >
          {hoverTip.text}
        </div>
      )}
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
