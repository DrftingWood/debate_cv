import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils/cn';

// cn() only resolves a conflict if tailwind-merge recognises both classes as
// the same group. The project's custom names are invisible to it unless
// lib/utils/cn.ts lists them, and the failure is silent: both classes ship
// and the CSS order picks the winner.
describe('cn', () => {
  it('keeps a custom font size and a text colour together', () => {
    expect(cn('text-ui', 'text-primary-foreground')).toBe('text-ui text-primary-foreground');
  });

  it('treats the named spacing steps as spacing', () => {
    expect(cn('p-4', 'p-panel')).toBe('p-panel');
    expect(cn('mt-2', 'mt-section')).toBe('mt-section');
    expect(cn('space-y-3', 'space-y-stack')).toBe('space-y-stack');
    expect(cn('gap-inline', 'gap-2')).toBe('gap-2');
  });

  it('treats the named page widths as max-widths', () => {
    expect(cn('max-w-6xl', 'max-w-content')).toBe('max-w-content');
    expect(cn('max-w-wide', 'max-w-prose')).toBe('max-w-prose');
  });
});
