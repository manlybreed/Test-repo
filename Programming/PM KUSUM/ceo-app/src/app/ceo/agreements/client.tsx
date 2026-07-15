"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AgreementForm,
  type AgreementEditSeed,
} from "@/components/agreement-form";
import {
  AgreementLibrary,
  type AgreementListItem,
} from "@/components/agreement-library";
import { AgreementUploadCreate } from "@/components/agreement-upload-create";
import { formatINR } from "@/lib/utils";

type ClientOption = {
  id: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  gstin: string | null;
  pan: string | null;
  phone: string | null;
  pocName: string | null;
  email: string | null;
  agreementCount: number;
};

export function AgreementsWorkspace({
  clients,
  agreements,
  initialClientId,
  createdId,
}: {
  clients: ClientOption[];
  agreements: AgreementListItem[];
  initialClientId?: string;
  createdId?: string;
}) {
  const [editing, setEditing] = useState<AgreementEditSeed | null>(null);
  const [mode, setMode] = useState<"generate" | "upload">("generate");

  const totalTokenFees = agreements.reduce(
    (s, a) => s + a.tokenFeePerPlant * a.plantCount,
    0,
  );
  const finalCount = agreements.filter((a) => a.status === "FINAL").length;
  const draftCount = agreements.filter((a) => a.status === "DRAFT").length;

  const preselected = initialClientId
    ? clients.find((c) => c.id === initialClientId)
    : null;
  const clientAgreements = initialClientId
    ? agreements.filter((a) => a.clientId === initialClientId)
    : [];

  const showUpload = !editing && mode === "upload";

  return (
    <div>
      <header className="mb-8">
        <p
          className="text-[0.6rem] tracking-[0.26em] uppercase mb-2 font-semibold"
          style={{ color: "var(--text-dim)" }}
        >
          Module · Agreements
        </p>
        <h1 className="text-[2.2rem] font-bold tracking-tight leading-none mb-3">
          <span className="grad-text">PM KUSUM Agreements</span>
        </h1>
        <p className="text-sm max-w-xl" style={{ color: "var(--text-muted)" }}>
          Generate from the BluRidge template, or upload an existing signed
          agreement — then edit, replace, or delete from the library.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          {
            label: "Total",
            value: agreements.length,
            color: "#818cf8",
            bg: "rgba(99,102,241,0.1)",
          },
          {
            label: "Final",
            value: finalCount,
            color: "#34d399",
            bg: "rgba(16,185,129,0.1)",
          },
          {
            label: "Draft",
            value: draftCount,
            color: "#fbbf24",
            bg: "rgba(245,158,11,0.1)",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="relative overflow-hidden rounded-xl p-4"
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
            }}
          >
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `radial-gradient(ellipse 80% 80% at 0% 0%, ${s.bg} 0%, transparent 65%)`,
              }}
            />
            <p
              className="relative text-[0.6rem] tracking-[0.15em] uppercase font-semibold mb-2"
              style={{ color: "var(--text-dim)" }}
            >
              {s.label}
            </p>
            <p
              className="relative text-3xl font-bold tabular-nums"
              style={{ color: s.color }}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {createdId && (
        <div
          className="flex items-center justify-between px-4 py-3 rounded-xl mb-6 text-sm"
          style={{
            background: "rgba(16,185,129,0.08)",
            border: "1px solid rgba(16,185,129,0.25)",
            color: "#34d399",
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-base">✓</span>
            Agreement saved — find it in the library below.
          </div>
        </div>
      )}

      {preselected && clientAgreements.length > 0 && !createdId && !editing && (
        <div
          className="rounded-xl px-4 py-3 mb-6 text-sm space-y-2"
          style={{
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.28)",
            color: "#fcd34d",
          }}
        >
          <p className="font-semibold">
            {preselected.name} already has {clientAgreements.length} agreement
            {clientAgreements.length === 1 ? "" : "s"}
          </p>
          <ul
            className="text-xs space-y-1"
            style={{ color: "rgba(253,230,138,0.9)" }}
          >
            {clientAgreements.slice(0, 5).map((a) => {
              const date =
                typeof a.effectiveDate === "string"
                  ? new Date(a.effectiveDate)
                  : a.effectiveDate;
              return (
                <li key={a.id} className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`badge ${
                      a.status === "FINAL" ? "badge-final" : "badge-draft"
                    }`}
                  >
                    {a.status}
                  </span>
                  <span>
                    {a.spvName || "—"} · {date.toLocaleDateString("en-IN")}
                  </span>
                  {a.filePath && (
                    <Link
                      href={`/api/files/${a.filePath}`}
                      target="_blank"
                      className="underline"
                      style={{ color: "#a5b4fc" }}
                    >
                      Open file
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-xs" style={{ color: "rgba(253,230,138,0.75)" }}>
            You can still create or upload another below — prior agreements are
            not replaced.
          </p>
        </div>
      )}

      <section
        className="relative overflow-hidden rounded-xl mb-8"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 50% 60% at 0% 0%, rgba(99,102,241,0.07) 0%, transparent 55%)",
          }}
        />
        <div className="relative p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-semibold">
                  {editing
                    ? "Edit agreement"
                    : showUpload
                      ? "Upload agreement"
                      : preselected && clientAgreements.length > 0
                        ? "Create another agreement"
                        : "New Agreement"}
                </h2>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
                  {editing
                    ? "Changes regenerate a new DOCX version"
                    : showUpload
                      ? "Use an existing signed PDF or Word file"
                      : "Generate DOCX from the BluRidge template"}
                </p>
              </div>
            </div>

            {!editing && (
              <div
                className="flex gap-1 p-1 rounded-xl w-fit"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {(
                  [
                    { id: "generate" as const, label: "Generate" },
                    { id: "upload" as const, label: "Upload" },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-all"
                    style={{
                      background:
                        mode === m.id ? "rgba(99,102,241,0.18)" : "transparent",
                      color:
                        mode === m.id ? "#a5b4fc" : "rgba(255,255,255,0.45)",
                      border:
                        mode === m.id
                          ? "1px solid rgba(99,102,241,0.35)"
                          : "1px solid transparent",
                    }}
                    onClick={() => setMode(m.id)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {editing || mode === "generate" ? (
            <AgreementForm
              key={editing?.id ?? `gen-${initialClientId ?? "new"}`}
              clients={clients}
              initialClientId={editing ? undefined : initialClientId}
              editing={editing}
              onCancelEdit={() => setEditing(null)}
            />
          ) : (
            <AgreementUploadCreate
              key={`upload-${initialClientId ?? "new"}`}
              clients={clients}
              initialClientId={initialClientId}
            />
          )}
        </div>
      </section>

      <AgreementLibrary
        agreements={agreements}
        totalTokenFees={totalTokenFees}
        onEdit={(seed) => {
          setEditing(seed);
          setMode("generate");
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      {totalTokenFees > 0 && (
        <p className="sr-only">{formatINR(totalTokenFees)}</p>
      )}
    </div>
  );
}
