"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAgreementFromUpload } from "@/actions/agreements";
import { BuyerForm } from "@/components/buyer-form";

type ClientOption = {
  id: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  gstin: string | null;
  pan: string | null;
  phone?: string | null;
  pocName?: string | null;
  email?: string | null;
};

export function AgreementUploadCreate({
  clients: initialClients,
  initialClientId,
}: {
  clients: ClientOption[];
  initialClientId?: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [clients, setClients] = useState(initialClients);
  const [clientId, setClientId] = useState(initialClientId || "");
  const [clientName, setClientName] = useState(() => {
    const c = initialClients.find((x) => x.id === initialClientId);
    return c?.name || "";
  });
  const [spvName, setSpvName] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [status, setStatus] = useState<"DRAFT" | "FINAL">("FINAL");
  const [fileName, setFileName] = useState("");
  const [showNewClient, setShowNewClient] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const selected = useMemo(
    () => clients.find((c) => c.id === clientId) || null,
    [clients, clientId],
  );

  function onClientChange(id: string) {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (c) setClientName(c.name);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const file = fileRef.current?.files?.[0];
    if (!clientName.trim()) {
      setError("Client name is required");
      return;
    }
    if (!file) {
      setError("Choose a PDF or Word agreement file");
      return;
    }
    start(async () => {
      try {
        const fd = new FormData();
        if (clientId) fd.set("clientId", clientId);
        fd.set("clientName", clientName.trim());
        fd.set("spvName", spvName);
        fd.set("effectiveDate", effectiveDate);
        fd.set("status", status);
        fd.set("file", file);
        const res = await createAgreementFromUpload(fd);
        router.push(`/ceo/agreements?created=${res.id}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Attach an already signed or external agreement. No template generation —
        the uploaded file becomes the library document.
      </p>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label className="label !mb-0">Saved client</label>
            <button
              type="button"
              className="text-[0.7rem] font-semibold underline"
              style={{ color: "#a5b4fc" }}
              onClick={() => setShowNewClient((v) => !v)}
            >
              {showNewClient ? "Cancel" : "+ Add new client"}
            </button>
          </div>
          <select
            className="input"
            value={clientId}
            disabled={showNewClient}
            onChange={(e) => onClientChange(e.target.value)}
          >
            <option value="">— Manual entry —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Effective date</label>
          <input
            className="input"
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
        </div>
      </div>

      {showNewClient && (
        <div
          className="rounded-xl p-4"
          style={{
            background: "rgba(99,102,241,0.06)",
            border: "1px solid rgba(99,102,241,0.2)",
          }}
        >
          <p className="text-sm font-semibold mb-3">Add new client</p>
          <BuyerForm
            embedded
            onCreated={(client) => {
              setClients((prev) => {
                if (prev.some((c) => c.id === client.id)) return prev;
                return [...prev, client].sort((a, b) =>
                  a.name.localeCompare(b.name),
                );
              });
              setClientId(client.id);
              setClientName(client.name);
              setShowNewClient(false);
            }}
          />
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">
            Client / company legal name{" "}
            <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <input
            className="input"
            required
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Legal name on the agreement"
          />
        </div>
        <div>
          <label className="label">SPV / project entity</label>
          <input
            className="input"
            value={spvName}
            onChange={(e) => setSpvName(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div>
          <label className="label">Status</label>
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as "DRAFT" | "FINAL")}
          >
            <option value="FINAL">Final</option>
            <option value="DRAFT">Draft</option>
          </select>
        </div>
        <div>
          <label className="label">
            Agreement file <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="input py-2"
            onChange={(e) => setFileName(e.target.files?.[0]?.name || "")}
          />
          {fileName && (
            <p className="text-[0.7rem] mt-1" style={{ color: "var(--text-muted)" }}>
              Selected: {fileName}
            </p>
          )}
        </div>
      </div>

      {selected?.pocName && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          PoC on file:{" "}
          <span className="font-medium" style={{ color: "var(--text)" }}>
            {selected.pocName}
          </span>
          {selected.phone ? ` · ${selected.phone}` : ""}
        </p>
      )}

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Uploading…" : "Upload agreement"}
        </button>
      </div>
    </form>
  );
}
