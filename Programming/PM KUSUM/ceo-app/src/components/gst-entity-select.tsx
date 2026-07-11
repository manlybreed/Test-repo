"use client";

import { GST_ENTITIES, type GstEntity, isGstEntity } from "@/lib/gst-entities";

export function GstEntitySelect({
  value,
  onChange,
  label = "GST entity",
  size = "md",
}: {
  value: string;
  onChange: (v: GstEntity) => void;
  label?: string;
  size?: "sm" | "md";
}) {
  const current = isGstEntity(value) ? value : "DEL";
  const seller = GST_ENTITIES[current];
  const compact = size === "sm";

  return (
    <div>
      {label && <label className="label">{label}</label>}
      <div className="flex gap-2">
        {(Object.keys(GST_ENTITIES) as GstEntity[]).map((code) => {
          const e = GST_ENTITIES[code];
          const selected = current === code;
          return (
            <button
              key={code}
              type="button"
              onClick={() => onChange(code)}
              className="flex-1 rounded-lg font-semibold transition-all"
              style={{
                padding: compact ? "5px 8px" : "9px 12px",
                fontSize: compact ? "0.68rem" : "0.78rem",
                letterSpacing: "0.04em",
                background: selected ? e.bg : "rgba(255,255,255,0.03)",
                border: `1px solid ${selected ? e.color + "66" : "rgba(255,255,255,0.1)"}`,
                color: selected ? e.color : "rgba(255,255,255,0.45)",
                boxShadow: selected ? `0 0 0 1px ${e.color}22 inset` : "none",
                cursor: "pointer",
              }}
              title={`${e.label} · ${e.gstin}`}
            >
              {e.label}
            </button>
          );
        })}
      </div>

      <div
        className="mt-3 rounded-xl overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.03)",
          border: `1px solid ${seller.color}40`,
        }}
      >
        <div
          className="px-3.5 py-2 flex items-center justify-between gap-2"
          style={{
            background: `linear-gradient(90deg, ${seller.bg}, transparent)`,
            borderBottom: `1px solid ${seller.color}28`,
          }}
        >
          <span
            className="text-[0.62rem] uppercase tracking-[0.16em] font-bold"
            style={{ color: seller.color }}
          >
            BluRidge · {seller.short}
          </span>
          <span
            className="text-[0.68rem] font-mono tabular-nums font-semibold"
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            {seller.gstin}
          </span>
        </div>

        <div className={compact ? "px-3.5 py-2.5 space-y-2" : "px-3.5 py-3 space-y-2.5"}>
          <div>
            <p
              className="text-[0.8rem] font-semibold leading-snug"
              style={{ color: "rgba(255,255,255,0.92)" }}
            >
              {seller.legalName}
            </p>
            <p
              className="text-[0.72rem] leading-relaxed mt-1"
              style={{ color: "rgba(255,255,255,0.55)" }}
            >
              {seller.addressLine1}
              {seller.addressLine2 ? `, ${seller.addressLine2}` : ""}
              <br />
              {seller.city}, {seller.state} {seller.pincode}
            </p>
          </div>

          <div
            className="grid grid-cols-2 gap-3 pt-2"
            style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div>
              <p
                className="text-[0.58rem] uppercase tracking-[0.14em] font-semibold mb-0.5"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                State
              </p>
              <p className="text-[0.8rem] font-semibold" style={{ color: "rgba(255,255,255,0.9)" }}>
                {seller.state}
              </p>
            </div>
            <div>
              <p
                className="text-[0.58rem] uppercase tracking-[0.14em] font-semibold mb-0.5"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                State code
              </p>
              <p
                className="text-[0.8rem] font-semibold tabular-nums"
                style={{ color: seller.color }}
              >
                {seller.stateCode}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GstEntityBadge({ value }: { value: string | null | undefined }) {
  const entity = isGstEntity(value) ? value : "DEL";
  const e = GST_ENTITIES[entity];
  return (
    <span
      className="inline-flex items-center text-[0.6rem] px-1.5 py-0.5 rounded font-bold tracking-wide"
      style={{ background: e.bg, color: e.color, border: `1px solid ${e.color}44` }}
      title={`${e.label} · ${e.gstin} · ${e.state}`}
    >
      {e.short}
    </span>
  );
}
