import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for the Electron packaged app (`pack:dir` ships
  // .next/standalone and runs it with a forked node; `next dev` ignores
  // this field). Rewrites below read HARNESS_URL at SERVER START, so the
  // packaged server can point at the supervised harness port at runtime.
  output: "standalone",
  async rewrites() {
    const harness = process.env.HARNESS_URL ?? "http://127.0.0.1:5173";
    return [
      { source: "/harness/:path*", destination: `${harness}/:path*` },
      // Demo/proxy HTML is rendered by the harness and uses root-relative
      // probe URLs (for example /src/probe.js).
      { source: "/src/:path*", destination: `${harness}/src/:path*` },
      // The browser client is served by the desktop harness, but its
      // MediaPipe module and WASM runtime are imported from /node_modules.
      // Keep those assets on the same frontend origin so the module graph
      // can load when the editor page is opened at :3000.
      {
        source: "/node_modules/@mediapipe/:path*",
        destination: `${harness}/node_modules/@mediapipe/:path*`,
      },
      { source: "/api/invoke", destination: `${harness}/api/invoke` },
      { source: "/api/transcribe", destination: `${harness}/api/transcribe` },
      { source: "/api/projects", destination: `${harness}/api/projects` },
      { source: "/api/projects/:path*", destination: `${harness}/api/projects/:path*` },
      { source: "/api/events", destination: `${harness}/api/events` },
      { source: "/api/transcript", destination: `${harness}/api/transcript` },
      { source: "/api/decide-and-edit", destination: `${harness}/api/decide-and-edit` },
    ];
  },
};

export default nextConfig;
