import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * ceo-shell.tsx imports next-auth's signOut, which needs the Next.js
 * server/client runtime and breaks under plain vitest — same constraint
 * documented elsewhere in this codebase. Asserted via source text.
 */
describe("Phase 3 — global sidebar-toggle commands", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/ceo-shell.tsx"),
    "utf8",
  );

  it("registers collapse and expand as two separate commands, not one blind toggle", () => {
    expect(src).toContain('id: "nav.collapse-sidebar"');
    expect(src).toContain('id: "nav.expand-sidebar"');
  });

  it("each handler is idempotent — checks current state before calling toggleNavCollapsed", () => {
    const collapseIdx = src.indexOf('id: "nav.collapse-sidebar"');
    const collapseBlock = src.slice(collapseIdx, collapseIdx + 500);
    expect(collapseBlock).toContain("if (!navCollapsed) toggleNavCollapsed();");

    const expandIdx = src.indexOf('id: "nav.expand-sidebar"');
    const expandBlock = src.slice(expandIdx, expandIdx + 500);
    expect(expandBlock).toContain("if (navCollapsed) toggleNavCollapsed();");
  });

  it("registers the commands via useRegisterCommands so they're available app-wide", () => {
    expect(src).toContain("useRegisterCommands(globalCommands)");
  });
});
