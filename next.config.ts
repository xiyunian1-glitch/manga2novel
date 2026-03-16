import type { NextConfig } from "next";

function resolvePagesBasePath(): string {
  const repository = process.env.GITHUB_REPOSITORY?.split("/")[1]?.trim();
  const override = process.env.GITHUB_PAGES_REPO?.trim();
  const repoName = override || repository || "manga2novel";
  return `/${repoName}`;
}

const basePath = resolvePagesBasePath();

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  assetPrefix: basePath,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
