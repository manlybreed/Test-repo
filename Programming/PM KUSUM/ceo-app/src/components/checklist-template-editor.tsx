"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  createDocCatalogItem,
  deleteDocCatalogItem,
  listDocCatalog,
  syncCatalogToAllPlants,
  updateDocCatalogItem,
} from "@/actions/plant-registry";
import { PLANT_SUBFOLDERS } from "@/lib/projects/doc-catalog";

type CatalogRow = Awaited<ReturnType<typeof listDocCatalog>>[number];

const GROUPS = [
  "SPV",
  "DIRECTORS",
  "PLANT",
  "LAND",
  "DPR",
  "EPC",
  "THIRD_PARTY",
  "MISC",
] as const;

const GROUP_STYLE: Record<string, { bg: string; fg: string }> = {
  SPV: { bg: "#0f766e", fg: "#ecfdf5" },
  DIRECTORS: { bg: "#475569", fg: "#f8fafc" },
  PLANT: { bg: "#92400e", fg: "#fffbeb" },
  LAND: { bg: "#b45309", fg: "#fffbeb" },
  DPR: { bg: "#4338ca", fg: "#eef2ff" },
  EPC: { bg: "#9d174d", fg: "#fdf2f8" },
  THIRD_PARTY: { bg: "#0e7490", fg: "#ecfeff" },
  MISC: { bg: "#525252", fg: "#fafafa" },
};

export function ChecklistTemplateEditor({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState({
    docGroup: "SPV",
    label: "",
    description: "",
    folderHint: "SPV KYC",
    scope: "PLANT" as "PLANT" | "PARTY",
    required: true,
  });

  const reload = useCallback(() => {
    start(async () => {
      try {
        setError("");
        setRows(await listDocCatalog());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load template");
      }
    });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const grouped = useMemo(() => {
    const map = new Map<string, CatalogRow[]>();
    for (const r of rows) {
      const list = map.get(r.docGroup) ?? [];
      list.push(r);
      map.set(r.docGroup, list);
    }
    return [...map.entries()];
  }, [rows]);

  function patchLocal(id: string, patch: Partial<CatalogRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function saveField(id: string, patch: Partial<CatalogRow>) {
    patchLocal(id, patch);
    start(async () => {
      try {
        await updateDocCatalogItem(id, {
          docGroup: patch.docGroup,
          label: patch.label,
          description: patch.description ?? undefined,
          scope: patch.scope,
          required: patch.required,
          folderHint: patch.folderHint,
          matchHints: patch.matchHints,
          sortOrder: patch.sortOrder,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
        reload();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[70]"
        style={{ background: "rgba(0,0,0,0.55)" }}
        aria-label="Close template editor"
        onClick={onClose}
      />
      <aside
        className="fixed inset-y-0 right-0 z-[80] w-full max-w-4xl flex flex-col shadow-2xl"
        style={{
          background: "var(--bg-panel, #181c27)",
          borderLeft: "1px solid rgba(255,255,255,0.12)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Checklist template"
      >
        <header
          className="shrink-0 px-5 py-4 flex flex-wrap items-start justify-between gap-3"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}
        >
          <div>
            <p
              className="text-[0.7rem] uppercase tracking-[0.14em] font-semibold mb-1"
              style={{ color: "var(--text-muted)" }}
            >
              Default template
            </p>
            <h2 className="text-xl font-semibold" style={{ color: "var(--text)" }}>
              Checklist template
            </h2>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              Edits apply to new plants. Sync pushes new rows to existing plants.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-40"
              style={{
                background: "rgba(99,102,241,0.2)",
                border: "1px solid rgba(99,102,241,0.45)",
                color: "#e0e7ff",
              }}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  try {
                    const r = await syncCatalogToAllPlants();
                    setMsg(`Synced template to ${r.plants} plant(s)`);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Sync failed");
                  }
                })
              }
            >
              Sync to all plants
            </button>
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{
                border: "1px solid rgba(255,255,255,0.14)",
                color: "var(--text-muted)",
              }}
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && (
            <p
              className="text-xs px-3 py-2 rounded-lg"
              style={{ color: "#fecaca", background: "rgba(239,68,68,0.12)" }}
            >
              {error}
            </p>
          )}
          {msg && (
            <p
              className="text-xs px-3 py-2 rounded-lg"
              style={{ color: "#6ee7b7", background: "rgba(16,185,129,0.12)" }}
            >
              {msg}
            </p>
          )}

          <div
            className="rounded-xl p-4 space-y-3"
            style={{
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <p className="text-sm font-semibold">Add document type</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Group</label>
                <select
                  className="input"
                  value={draft.docGroup}
                  onChange={(e) => {
                    const docGroup = e.target.value;
                    const folder =
                      PLANT_SUBFOLDERS.find((f) =>
                        f.toUpperCase().includes(docGroup.split("_")[0]),
                      ) || draft.folderHint;
                    setDraft((d) => ({
                      ...d,
                      docGroup,
                      scope: docGroup === "DIRECTORS" ? "PARTY" : "PLANT",
                      folderHint:
                        docGroup === "DIRECTORS"
                          ? "Directors KYC"
                          : docGroup === "SPV"
                            ? "SPV KYC"
                            : docGroup === "PLANT"
                              ? "Plant KYC"
                              : docGroup === "LAND"
                                ? "Land KYC"
                                : docGroup === "DPR"
                                  ? "DPR From EPC"
                                  : docGroup === "THIRD_PARTY"
                                    ? "Third Party Reports"
                                    : folder,
                    }));
                  }}
                >
                  {GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Folder</label>
                <select
                  className="input"
                  value={draft.folderHint}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, folderHint: e.target.value }))
                  }
                >
                  {PLANT_SUBFOLDERS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Label</label>
                <input
                  className="input"
                  value={draft.label}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                  placeholder="e.g. GST Registration"
                />
              </div>
              <div>
                <label className="label">Description</label>
                <input
                  className="input"
                  value={draft.description}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, description: e.target.value }))
                  }
                  placeholder="Optional detail"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-4 items-center">
              <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                <input
                  type="checkbox"
                  checked={draft.required}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, required: e.target.checked }))
                  }
                />
                Required by default
              </label>
              <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                <input
                  type="checkbox"
                  checked={draft.scope === "PARTY"}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      scope: e.target.checked ? "PARTY" : "PLANT",
                    }))
                  }
                />
                Per director / party
              </label>
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40 ml-auto"
                style={{
                  background: "rgba(99,102,241,0.25)",
                  border: "1px solid rgba(99,102,241,0.5)",
                  color: "#e0e7ff",
                }}
                disabled={pending || !draft.label.trim()}
                onClick={() =>
                  start(async () => {
                    try {
                      await createDocCatalogItem(draft);
                      setDraft((d) => ({ ...d, label: "", description: "" }));
                      setMsg("Added to template (and existing plants)");
                      reload();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Create failed");
                    }
                  })
                }
              >
                Add to template
              </button>
            </div>
          </div>

          {grouped.map(([group, list]) => {
            const style = GROUP_STYLE[group] || GROUP_STYLE.MISC;
            const closed = collapsed[group] === true;
            return (
              <div
                key={group}
                className="rounded-lg overflow-hidden"
                style={{ border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
                  style={{ background: `${style.bg}33` }}
                  onClick={() =>
                    setCollapsed((p) => ({ ...p, [group]: !p[group] }))
                  }
                >
                  <span
                    className="text-[0.72rem] uppercase tracking-wider font-bold px-2.5 py-1 rounded-md"
                    style={{ background: style.bg, color: style.fg }}
                  >
                    {group}
                  </span>
                  <span className="text-xs ml-auto" style={{ color: "var(--text-muted)" }}>
                    {list.length} · {closed ? "▸" : "▾"}
                  </span>
                </button>
                {!closed && (
                  <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                    {list.map((r) => (
                      <div
                        key={r.id}
                        className="grid gap-2 px-3 py-3 items-start"
                        style={{
                          gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr) 6.5rem 5.5rem 4rem",
                          borderTop: "1px solid rgba(255,255,255,0.06)",
                        }}
                      >
                        <div className="space-y-1 min-w-0">
                          <input
                            className="input text-sm py-1.5"
                            value={r.label}
                            onChange={(e) => patchLocal(r.id, { label: e.target.value })}
                            onBlur={(e) => saveField(r.id, { label: e.target.value })}
                          />
                          <input
                            className="input text-xs py-1"
                            value={r.description || ""}
                            placeholder="Description"
                            onChange={(e) =>
                              patchLocal(r.id, { description: e.target.value })
                            }
                            onBlur={(e) =>
                              saveField(r.id, { description: e.target.value })
                            }
                          />
                          <p className="text-[0.65rem]" style={{ color: "var(--text-dim)" }}>
                            {r.code} · {r.scope}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <select
                            className="input text-xs py-1.5"
                            value={r.folderHint}
                            onChange={(e) => {
                              patchLocal(r.id, { folderHint: e.target.value });
                              saveField(r.id, { folderHint: e.target.value });
                            }}
                          >
                            {PLANT_SUBFOLDERS.map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                            {!PLANT_SUBFOLDERS.includes(
                              r.folderHint as (typeof PLANT_SUBFOLDERS)[number],
                            ) && (
                              <option value={r.folderHint}>{r.folderHint}</option>
                            )}
                          </select>
                          <input
                            className="input text-xs py-1"
                            value={r.matchHints.join(", ")}
                            placeholder="Match keywords"
                            onChange={(e) =>
                              patchLocal(r.id, {
                                matchHints: e.target.value
                                  .split(",")
                                  .map((x) => x.trim())
                                  .filter(Boolean),
                              })
                            }
                            onBlur={(e) =>
                              saveField(r.id, {
                                matchHints: e.target.value
                                  .split(",")
                                  .map((x) => x.trim())
                                  .filter(Boolean),
                              })
                            }
                          />
                        </div>
                        <label
                          className="flex items-center gap-1.5 text-xs pt-2"
                          style={{ color: "var(--text-muted)" }}
                        >
                          <input
                            type="checkbox"
                            checked={r.required}
                            onChange={(e) => {
                              patchLocal(r.id, { required: e.target.checked });
                              saveField(r.id, { required: e.target.checked });
                            }}
                          />
                          Required
                        </label>
                        <select
                          className="input text-xs py-1.5"
                          value={r.scope}
                          onChange={(e) => {
                            const scope = e.target.value as "PLANT" | "PARTY";
                            patchLocal(r.id, { scope });
                            saveField(r.id, { scope });
                          }}
                        >
                          <option value="PLANT">Plant</option>
                          <option value="PARTY">Per party</option>
                        </select>
                        <button
                          type="button"
                          className="text-xs pt-2"
                          style={{ color: "#fca5a5" }}
                          disabled={pending}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Delete “${r.label}” from the template? This also removes it from all plant checklists.`,
                              )
                            ) {
                              return;
                            }
                            start(async () => {
                              try {
                                await deleteDocCatalogItem(r.id);
                                reload();
                              } catch (e) {
                                setError(
                                  e instanceof Error ? e.message : "Delete failed",
                                );
                              }
                            });
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}
