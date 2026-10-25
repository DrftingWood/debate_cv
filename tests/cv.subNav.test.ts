import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: authMock }));

const { CvSubNav } = await import('@/components/CvSubNav');

async function html(email: string | null) {
  authMock.mockResolvedValue(email ? { user: { id: 'u1', email } } : null);
  return renderToStaticMarkup(await CvSubNav({ active: 'record' }));
}

beforeEach(() => {
  authMock.mockReset();
  process.env.ADMIN_EMAIL = 'boss@example.com';
});

describe('CvSubNav', () => {
  it('shows participants the record, statistics and motions only', async () => {
    const out = await html('participant@example.com');
    expect(out).toContain('href="/cv/stats"');
    expect(out).toContain('href="/cv/motions"');
    expect(out).not.toContain('/cv/tags');
    expect(out).not.toContain('/cv/verify');
  });

  it('shows Tags and Verify to an admin', async () => {
    const out = await html('boss@example.com');
    expect(out).toContain('href="/cv/tags"');
    expect(out).toContain('href="/cv/verify"');
  });

  it('hides them when nobody is signed in', async () => {
    expect(await html(null)).not.toContain('/cv/tags');
  });
});
