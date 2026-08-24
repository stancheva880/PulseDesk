'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ScheduleForm } from '../schedule-form';

// Reads ?classId=. Isolated + Suspense-wrapped so useSearchParams() doesn't force
// the whole page out of static prerendering (Next.js CSR-bailout requirement).
function NewScheduleForm() {
  const params = useSearchParams();
  return <ScheduleForm mode="create" initialClassId={params.get('classId') ?? undefined} />;
}

export default function NewSchedulePage() {
  return (
    <Suspense fallback={null}>
      <NewScheduleForm />
    </Suspense>
  );
}
