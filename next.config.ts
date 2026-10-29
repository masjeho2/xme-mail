import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Avoid picking parent /root/package-lock.json as workspace root
  outputFileTracingRoot: path.join(__dirname),
  async headers() {
    // NOTE: Next merges matching header rules; put media first and avoid
    // attaching the app-shell CSP to attachment downloads.
    return [
      {
        source: "/api/messages/:path*/attachments/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'",
          },
        ],
      },
      {
        // App shell only (exclude attachment downloads + frameable email html)
        source: "/((?!api/messages/.*/attachments/|api/messages/.*/html).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
