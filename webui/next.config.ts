import type { NextConfig } from "next";

// Port-specific distDir lets multiple `next dev` instances coexist
// (Next.js locks distDir; same .next cannot run on 3000 and 4000 together).
const distDir = process.env.PRODUCT_REGISTER_DIST_DIR?.trim() || ".next";

const nextConfig: NextConfig = {
  distDir,
};

export default nextConfig;
