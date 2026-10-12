import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR || ".next", // lets a test server run beside `npm run dev`
  allowedDevOrigins: ["127.0.0.1"], // dev only: lets automated browsers use 127.0.0.1
  // a stray lockfile in the home directory would otherwise be picked as the workspace root
  turbopack: { root: import.meta.dirname },
  // Chromium/puppeteer must not be bundled; mammoth uses dynamic requires.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core", "mammoth"],
  // Files read at runtime via fs are not traced automatically.
  outputFileTracingIncludes: {
    "/api/pdf": [
      "./public/fonts/**/*",
      "./node_modules/@sparticuz/chromium/bin/**/*",
      // loaded through a runtime require (see lib/pdf.ts), so tracing cannot see them
      "./node_modules/react-dom/**/*",
      "./node_modules/react/**/*",
      "./node_modules/scheduler/**/*",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
