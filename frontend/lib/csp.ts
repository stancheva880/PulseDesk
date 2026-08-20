// Content-Security-Policy, built per request so script-src can carry a nonce.
//
// Extracted from next.config.mjs (where it was a static header) because a nonce has to
// change on every response. Kept as a pure function so the policy can be asserted in
// tests without booting Next.

export function buildCsp(nonce: string, isDev: boolean, apiUrl: string): string {
  // No 'unsafe-inline' here — that is the whole point. An injected inline <script>
  // cannot execute without the per-request nonce. Browsers ignore 'unsafe-inline' when
  // a nonce is present anyway, but omitting it keeps the policy honest about what it
  // actually permits.
  const scriptSrc = [
    "script-src 'self'",
    `'nonce-${nonce}'`,
    // Turbopack HMR and React DevTools evaluate code at runtime. Dev only.
    isDev ? "'unsafe-eval'" : '',
  ]
    .filter(Boolean)
    .join(' ');

  // HMR opens a WebSocket back to the dev server.
  const connectSrc = isDev
    ? `connect-src 'self' ${apiUrl} ws: wss:`
    : `connect-src 'self' ${apiUrl}`;

  return [
    "default-src 'self'",
    scriptSrc,
    // style-src deliberately keeps 'unsafe-inline': next/font and components/auth-shell
    // emit <style> blocks, and nonce-ing every style origin buys little — injected CSS
    // is a far weaker primitive than injected script, and cannot exfiltrate here because
    // connect-src and img-src are already locked to 'self' plus the API.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    connectSrc,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
