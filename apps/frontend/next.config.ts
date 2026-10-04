import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const harness = process.env.HARNESS_URL ?? "http://127.0.0.1:5173";
    return [
      { source: "/harness/:path*", destination: `${harness}/:path*` },
      { source: "/api/invoke", destination: `${harness}/api/invoke` },
      { source: "/api/events", destination: `${harness}/api/events` },
      { source: "/api/transcript", destination: `${harness}/api/transcript` },
      { source: "/api/decide-and-edit", destination: `${harness}/api/decide-and-edit` },
    ];
  },
};

export default nextConfig;
