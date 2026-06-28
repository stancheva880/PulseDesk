import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Badge } from '@/components/ui/badge';

describe('Badge', () => {
  it('renders default variant', () => {
    const { container } = render(<Badge>hello</Badge>);
    const span = container.querySelector('span');
    expect(span?.textContent).toBe('hello');
    expect(span?.className).toMatch(/bg-primary/);
  });

  it.each([
    ['secondary', /bg-secondary/],
    ['success', /bg-success/],
    ['warning', /bg-warning/],
    ['destructive', /bg-destructive/],
    ['outline', /border-border/],
  ] as const)('applies the %s variant', (variant, classRe) => {
    const { container } = render(<Badge variant={variant}>x</Badge>);
    expect(container.querySelector('span')?.className).toMatch(classRe);
  });

  it('merges custom className with variant classes', () => {
    const { container } = render(<Badge className="ml-2 custom-class">x</Badge>);
    const span = container.querySelector('span');
    expect(span?.className).toMatch(/ml-2/);
    expect(span?.className).toMatch(/custom-class/);
  });
});
