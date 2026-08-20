'use client';

import { useParams } from 'next/navigation';
import { TraineeForm } from '../../trainee-form';

export default function EditTraineePage() {
  const params = useParams<{ id: string }>();
  return <TraineeForm mode="edit" id={params.id} />;
}
