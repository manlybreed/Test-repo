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
  },
};

export default nextConfig;
