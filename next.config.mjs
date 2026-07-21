import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin the workspace root to this project — an unrelated lockfile in the
  // parent directory otherwise makes Next.js guess wrong.
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  // Phase 1: server-side route handlers are the default; no separate service.
  experimental: {
    // Server Actions are used for mutating flows in later milestones.
  },
};

export default nextConfig;
