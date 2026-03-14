import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/manga2novel",
  assetPrefix: "/manga2novel",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
