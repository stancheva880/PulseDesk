'use client';

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

// TKT-0090: the one shared inline error for the eight forms. The zod `message` carries an i18n
// key; this renders it with role="alert" under a stable id the input's aria-describedby names.
// Nothing renders while the field is valid, so the id only exists when it is pointed at.
export function FieldError({ id, messageKey }: { id: string; messageKey?: string }) {
  const { t } = useTranslation();
  if (!messageKey) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {t(messageKey)}
    </p>
  );
}

// Submit-level failure, already translated (it comes from apiErrorMessage). Focus is the whole
// point: it both announces the message and scrolls it into view — a bare paragraph above the
// buttons is off-screen on a long form.
export function SubmitError({ message }: { message: string | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);
  if (!message) return null;
  return (
    <p ref={ref} tabIndex={-1} role="alert" className="text-sm text-destructive outline-none">
      {message}
    </p>
  );
}
