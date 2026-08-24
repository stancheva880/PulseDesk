'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SessionForm } from '../session-form';

// Reads ?classId=. Isolated + Suspense-wrapped so useSearchParams() doesn't force
// the whole page out of static prerendering (Next.js CSR-bailout requirement).
function NewSessionForm() {
  const params = useSearchParams();
  return <SessionForm mode="create" initialClassId={params.get('classId') ?? undefined} />;
}

export default function NewSessionPage() {
  return (
    <Suspense fallback={null}>
      <NewSessionForm />
    </Suspense>
  );
}
