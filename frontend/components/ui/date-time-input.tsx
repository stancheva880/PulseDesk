import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Input } from './input';
import { TimeInput } from './time-input';
import { cn } from '@/lib/utils';

export interface DateTimeInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  className?: string;
  disabled?: boolean;
  'aria-invalid'?: boolean;
}

function splitParts(value: string): { date: string; time: string } {
  if (!value) return { date: '', time: '' };
  const idx = value.indexOf('T');
  if (idx === -1) return { date: value, time: '' };
  return { date: value.slice(0, idx), time: value.slice(idx + 1) };
}

function joinParts(date: string, time: string): string {
  if (!date && !time) return '';
  return `${date}T${time}`;
}

export const DateTimeInput = forwardRef<HTMLInputElement, DateTimeInputProps>(
  ({ id, value, onChange, onBlur, className, disabled, ...rest }, ref) => {
    const dateRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => dateRef.current as HTMLInputElement);

    const { date, time } = splitParts(value);

    return (
      <div className={cn('flex gap-2', className)}>
        <Input
          ref={dateRef}
          id={id}
          type="date"
          value={date}
          onChange={(e) => onChange(joinParts(e.target.value, time))}
          onBlur={onBlur}
          disabled={disabled}
          aria-invalid={rest['aria-invalid']}
          className="flex-1"
        />
        <TimeInput
          value={time}
          onChange={(e) => onChange(joinParts(date, e.target.value))}
          onBlur={onBlur}
          disabled={disabled}
          aria-invalid={rest['aria-invalid']}
          className="w-28"
        />
      </div>
    );
  },
);
DateTimeInput.displayName = 'DateTimeInput';
