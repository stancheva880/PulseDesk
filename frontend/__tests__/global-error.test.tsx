import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as Sentry from '@sentry/nextjs';
import GlobalError from '../app/global-error';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

const mockCapture = vi.mocked(Sentry.captureException);

describe('GlobalError', () => {
  beforeEach(() => {
    mockCapture.mockClear();
  });

  it('reports the crash to Sentry once', () => {
    const error = Object.assign(new Error('render exploded'), { digest: 'abc' });
    render(<GlobalError error={error} />);
    expect(mockCapture).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('renders a static fallback with a reload button', () => {
    render(<GlobalError error={new Error('boom')} />);
    expect(screen.getByText('Нещо се обърка')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /презареди/i })).toBeInTheDocument();
  });
});
