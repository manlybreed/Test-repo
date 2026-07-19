import { describe, expect, it } from "vitest";
import { prepareMailHtml } from "@/components/mail/message-reader";

describe("prepareMailHtml", () => {
  it("strips global <style> that would break the app shell", () => {
    const html = `
      <html><head>
        <style>body { display:none !important } .mail-shell { opacity:0 }</style>
        <link rel="stylesheet" href="https://evil.example/x.css">
      </head>
      <body>
        <p>Meet Claude Sonnet 5</p>
        <img src="https://cdn.example/hero.png" width="2400" />
      </body></html>
    `;
    const out = prepareMailHtml(html, null, "dark");
    expect(out).not.toMatch(/<style/i);
    expect(out).not.toMatch(/<link/i);
    expect(out).not.toMatch(/<html/i);
    expect(out).not.toMatch(/display:\s*none/i);
    expect(out).toContain("Meet Claude Sonnet 5");
    expect(out).toMatch(/width="100%"/i);
  });

  it("strips fixed positioning that overlays the UI", () => {
    const html = `<div style="position:fixed; top:0; left:0; z-index:9999; width:5000px">X</div>`;
    const out = prepareMailHtml(html, null, "original");
    expect(out).not.toMatch(/position\s*:\s*fixed/i);
    expect(out).not.toMatch(/z-index/i);
    expect(out).toContain("X");
  });
});
