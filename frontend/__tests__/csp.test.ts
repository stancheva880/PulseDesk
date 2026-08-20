import { describe, expect, it } from 'vitest';
import { buildCsp } from '@/lib/csp';

const API = 'https://api.example.com';

function directive(csp: string, name: string): string {
  const found = csp.split('; ').find((d) => d.startsWith(`${name} `));
  if (!found) throw new Error(`no ${name} directive in: ${csp}`);
  return found;
}

describe('buildCsp', () => {
  it("does not allow 'unsafe-inline' scripts in production", () => {
    // The whole point of the nonce: an injected inline <script> must not execute.
    expect(directive(buildCsp('abc123', false, API), 'script-src')).not.toContain(
      "'unsafe-inline'",
    );
  });

  it("does not allow 'unsafe-inline' scripts in development either", () => {
    // Dev needs 'unsafe-eval' for HMR, but that is not a reason to also allow inline —
    // and letting them diverge would mean dev never exercises the production policy.
    expect(directive(buildCsp('abc123', true, API), 'script-src')).not.toContain(
      "'unsafe-inline'",
    );
  });

  it('carries the nonce it was given', () => {
    expect(directive(buildCsp('n0nc3v4lu3', false, API), 'script-src')).toContain(
      "'nonce-n0nc3v4lu3'",
    );
  });

  it("allows 'unsafe-eval' only in development", () => {
    expect(directive(buildCsp('abc', true, API), 'script-src')).toContain("'unsafe-eval'");
    expect(directive(buildCsp('abc', false, API), 'script-src')).not.toContain("'unsafe-eval'");
  });

  it('permits the API origin for XHR but nothing else in production', () => {
    const connect = directive(buildCsp('abc', false, API), 'connect-src');
    expect(connect).toBe(`connect-src 'self' ${API}`);
    // No websocket scheme in production — that is a dev-server concession.
    expect(connect).not.toContain('ws:');
  });

  it('allows the HMR websocket in development', () => {
    expect(directive(buildCsp('abc', true, API), 'connect-src')).toContain('ws:');
  });

  it('keeps the exfiltration and clickjacking directives from the previous static policy', () => {
    const csp = buildCsp('abc', false, API);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("still allows inline styles, which next/font and auth-shell require", () => {
    // Documented as a deliberate exception, not an oversight: injected CSS cannot
    // exfiltrate here because connect-src and img-src are locked down.
    expect(directive(buildCsp('abc', false, API), 'style-src')).toContain("'unsafe-inline'");
  });
});
