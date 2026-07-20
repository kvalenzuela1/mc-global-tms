/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Phase 1: server-side route handlers are the default; no separate service.
  experimental: {
    // Server Actions are used for mutating flows in later milestones.
  },
};

export default nextConfig;
