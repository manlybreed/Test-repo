import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output powers the native Mac .app (faster cold start).
  output: "standalone",
  serverExternalPackages: [
    "@react-pdf/renderer",
    "docx",
    "imapflow",
    "mailparser",
    // imapflow's own transitive dependency — excluding imapflow alone still
    // left webpack trying to bundle this one directly, and its require("stream")
    // has no resolution outside a real Node runtime.
    "@zone-eu/mailsplit",
  ],
  images: {
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion", "date-fns"],
    // Agreement / signed PDF uploads go through Server Actions (default 1 MB).
    serverActions: {
      bodySizeLimit: "20mb",
    },
    // Runs middleware.ts on the Node.js runtime instead of Edge — a real,
    // working experimental flag in Next 15.5 (confirmed at runtime: build
    // output lists "✓ nodeMiddleware" under Experiments), just not in this
    // version's shipped next.config types yet. Without it, Next needed an
    // Edge-compiled bundle of instrumentation.ts too (Edge always needs a
    // middleware bundle), and Edge fundamentally cannot have fs/crypto/
    // net/stream under any config — that's what was actually breaking
    // `next build`, not a missing serverExternalPackages entry.
    // @ts-expect-error — not yet in NextConfig's experimental type in this version
    nodeMiddleware: true,
  },
};

export default nextConfig;
