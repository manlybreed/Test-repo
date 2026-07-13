"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BuyerForm, type ClientEditSeed } from "@/components/buyer-form";
import { deleteClient } from "@/actions/clients";
import { ConfirmDeleteDialog } from "@/components/confirm-dialogs";

type ClientRow = ClientEditSeed & {
  agreementCount: number;
  invoiceCount?: number;
  agreements: Array<{
    id: string;
    status: string;
    effectiveDate: Date | string;
    filePath: string | null;
    spvName: string | null;
  }>;
};

function agreementHref(clientId: string) {
  return `/ceo/agreements?clientId=${encodeURIComponent(clientId)}`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatDate(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ClientsWorkspace({ clients }: { clients: ClientRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ClientEditSeed | null>(null);
  const [deleting, setDeleting] = useState<ClientRow | null>(null);
  const [justCreated, setJustCreated] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => {
      const hay = [
        c.name,
        c.pocName,
        c.phone,
        c.gstin,
        c.pan,
        c.city,
        c.state,
        c.email,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [clients, query]);

  const withPoc = clients.filter((c) => c.pocName || c.phone).length;
  const withAgreements = clients.filter((c) => c.agreementCount > 0).length;

  function openAdd() {
    setEditing(null);
    setJustCreated(null);
    setShowForm(true);
  }

  function openEdit(c: ClientRow) {
    setJustCreated(null);
    setEditing(c);
    setShowForm(true);
  }

  function closeForm() {
    setEditing(null);
    setShowForm(false);
  }

  function confirmDelete() {
    if (!deleting) return;
    setError("");
    start(async () => {
      try {
        await deleteClient(deleting.id);
        if (editing?.id === deleting.id) closeForm();
        setDeleting(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed");
        setDeleting(null);
      }
    });
  }

  return (
    <div className="space-y-6 mb-10">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "In database", value: clients.length, tone: "#a5b4fc" },
          { label: "With PoC", value: withPoc, tone: "#6ee7b7" },
          { label: "With agreements", value: withAgreements, tone: "#fcd34d" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl px-4 py-3"
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
            }}
          >
            <p
              className="text-[0.6rem] uppercase tracking-[0.16em] font-semibold mb-1"
              style={{ color: "var(--text-dim)" }}
            >
              {s.label}
            </p>
            <p
              className="text-2xl font-bold tabular-nums tracking-tight"
              style={{ color: s.tone }}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ color: "var(--text-dim)" }}
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            className="input w-full"
            style={{ paddingLeft: "2.5rem" }}
            placeholder="Search name, PoC, GSTIN, city…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary text-sm shrink-0"
          onClick={() => {
            if (showForm && !editing) {
              closeForm();
            } else {
              openAdd();
            }
          }}
        >
          {showForm && !editing ? "Close form" : "+ Add client"}
        </button>
      </div>

      {/* Add / edit form */}
      {showForm && (
        <section
          className="rounded-2xl p-5 sm:p-6"
          style={{
            background: "var(--bg-panel)",
            border: editing
              ? "1px solid rgba(129,140,248,0.35)"
              : "1px solid var(--border)",
            boxShadow: editing
              ? "0 0 0 1px rgba(99,102,241,0.12)"
              : undefined,
          }}
        >
          <div className="flex items-start justify-between gap-3 mb-5">
            <div>
              <h2 className="text-base font-semibold">
                {editing ? "Edit client" : "Add client"}
              </h2>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {editing
                  ? "Update company and PoC details, then save."
                  : "Upload KYC docs for AI fill, or enter details manually."}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost text-xs py-1.5"
              onClick={closeForm}
            >
              Cancel
            </button>
          </div>
          <BuyerForm
            key={editing?.id ?? "new"}
            editing={editing}
            onCancelEdit={closeForm}
            onCreated={(client) => {
              if (!editing) {
                setJustCreated({ id: client.id, name: client.name });
              }
              setEditing(null);
              setShowForm(false);
              router.refresh();
            }}
          />
          {justCreated && !editing && !showForm && null}
        </section>
      )}

      {justCreated && !showForm && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl text-sm"
          style={{
            background: "rgba(16,185,129,0.08)",
            border: "1px solid rgba(16,185,129,0.25)",
          }}
        >
          <p style={{ color: "#6ee7b7" }}>
            <span className="font-semibold">{justCreated.name}</span> added to the
            database
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs underline"
              style={{ color: "var(--text-muted)" }}
              onClick={() => setJustCreated(null)}
            >
              Dismiss
            </button>
            <Link
              href={agreementHref(justCreated.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{
                background: "rgba(16,185,129,0.15)",
                border: "1px solid rgba(52,211,153,0.35)",
                color: "#6ee7b7",
              }}
            >
              Create agreement →
            </Link>
          </div>
        </div>
      )}

      {/* Client's database */}
      <section
        className="rounded-2xl overflow-hidden"
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
        }}
      >
        <div
          className="flex items-center justify-between gap-3 px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 className="text-base font-semibold truncate">
              Client&apos;s database
            </h2>
            <span
              className="text-[0.7rem] px-2 py-0.5 rounded-md tabular-nums font-semibold shrink-0"
              style={{
                background: "rgba(99,102,241,0.12)",
                color: "#a5b4fc",
              }}
            >
              {filtered.length}
              {query.trim() ? ` / ${clients.length}` : ""}
            </span>
          </div>
        </div>

        {error && (
          <p
            className="text-xs px-5 py-3"
            style={{
              color: "#f87171",
              borderBottom: "1px solid rgba(239,68,68,0.2)",
              background: "rgba(239,68,68,0.06)",
            }}
          >
            {error}
          </p>
        )}

        {clients.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-sm font-medium mb-1">No clients yet</p>
            <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
              Add your first company to start creating agreements.
            </p>
            <button type="button" className="btn btn-primary text-sm" onClick={openAdd}>
              + Add client
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No matches for “{query.trim()}”
            </p>
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {filtered.map((c) => (
              <ClientRowItem
                key={c.id}
                client={c}
                active={editing?.id === c.id && showForm}
                pending={pending}
                onEdit={() => openEdit(c)}
                onDelete={() => setDeleting(c)}
              />
            ))}
          </ul>
        )}
      </section>

      <ConfirmDeleteDialog
        open={!!deleting}
        title="Delete client"
        itemLabel={deleting?.name}
        description={
          deleting &&
          (deleting.agreementCount > 0 || (deleting.invoiceCount ?? 0) > 0)
            ? `This client has ${deleting.agreementCount} agreement(s) and ${deleting.invoiceCount ?? 0} invoice(s). Delete will be blocked until those are removed.`
            : "Company and PoC master data will be removed."
        }
        pending={pending}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function ClientRowItem({
  client: c,
  active,
  pending,
  onEdit,
  onDelete,
}: {
  client: ClientRow;
  active: boolean;
  pending: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hasAgreements = c.agreementCount > 0;
  const location = [c.city, c.state].filter(Boolean).join(", ");
  const hasPoc = Boolean(c.pocName || c.phone);

  return (
    <li
      className="px-5 py-4 transition-colors"
      style={{
        background: active ? "rgba(99,102,241,0.06)" : undefined,
      }}
    >
      <div className="flex gap-3 sm:gap-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold tracking-wide"
          style={{
            background: active
              ? "rgba(99,102,241,0.25)"
              : "rgba(255,255,255,0.05)",
            color: active ? "#c7d2fe" : "#94a3b8",
            border: "1px solid var(--border)",
          }}
          aria-hidden
        >
          {initials(c.name)}
        </div>

        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-snug truncate">
                {c.name}
              </p>
              <div
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                {location && <span>{location}</span>}
                {location && (c.gstin || c.pan) && (
                  <span style={{ color: "var(--text-dim)" }}>·</span>
                )}
                {(c.gstin || c.pan) && (
                  <span className="font-mono tabular-nums text-[0.7rem]">
                    {[c.gstin, c.pan].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                className="text-[0.7rem] font-semibold px-2.5 py-1.5 rounded-lg"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--border-strong)",
                  color: "var(--text)",
                }}
                disabled={pending}
                onClick={onEdit}
              >
                Edit
              </button>
              <button
                type="button"
                className="text-[0.7rem] font-semibold px-2.5 py-1.5 rounded-lg"
                style={{
                  background: "transparent",
                  border: "1px solid rgba(239,68,68,0.22)",
                  color: "#f87171",
                }}
                disabled={pending}
                onClick={onDelete}
              >
                Delete
              </button>
              <Link
                href={agreementHref(c.id)}
                className="inline-flex items-center text-[0.7rem] font-semibold px-2.5 py-1.5 rounded-lg"
                style={{
                  background: hasAgreements
                    ? "rgba(255,255,255,0.04)"
                    : "rgba(16,185,129,0.12)",
                  border: `1px solid ${
                    hasAgreements
                      ? "var(--border-strong)"
                      : "rgba(52,211,153,0.35)"
                  }`,
                  color: hasAgreements ? "var(--text)" : "#6ee7b7",
                }}
              >
                {hasAgreements ? "New agreement" : "Create agreement"}
              </Link>
            </div>
          </div>

          {/* PoC — always visible */}
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-xs"
            style={{
              background: hasPoc
                ? "rgba(255,255,255,0.03)"
                : "rgba(245,158,11,0.06)",
              border: `1px solid ${
                hasPoc ? "var(--border)" : "rgba(245,158,11,0.22)"
              }`,
            }}
          >
            <span
              className="uppercase tracking-[0.12em] font-semibold text-[0.58rem]"
              style={{ color: "var(--text-dim)" }}
            >
              PoC
            </span>
            {hasPoc ? (
              <>
                <span className="font-medium" style={{ color: "var(--text)" }}>
                  {c.pocName || "—"}
                </span>
                {c.phone && (
                  <a
                    href={`tel:${c.phone.replace(/\s/g, "")}`}
                    className="tabular-nums"
                    style={{ color: "#a5b4fc" }}
                  >
                    {c.phone}
                  </a>
                )}
              </>
            ) : (
              <button
                type="button"
                className="underline"
                style={{ color: "#fcd34d" }}
                onClick={onEdit}
              >
                Add PoC name & contact
              </button>
            )}
          </div>

          {hasAgreements && (
            <div className="flex flex-wrap items-center gap-2 text-[0.7rem]">
              <span
                className="font-semibold"
                style={{ color: "var(--text-muted)" }}
              >
                {c.agreementCount} agreement
                {c.agreementCount === 1 ? "" : "s"}
              </span>
              {c.agreements.slice(0, 2).map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--border)",
                    color: "var(--text-muted)",
                  }}
                >
                  <span
                    style={{
                      color: a.status === "FINAL" ? "#6ee7b7" : "#fbbf24",
                    }}
                  >
                    {a.status}
                  </span>
                  <span>{formatDate(a.effectiveDate)}</span>
                  {a.filePath && (
                    <a
                      href={`/api/files/${a.filePath
                        .split("/")
                        .map(encodeURIComponent)
                        .join("/")}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#a5b4fc" }}
                    >
                      DOCX
                    </a>
                  )}
                </span>
              ))}
              {c.agreementCount > 2 && (
                <span style={{ color: "var(--text-dim)" }}>
                  +{c.agreementCount - 2} more
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
