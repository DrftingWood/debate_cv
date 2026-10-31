import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InboxItem, InboxList } from '@/lib/admin/inboxTypes';
import type { TournamentAccuracy } from '@/lib/admin/tournamentAccuracy';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// Task R9: where "Infer format" is offered. The Inbox row of a tournament
// whose only open finding is the missing format, and that check on the
// tournament's page; nowhere else.

const h = vi.hoisted(() => ({ inbox: vi.fn() }));
vi.mock('@/lib/admin/summary', () => ({ readInbox: h.inbox }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

const { InboxTab } = await import('@/components/admin/tabs/InboxTab');
const { AccuracyChecks } = await import('@/components/admin/AccuracyChecks');

const NOW = new Date('2026-10-31T12:00:00Z');
const PIECES = [
  { kind: 'round' as const, key: '1', label: 'R1', url: null },
  { kind: 'team' as const, key: '', label: 'Team tab', url: null },
];

const item: InboxItem = {
  key: 'check:5',
  kind: 'check',
  tournament: { id: '5', name: 'Oxford IV 2025', tabUrl: null, status: 'loaded' },
  summary: 'No format is recorded, though 6 rounds are stored.',
  more: 0,
  usersAffected: 1,
  severity: 'fail',
  age: new Date('2026-10-28T12:00:00Z'),
  fix: { type: 'infer_format', tournamentId: '5', pieces: PIECES },
  markItems: [{ kind: 'check', subject: '5:format_missing', fingerprint: 'a'.repeat(16) }],
  flagItems: [],
  reviewFlag: null,
  changedSinceChecked: false,
};

describe('Inbox row with a missing format', () => {
  it('Fix is Infer format, named for the tournament, beside Mark checked', async () => {
    const list: InboxList = {
      rows: [item],
      total: 1,
      page: 1,
      pages: 1,
      counts: { check: 1, report: 0, import: 0, parser: 0 },
      truncated: false,
    };
    h.inbox.mockResolvedValue(list);
    const html = renderToStaticMarkup(await InboxTab({ search: {}, now: NOW }));
    expect(html).toContain('aria-label="Fix: infer the format of Oxford IV 2025"');
    expect(html).toContain('aria-label="Mark checked: Oxford IV 2025"');
    // The fallback is not shown until the inference has said it cannot decide.
    expect(html).not.toContain('Re-scrape suggested');
  });
});

const checkView = (
  code: TournamentAccuracy['checks'][number]['code'],
  status: 'pass' | 'fail' | 'na',
  pieces = PIECES,
): TournamentAccuracy['checks'][number] => ({
  code,
  label: code === 'format_missing' ? 'Format' : 'Champion',
  status,
  detail: 'detail',
  pieces: status === 'fail' ? pieces : [],
  questions: [],
  subject: `5:${code}`,
  fingerprint: status === 'fail' ? 'a'.repeat(16) : null,
  checked: null,
});

const page = (checks: TournamentAccuracy['checks']) =>
  renderToStaticMarkup(
    React.createElement(AccuracyChecks, {
      tournamentId: '5',
      tournamentName: 'Oxford IV 2025',
      audit: {
        score: 80,
        band: 'check',
        computedAt: new Date('2026-10-31T11:00:00Z'),
        outdated: false,
        checks,
        suggested: [],
      },
      now: NOW,
    }),
  );

describe('Format check on the tournament page', () => {
  it('a failing format check offers Infer format', () => {
    const html = page([checkView('format_missing', 'fail')]);
    expect(html).toContain('aria-label="Fix: infer the format of Oxford IV 2025"');
  });

  it('a passing or not-applicable format check offers nothing', () => {
    expect(page([checkView('format_missing', 'pass')])).not.toContain('infer the format');
    expect(page([checkView('format_missing', 'na')])).not.toContain('infer the format');
  });

  it('another failing check does not get it', () => {
    expect(page([checkView('champion', 'fail')])).not.toContain('infer the format');
  });
});
