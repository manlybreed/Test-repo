"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export const GLASS_PANEL: CSSProperties = {
  background: "rgba(18, 22, 34, 0.72)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid rgba(255,255,255,0.12)",
  boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
};

export type GlassSelectOption = {
  value: string;
  label: string;
  color?: string;
};

/** Translucent dropdown — matches buyer autocomplete glass style. */
export function GlassSelect({
  value,
  options,
  onChange,
  placeholder = "Select…",
  disabled,
  className,
  buttonClassName,
  buttonStyle,
  renderTrigger,
  align = "left",
  minWidth,
}: {
  value: string;
  options: GlassSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  buttonStyle?: CSSProperties;
  /** Custom trigger content; chevron still appended unless fully custom via class. */
  renderTrigger?: (selected: GlassSelectOption | undefined) => ReactNode;
  align?: "left" | "right";
  minWidth?: number | string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={
          buttonClassName ??
          "input w-full text-left flex items-center justify-between gap-2"
        }
        style={{
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
          ...(buttonStyle ?? {}),
        }}
      >
        {renderTrigger ? (
          renderTrigger(selected)
        ) : (
          <>
            <span className="truncate" style={{ color: selected?.color || undefined }}>
              {selected?.label ?? placeholder}
            </span>
            <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0 opacity-60">
              <path
                d="M2 3.5l3 3 3-3"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </>
        )}
      </button>
      {open && (
        <div
          className="absolute top-full z-[70] mt-1 rounded-xl overflow-hidden"
          style={{
            ...GLASS_PANEL,
            minWidth: minWidth ?? "100%",
            left: align === "left" ? 0 : undefined,
            right: align === "right" ? 0 : undefined,
          }}
        >
          {options.map((o) => (
            <button
              key={o.value || "__empty"}
              type="button"
              className="w-full text-left px-3 py-2 text-sm transition-colors"
              style={{
                background: o.value === value ? "rgba(99,102,241,0.18)" : "transparent",
                color: o.color || (o.value === value ? "#c7d2fe" : "rgba(255,255,255,0.85)"),
              }}
              onMouseEnter={(e) => {
                if (o.value !== value) e.currentTarget.style.background = "rgba(99,102,241,0.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  o.value === value ? "rgba(99,102,241,0.18)" : "transparent";
              }}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
