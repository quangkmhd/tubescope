import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  distDir: process.env.TUBESCOPE_NEXT_DIST_DIR || '.next',
  devIndicators: false,
  // The CSS loader's persisted build cache can retain an older app stylesheet.
  experimental: { turbopackFileSystemCacheForBuild: false },
  turbopack: { rules: { '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' } } },
  async rewrites() { return [{ source: '/api/:path*', destination: `${process.env.TUBESCOPE_API_URL || 'http://127.0.0.1:8765'}/api/:path*` }]; },
};
export default nextConfig;
