import type { NextConfig } from "next";
import { loadWebConfig } from "@sara/config";

// Validated via @sara/config — same conventions as the API service.
const web = loadWebConfig();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Compile the shared UI package (consumed as workspace source).
  transpilePackages: ["@sara/ui"],
  // Lint/typecheck run as dedicated CI gates, not during build.
  eslint: { ignoreDuringBuilds: true },
  /**
   * Frontend ⇄ backend connection: browsers call the API same-origin via
   * relative /api/* URLs; Next proxies them to the API service server-side.
   * This works identically on localhost and behind preview proxies.
   */
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${web.apiInternalUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
