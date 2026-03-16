function resolvePagesBasePath() {
  const repository = process.env.GITHUB_REPOSITORY?.split('/')[1]?.trim();
  const override = process.env.GITHUB_PAGES_REPO?.trim();
  const repoName = override || repository || 'manga2novel';
  return `/${repoName}`;
}

const basePath = resolvePagesBasePath();

const nextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath,
  assetPrefix: basePath,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
