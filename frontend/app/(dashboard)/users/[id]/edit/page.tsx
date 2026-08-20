'use client';

import { useParams } from 'next/navigation';
import { UserForm } from '../../user-form';

export default function EditUserPage() {
  const params = useParams<{ id: string }>();
  return <UserForm mode="edit" id={params.id} />;
}
