import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import EditClassPage from '@/app/(dashboard)/classes/[id]/edit/page';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { writeStoredTokens } from '@/lib/auth-storage';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'class-1' }),
  usePathname: () => '/classes/class-1/edit',
}));

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.signature`;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body == null ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CLASS_DETAIL = {
  id: 'class-1',
  tenantId: 't',
  name: 'Yoga',
  description: null,
  billingMode: 'PER_SESSION',
  monthlyAmount: null,
  sessionPrice: '10',
  isActive: true,
  createdAt: '',
  updatedAt: '',
  locations: [],
  trainers: [],
  trainees: [{ id: 'tr-1', firstName: 'Ada', lastName: 'Lovelace' }],
};
const TRAINEES = [
  { id: 'tr-1', firstName: 'Ada', lastName: 'Lovelace' },
  { id: 'tr-2', firstName: 'Bob', lastName: 'Builder' },
];

function renderPage() {
  return render(
    <I18nProvider>
      <AuthProvider>
        <EditClassPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('EditClassPage — roster management', () => {
  let patchBody: Record<string, unknown> | null = null;

  beforeEach(() => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    writeStoredTokens({
      accessToken: buildJwt({ sub: 'u', email: 'a@b', role: 'ADMIN', tenantId: 't', exp }),
      refreshToken: 'R',
    });
    replace.mockClear();
    patchBody = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      if (url.includes('/classes/class-1') && method === 'PATCH') {
        patchBody = init?.body ? JSON.parse(init.body as string) : null;
        return Promise.resolve(jsonResponse(200, CLASS_DETAIL));
      }
      if (url.includes('/classes/class-1')) return Promise.resolve(jsonResponse(200, CLASS_DETAIL));
      if (url.includes('/trainees')) return Promise.resolve(jsonResponse(200, TRAINEES));
      if (url.includes('/locations')) return Promise.resolve(jsonResponse(200, []));
      return Promise.resolve(jsonResponse(200, {}));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pre-checks enrolled trainees and sends traineeIds on save', async () => {
    const { container } = renderPage();

    const tr1 = await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('input[value="tr-1"]');
      if (!el) throw new Error('roster checkbox not rendered');
      return el;
    });
    const tr2 = container.querySelector<HTMLInputElement>('input[value="tr-2"]')!;
    expect(tr1.checked).toBe(true); // already enrolled per ClassDetail.trainees
    expect(tr2.checked).toBe(false);

    fireEvent.click(tr2);
    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(patchBody).not.toBeNull();
      expect((patchBody!.traineeIds as string[]).slice().sort()).toEqual(['tr-1', 'tr-2']);
    });
  });
});
