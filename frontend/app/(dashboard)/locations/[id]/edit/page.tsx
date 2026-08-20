'use client';

import { useParams } from 'next/navigation';
import { LocationForm } from '../../location-form';

export default function EditLocationPage() {
  const params = useParams<{ id: string }>();
  return <LocationForm mode="edit" id={params.id} />;
}
