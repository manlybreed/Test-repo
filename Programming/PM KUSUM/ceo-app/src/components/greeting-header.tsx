"use client";

function getGreeting(): { prefix: string; sub: string } {
  const h = new Date().getHours();
  if (h < 5)  return { prefix: "Still at it?",      sub: "The market rewards the relentless." };
  if (h < 12) return { prefix: "Good morning,",     sub: "A clear mind builds a clear day." };
  if (h < 17) return { prefix: "Good afternoon,",   sub: "Stay focused — the best hours are ahead." };
  if (h < 21) return { prefix: "Good evening,",     sub: "Review, reflect, and set tomorrow's intent." };
  return       { prefix: "Good night,",             sub: "Rest well — great leaders recharge with purpose." };
}

export function GreetingHeader({ name }: { name?: string | null }) {
  const greeting = getGreeting();
  const displayName = name || "Akshay";
  const firstName = displayName.split(" ")[0];

  return (
    <header className="mb-6">
      <p className="text-[0.6rem] tracking-[0.26em] uppercase mb-2 font-semibold"
        style={{ color: "var(--text-dim)" }}>
        BluRidge · Principal&apos;s View
      </p>
      <h1 className="text-[2.4rem] font-bold tracking-tight leading-none mb-3">
        <span className="grad-text">{greeting.prefix} {firstName}.</span>
      </h1>
      <p className="text-sm" style={{ color: "var(--text-muted)", maxWidth: "30rem" }}>
        {greeting.sub} Press{" "}
        <kbd
          className="text-[0.75em] px-1.5 py-0.5 rounded font-mono"
          style={{
            background: "rgba(99,102,241,0.1)",
            border: "1px solid rgba(99,102,241,0.25)",
            color: "var(--accent-bright)",
          }}
        >
          ⌘K
        </kbd>{" "}
        to run any command.
      </p>
    </header>
  );
}
