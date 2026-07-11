import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer", "docx"],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
