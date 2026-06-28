import path from 'node:path';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const isDev = process.env.NODE_ENV !== 'production';

// Next.js dev/Turbopack and React DevTools need 'unsafe-eval' for HMR + callstack
// reconstruction. Production never uses eval; the directive stays strict there.
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";
// HMR opens a WebSocket back to the dev server.
const connectSrc = isDev
  ? `connect-src 'self' ${apiUrl} ws: wss:`
  : `connect-src 'self' ${apiUrl}`;

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob:",
      "font-src 'self' data: https://fonts.gstatic.com",
      connectSrc,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {},
  // Self-contained server bundle for a lean Docker prod image. Inert in dev.
  output: 'standalone',
  // Trace hoisted deps from the monorepo root (workspace node_modules live there).
  outputFileTracingRoot: path.join(import.meta.dirname, '..'),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
