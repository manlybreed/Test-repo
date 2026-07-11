"use client";

import { useEffect, useState } from "react";

export function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;

  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const dayName = days[now.getDay()];
  const date = `${now.getDate()} ${months[now.getMonth()]}`;
  const hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;

  return (
    <div className="flex flex-col items-end leading-none gap-0.5">
      <span className="text-[0.58rem] tracking-[0.14em] uppercase font-medium"
        style={{ color: "var(--text-dim)" }}>
        {dayName}, {date}
      </span>
      <span className="text-sm font-semibold tabular-nums"
        style={{ color: "var(--text-muted)" }}>
        {h12}:{minutes}
        <span className="text-[0.65rem] ml-0.5 font-normal" style={{ color: "var(--text-dim)" }}>{ampm}</span>
      </span>
    </div>
  );
}
