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
  delete process.env.DISCOVERY_LIST;
  delete process.env.DISCOVERY_LIST_EMAILS;
});

describe('CvSubNav: the flagged Found tab', () => {
  it('is offered to the owner (admin allowlist), after Motions', async () => {
    const out = await html('boss@example.com');
    expect(out).toContain('href="/cv/found"');
    expect(out.indexOf('/cv/motions')).toBeLessThan(out.indexOf('/cv/found'));
  });

  it('is not offered to a participant without the flag', async () => {
    expect(await html('participant@example.com')).not.toContain('/cv/found');
  });

  it('is offered to an opted-in tester, and to nobody under the kill switch', async () => {
    process.env.DISCOVERY_LIST_EMAILS = 'participant@example.com';
    expect(await html('participant@example.com')).toContain('/cv/found');
    process.env.DISCOVERY_LIST = 'off';
    expect(await html('participant@example.com')).not.toContain('/cv/found');
    expect(await html('boss@example.com')).not.toContain('/cv/found');
  });

  it('marks Found as the current page when active', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', email: 'boss@example.com' } });
    const out = renderToStaticMarkup(await CvSubNav({ active: 'found' }));
    expect(out).toMatch(/aria-current="page"[^>]*href="\/cv\/found"/);
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
  });
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
