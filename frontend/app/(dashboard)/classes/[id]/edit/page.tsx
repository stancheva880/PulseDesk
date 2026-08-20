'use client';

import { useParams } from 'next/navigation';
import { ClassForm } from '../../class-form';

export default function EditClassPage() {
  const params = useParams<{ id: string }>();
  return <ClassForm mode="edit" id={params.id} />;
}
