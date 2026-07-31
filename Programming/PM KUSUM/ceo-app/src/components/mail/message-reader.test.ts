import { describe, expect, it } from "vitest";
import { hasRemoteImages, prepareMailHtml } from "@/components/mail/message-reader";

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

  it("shows remote images by default (allowRemoteImages defaults true — existing callers like print stay unaffected)", () => {
    const html = `<p>Hi</p><img src="https://cdn.example/tracker.png" width="1" height="1">`;
    const out = prepareMailHtml(html, null, "dark");
    expect(out).toContain("https://cdn.example/tracker.png");
    expect(out).not.toContain("data-blocked-src");
  });

  it("blocks remote images when allowRemoteImages is false, preserving width/height and stashing the real URL", () => {
    const html = `<p>Hi</p><img src="https://cdn.example/tracker.png" width="120" height="40" alt="promo">`;
    const out = prepareMailHtml(html, null, "dark", false);
    // The real `src` attribute (space-separated, not the `data-blocked-src`
    // one) must no longer point at the remote URL — checked with a leading
    // space so this doesn't false-negative on "...blocked-src=..." itself
    // containing "src=" as a substring.
    expect(out).not.toContain(' src="https://cdn.example/tracker.png"');
    expect(out).toContain('data-blocked-src="https://cdn.example/tracker.png"');
    expect(out).toMatch(/src="data:image\/gif;base64,/);
    expect(out).toContain('width="120"');
    expect(out).toContain('height="40"');
    expect(out).toContain('alt="promo"');
  });

  it("leaves inline data: images alone even when allowRemoteImages is false", () => {
    const html = `<img src="data:image/png;base64,iVBORw0KGgo=" alt="inline">`;
    const out = prepareMailHtml(html, null, "dark", false);
    expect(out).toContain("data:image/png;base64,iVBORw0KGgo=");
    expect(out).not.toContain("data-blocked-src");
  });

  it("hasRemoteImages detects http(s) <img> but not inline/cid images or no images at all", () => {
    expect(hasRemoteImages(`<img src="https://cdn.example/x.png">`)).toBe(true);
    expect(hasRemoteImages(`<img src="http://cdn.example/x.png">`)).toBe(true);
    expect(hasRemoteImages(`<img src="cid:abc123">`)).toBe(false);
    expect(hasRemoteImages(`<img src="data:image/png;base64,abc">`)).toBe(false);
    expect(hasRemoteImages(`<p>No images here</p>`)).toBe(false);
    expect(hasRemoteImages(null)).toBe(false);
  });
});
