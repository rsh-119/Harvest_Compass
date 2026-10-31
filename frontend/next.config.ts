import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a local check build somewhere other than .next while a dev server is using it.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
