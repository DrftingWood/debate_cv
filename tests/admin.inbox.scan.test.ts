import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as { React?: typeof React }).React = React;

// Ruling 10: on ?tab=inbox the summary line and the Inbox panel share one
// page read, so the candidate scan (listInbox) runs once per render. The
// real summary module and the real page are used; only the data is faked.
// React's cache() memoises per server render; outside one it is a
// pass-through, so it is stood in for by a memo keyed on its arguments,
// which is the semantics the page relies on.

const h = vi.hoisted(() => ({ listInbox: vi.fn(), countInbox: vi.fn() }));

vi.mock('react', async (orig) => {
  const real = await orig<typeof import('react')>();
  return {
    ...real,
    default: real,
    cache: <A extends unknown[], R>(fn: (...a: A) => R) => {
      const memo = new Map<string, R>();
      return (...a: A) => {
        const k = JSON.stringify(a);
        if (!memo.has(k)) memo.set(k, fn(...a));
        return memo.get(k)!;
      };
    },
  };
});
vi.mock('@/lib/admin', () => ({ requireAdmin: vi.fn(async () => 'admin@example.com') }));
vi.mock('@/lib/admin/inbox', () => ({ listInbox: h.listInbox, countInbox: h.countInbox }));
vi.mock('@/lib/admin/accuracy', () => ({ getAccuracyOverview: vi.fn() }));
vi.mock('@/lib/db', () => ({
  prisma: {
    tournamentAudit: { groupBy: vi.fn(async () => []) },
    ingestJob: { count: vi.fn(async () => 0) },
    discoveredUrl: { count: vi.fn(async () => 0) },
    tournament: { count: vi.fn(async () => 0) },
  },
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

const render = async (search: Record<string, string>) => {
  const { default: AdminPage } = await import('@/app/(app)/admin/page');
  return renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve(search) }));
};

beforeEach(() => {
  vi.resetModules();
  h.listInbox.mockReset().mockResolvedValue({
    rows: [],
    total: 0,
    page: 1,
    pages: 1,
    counts: { check: 2, report: 0, import: 1, parser: 0 },
    truncated: false,
  });
  h.countInbox.mockReset().mockResolvedValue({ check: 2, report: 0, import: 1, parser: 0 });
});

describe('the Inbox scan', () => {
  it('runs once on ?tab=inbox, and the summary line uses its counts', async () => {
    const out = await render({ tab: 'inbox' });
    expect(h.listInbox).toHaveBeenCalledTimes(1);
    expect(h.countInbox).not.toHaveBeenCalled();
    expect(out.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).toContain('Needs you 3');
  });

  it('reads the filter and page of the address in that one scan', async () => {
    await render({ tab: 'inbox', kinds: 'import', inboxPage: '2' });
    expect(h.listInbox).toHaveBeenCalledTimes(1);
    expect(h.listInbox).toHaveBeenCalledWith({ page: 2, kinds: ['import'] });
  });

  it('counts without listing on another tab', async () => {
    await render({ tab: 'tools' });
    expect(h.listInbox).not.toHaveBeenCalled();
    expect(h.countInbox).toHaveBeenCalledTimes(1);
  });
});
