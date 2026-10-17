import type { NextConfig } from 'next';

// Fully static site (out/) served by Cloudflare Pages — everything, including
// document conversion, runs in the browser.
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
};

export default nextConfig;
