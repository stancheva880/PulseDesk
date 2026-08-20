import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp } from '@/lib/csp';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const isDev = process.env.NODE_ENV !== 'production';

export function middleware(request: NextRequest): NextResponse {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const csp = buildCsp(nonce, isDev, apiUrl);

  // Next reads the CSP off the *request* headers to discover the nonce and stamps it on
  // the bootstrap/streaming scripts it injects itself. Skip this and those scripts are
  // blocked, which breaks hydration outright.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  // Static assets contain no inline script, so generating a nonce for them is pure cost.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
