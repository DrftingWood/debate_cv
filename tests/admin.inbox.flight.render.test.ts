import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InboxList } from '@/lib/admin/inboxTypes';

(globalThis as { React?: typeof React }).React = React;

// Final fix round, UI I1: the Inbox table sits inside the page's
// CheckActionsProvider, so its Fix, Mark checked and Review later controls
// share one flight instead of each keeping its own.

const h = vi.hoisted(() => ({ inbox: vi.fn(), seen: [] as unknown[] }));
vi.mock('@/lib/admin/summary', () => ({ readInbox: h.inbox }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('@/components/admin/InboxTable', async () => {
  const { usePageFlight } = await import('@/components/admin/pageFlight');
  const { singleFlight } = await import('@/lib/utils/singleFlight');
  return {
    InboxTable: () => {
      const own = singleFlight();
      h.seen.push({ got: usePageFlight(own), own });
      return null;
    },
  };
});

const { InboxTab } = await import('@/components/admin/tabs/InboxTab');

describe('the Inbox panel', () => {
  it('gives its table the page-wide flight', async () => {
    const list: InboxList = {
      rows: [],
      counts: { check: 1, report: 0, import: 0, parser: 0 },
      total: 1,
      page: 1,
      pages: 1,
      truncated: false,
    };
    h.inbox.mockResolvedValue(list);
    const el = await InboxTab({ search: {}, now: new Date('2026-10-31T12:00:00Z') });
    renderToStaticMarkup(el);
    expect(h.seen).toHaveLength(1);
    const { got, own } = h.seen[0] as { got: unknown; own: unknown };
    expect(got).not.toBe(own);
  });
});
