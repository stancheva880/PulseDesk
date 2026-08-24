'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Cards, type CustomerCardEntry } from '@/lib/api-resources';
import { cn } from '@/lib/utils';
import { apiErrorMessage } from '@/lib/api';

// TKT-0116: read-only by construction — no buttons, no forms, nothing to submit (AC #3).

interface GroupedCards {
  traineeId: string;
  traineeName: string;
  cards: CustomerCardEntry[];
}

export default function PortalCardsPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<CustomerCardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Cards.myCards()
      .then(setEntries)
      .catch((e: unknown) => setError(apiErrorMessage(e)));
  }, []);

  // Group by trainee so a parent with multiple kids gets a clean per-trainee section.
  const grouped = useMemo<GroupedCards[]>(() => {
    if (!entries) return [];
    const map = new Map<string, GroupedCards>();
    for (const card of entries) {
      const name = `${card.trainee.firstName} ${card.trainee.lastName}`;
      const bucket = map.get(card.traineeId) ?? {
        traineeId: card.traineeId,
        traineeName: name,
        cards: [],
      };
      bucket.cards.push(card);
      map.set(card.traineeId, bucket);
    }
    return Array.from(map.values());
  }, [entries]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('portal.cards.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('portal.cards.subtitle')}</p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {entries === null ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('portal.cards.empty')}</p>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.traineeId} className="space-y-3">
              <h2 className="text-lg font-semibold">{group.traineeName}</h2>
              <ul className="space-y-3">
                {group.cards.map((card) => (
                  <VisitCard key={card.id} card={card} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function VisitCard({ card }: { card: CustomerCardEntry }) {
  const { t } = useTranslation();
  // Stable per mount — "expired" does not need to tick while the page is open.
  const [now] = useState(() => Date.now());
  const expired = card.expiresAt !== null && new Date(card.expiresAt).getTime() < now;
  // AC #2: cancelled, expired, or 0-remaining is visually marked; one badge is enough,
  // in that order of severity.
  const badge = card.cancelledAt
    ? t('portal.cards.cancelled')
    : expired
      ? t('portal.cards.expired')
      : card.visitsRemaining === 0
        ? t('portal.cards.exhausted')
        : null;

  return (
    <li>
      <Card className={cn(badge && 'opacity-70')}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {card.class?.name ?? t('portal.cards.wholeClub')}
            </CardTitle>
            {badge ? (
              <span
                data-testid="card-badge"
                className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {badge}
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{t('portal.cards.visits')}</dt>
              <dd className="font-medium">
                {card.visitsRemaining} / {card.totalVisits}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {card.expiresAt
                  ? t('portal.cards.expires', {
                      date: new Date(card.expiresAt).toISOString().slice(0, 10),
                    })
                  : t('portal.cards.noExpiry')}
              </dt>
            </div>
          </dl>
        </CardContent>
      </Card>
    </li>
  );
}
