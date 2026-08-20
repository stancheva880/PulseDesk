'use client';

import { useParams } from 'next/navigation';
import { SessionForm } from '../../session-form';

export default function EditSessionPage() {
  const params = useParams<{ id: string }>();
  return <SessionForm mode="edit" id={params.id} />;
}
