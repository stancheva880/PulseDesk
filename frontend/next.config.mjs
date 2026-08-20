import path from 'node:path';

// Content-Security-Policy is NOT set here. It needs a per-request nonce so that
// script-src can drop 'unsafe-inline', which a static header cannot do — it is built in
// lib/csp.ts and applied by middleware.ts. Setting it in both places would make the
// browser enforce the intersection of two policies and block the nonced scripts.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

// Where /api/* is proxied to when this app is served from a host that does not share a registrable
// domain with the API — the two-project Vercel layout, where the frontend is on one *.vercel.app and
// the backend on another. `vercel.app` is a public suffix, so those are separate sites: the refresh
// cookie is httpOnly + sameSite=strict on path /api/auth (backend/src/auth/cookies.ts), and a
// cross-site request never carries it. Proxying through this origin keeps every request same-origin,
// so the cookie works untouched and no CORS preflight happens in the browser.
//
// Unset in dev and under docker compose, where NEXT_PUBLIC_API_URL points at the backend directly and
// this rewrite must not exist. Set NEXT_PUBLIC_API_URL to an EMPTY string wherever this is set, so
// lib/api.ts resolves API_ROOT to the relative '/api'.
const apiProxyTarget = process.env.API_PROXY_TARGET?.trim();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for a lean Docker prod image. Inert in dev, ignored by Vercel.
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
  async rewrites() {
    if (!apiProxyTarget) return [];
    return [
      {
        source: '/api/:path*',
        destination: `${apiProxyTarget.replace(/\/$/, '')}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
