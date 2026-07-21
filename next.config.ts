import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Documents: server-action uploads are capped at 4MB app-side
      // (src/app/portal/documents/actions.ts), just under Vercel's own
      // ~4.5MB serverless request body ceiling.
      bodySizeLimit: '4.5mb',
    },
  },
};

export default nextConfig;
