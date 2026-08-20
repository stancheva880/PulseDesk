'use client';

import { useParams } from 'next/navigation';
import { ScheduleForm } from '../../schedule-form';

export default function EditSchedulePage() {
  const params = useParams<{ id: string }>();
  return <ScheduleForm mode="edit" id={params.id} />;
}
