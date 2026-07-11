import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output powers the native Mac .app (faster cold start).
  output: "standalone",
  serverExternalPackages: ["@react-pdf/renderer", "docx"],
  images: {
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion", "date-fns"],
  },
};

export default nextConfig;
