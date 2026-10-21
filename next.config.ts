import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

// Uploaded media and insurance documents set their own strict CSP; the app-wide one must not stack on top.
const mediaHeaders = securityHeaders.filter((h) => h.key !== "Content-Security-Policy" && h.key !== "Permissions-Policy");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    localPatterns: [
      { pathname: "/proposal/**", search: "" },
      { pathname: "/brand/**", search: "" },
      { pathname: "/api/media/**", search: "" },
    ],
    minimumCacheTTL: 2678400,
  },
  experimental: {
    // Uploads arrive in 3 MiB chunks (Vercel caps request bodies at 4.5 MB).
    serverActions: { bodySizeLimit: "4mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path((?!api/media/|share/p/[^/]+/documents/).*)", headers: securityHeaders },
      { source: "/api/media/:path*", headers: mediaHeaders },
      // The document route sets Referrer-Policy: no-referrer itself.
      { source: "/share/p/:token/documents/:path*", headers: mediaHeaders.filter((h) => h.key !== "Referrer-Policy") },
    ];
  },
};

export default nextConfig;
