import { forwardRef, type InputHTMLAttributes } from 'react';
import { Input } from './input';

export type TimeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'pattern' | 'inputMode' | 'maxLength' | 'placeholder'
> & {
  placeholder?: string;
};

const TIME_PATTERN = '^([01][0-9]|2[0-3]):[0-5][0-9]$';

export const TimeInput = forwardRef<HTMLInputElement, TimeInputProps>(
  ({ placeholder = 'HH:MM', ...props }, ref) => (
    <Input
      ref={ref}
      type="text"
      inputMode="numeric"
      pattern={TIME_PATTERN}
      maxLength={5}
      placeholder={placeholder}
      {...props}
    />
  ),
);
TimeInput.displayName = 'TimeInput';
