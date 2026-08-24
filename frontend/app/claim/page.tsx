'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { Waitlist } from '@/lib/api-resources';

// TKT-0114: the portal-read-only exception. No login, no shell — the token in the URL is
// the whole authorization; the request needs no session and attaches none.

type ClaimState =
  | { kind: 'checking' }
  | { kind: 'claimed'; className: string; startsAt: string }
  | { kind: 'taken' }
  | { kind: 'expired' };

function ClaimResult() {
  const { t } = useTranslation();
  const token = useSearchParams().get('token');
  // A link with no token is dead on arrival — no request, straight to expired.
  const [state, setState] = useState<ClaimState>(() =>
    token ? { kind: 'checking' } : { kind: 'expired' },
  );

  useEffect(() => {
    if (!token) return;
    Waitlist.claim({ token })
      .then((body) => {
        setState({ kind: 'claimed', className: body.className, startsAt: body.startsAt });
      })
      .catch((e: unknown) => {
        setState(e instanceof ApiError && e.status === 409 ? { kind: 'taken' } : { kind: 'expired' });
      });
  }, [token]);

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>PulseDesk</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {state.kind === 'checking' ? (
          <p className="text-sm text-muted-foreground">{t('claim.checking')}</p>
        ) : state.kind === 'claimed' ? (
          <>
            <p className="text-lg font-medium">{t('claim.claimed')}</p>
            <p className="text-sm text-muted-foreground">
              {t('claim.claimedDetail', {
                className: state.className,
                startsAt: new Date(state.startsAt).toLocaleString(),
              })}
            </p>
          </>
        ) : state.kind === 'taken' ? (
          <>
            <p className="text-lg font-medium">{t('claim.taken')}</p>
            <p className="text-sm text-muted-foreground">{t('claim.takenDetail')}</p>
          </>
        ) : (
          <p className="text-lg font-medium">{t('claim.expired')}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ClaimPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Suspense fallback={null}>
        <ClaimResult />
      </Suspense>
    </main>
  );
}
