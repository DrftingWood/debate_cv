import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReviewFlagView } from '@/lib/admin/reviewSet';
import type { FailedJobRow } from '@/components/admin/FailedJobsTable';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// Task 5c render checks: the Tab cell's three states, the Failed imports
// table's new column and "Flagged" badge, and the "Flagged for review"
// ledger with and without flags.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

const { TabStatus } = await import('@/components/admin/TabStatus');
const { FailedJobsTable } = await import('@/components/admin/FailedJobsTable');
const { ReviewSetSection } = await import('@/components/admin/ReviewSetSection');

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const h = React.createElement;
const NOW = new Date('2026-10-31T12:00:00Z');

describe('the Tab cell', () => {
  it('says loaded, partly or not loaded with a symbol and a word', () => {
    const loaded = html(
      h(TabStatus, { tab: { state: 'loaded', tournamentId: '5', errors: [] }, name: 'Oxford IV' }),
    );
    expect(loaded).toMatch(/✓<\/span>\s*Loaded/);
    const open = /<a ([^>]*)>Open<\/a>/.exec(loaded)?.[1] ?? '';
    expect(open).toContain('href="/admin/tournaments/5"');
    expect(open).toContain('aria-label="Open Oxford IV"');

    const missing = html(
      h(TabStatus, { tab: { state: 'missing', tournamentId: null, errors: [] } }),
    );
    expect(missing).toMatch(/✗<\/span>\s*Not loaded/);
    expect(missing).not.toContain('/admin/tournaments/');
  });

  it('lets keyboard and screen-reader users read the errors of a partly loaded tab', () => {
    const out = html(
      h(TabStatus, {
        tab: {
          state: 'partial',
          tournamentId: '5',
          errors: ['R3: HTTP 503 Service Unavailable', 'Speaker tab: timed out'],
        },
      }),
    );
    expect(out).toMatch(/\?<\/span>\s*Partly/);
    const trigger = /<button type="button" aria-expanded="false" aria-describedby="([^"]+)"/.exec(
      out,
    );
    expect(trigger).not.toBeNull();
    const id = trigger![1]!;
    const list = new RegExp(
      `<ul id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" class="sr-only">(.*?)</ul>`,
    ).exec(out);
    expect(list).not.toBeNull();
    expect(list![1]).toContain('<li>R3: HTTP 503 Service Unavailable</li>');
    expect(list![1]).toContain('<li>Speaker tab: timed out</li>');
    // The visible list rides on the tooltip as well, for the pointer.
    expect(out.split('Speaker tab: timed out')).toHaveLength(3);
    expect(out).toContain('href="/admin/tournaments/5"');
  });
});

const job = (over: Partial<FailedJobRow>): FailedJobRow => ({
  id: 'j1',
  user: 'maya@example.com',
  url: 'oxiv.calicotab.com/oxiv2025/…',
  href: 'https://oxiv.calicotab.com/oxiv2025/',
  attempts: 3,
  error: 'The tab site had a problem on its side. Retry later.',
  when: null,
  stored: { id: '5', name: 'Oxford IV', scraped: null },
  tab: { state: 'loaded', tournamentId: '5', errors: [] },
  flag: null,
  ...over,
});

describe('Failed imports with the Tab column', () => {
  it('puts Tab first after the checkbox, with a column that stays on a phone', () => {
    const out = html(h(FailedJobsTable, { rows: [job({})], total: 1 }));
    const heads = [...out.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/g)].map((m) => m[1]);
    expect(heads[1]).toBe('Tab');
    // Every column hidden below md is hidden as a col too, so cells keep
    // their columns; the Tab col is not one of them.
    const cols = [...out.matchAll(/<col( class="([^"]*)")?\s*(style="[^"]*")?\/?>/g)];
    expect(cols).toHaveLength(heads.length);
    expect(cols[1]![2] ?? '').not.toContain('hidden');
    const hiddenHeads = [...out.matchAll(/<th scope="col" class="([^"]*)"/g)].filter((m) =>
      /(^|\s)hidden(\s|$)/.test(m[1]!),
    ).length;
    const hiddenCols = cols.filter((c) => /(^|\s)hidden(\s|$)/.test(c[2] ?? '')).length;
    expect(hiddenCols).toBe(hiddenHeads);
  });

  // Review leftover: an ambiguous address read "? Check" under Tab but
  // "Not stored" under In database.
  it('says "? Check" in both cells for an address that matched no single stored row', () => {
    const out = html(
      h(FailedJobsTable, {
        rows: [
          job({
            stored: null,
            tab: { state: 'check', tournamentId: null, errors: ['2 stored tournaments share it.'] },
          }),
        ],
        total: 1,
      }),
    );
    expect(out).not.toContain('Not stored');
    expect(out.match(/\?<\/span>(&nbsp;|\s)*Check/g)).toHaveLength(2);
  });

  it('marks a row already in the review set, and offers the action', () => {
    const out = html(
      h(FailedJobsTable, {
        rows: [job({ flag: { priority: 'high' } }), job({ id: 'j2', flag: null })],
        total: 2,
      }),
    );
    expect(out.match(/Flagged · High/g)).toHaveLength(1);
    expect(out).toMatch(/<button[^>]*aria-expanded="false"[^>]*>.*Add to review set/);
    expect(out).toContain('Retry selected');
  });
});

const flag = (over: Partial<ReviewFlagView>): ReviewFlagView => ({
  id: '1',
  source: 'import',
  sourceId: 'j1',
  priority: 'medium',
  comment: 'Check R3',
  status: 'open',
  url: 'https://oxiv.calicotab.com/oxiv2025/',
  tournament: { id: '5', name: 'Oxford IV' },
  lastError: null,
  attempts: 3,
  tab: { state: 'loaded', tournamentId: '5', errors: [] },
  detail: null,
  createdBy: 'admin@example.com',
  createdAt: new Date('2026-10-30T12:00:00Z'),
  ...over,
});

describe('Flagged for review: a flag that is not one tournament import', () => {
  const na: ReviewFlagView['tab'] = { state: 'not_applicable', tournamentId: null, errors: [] };

  it('shows a parser warning no tab status, only an em dash and sr-only text', () => {
    const out = html(
      h(ReviewSetSection, {
        now: NOW,
        flags: [
          flag({
            source: 'parser_warning',
            sourceId: 'parseTabs|x',
            comment: 'warn',
            url: null,
            tournament: null,
            attempts: null,
            tab: na,
          }),
        ],
      }),
    );
    expect(out).not.toContain('Not loaded');
    expect(out).not.toContain('✗');
    expect(out).toMatch(/<span class="sr-only">Not applicable<\/span>/);
    expect(out).toContain('—');
  });

  it('still shows an import its real state', () => {
    const out = html(
      h(ReviewSetSection, {
        now: NOW,
        flags: [
          flag({ tournament: null, tab: { state: 'missing', tournamentId: null, errors: [] } }),
        ],
      }),
    );
    expect(out).toContain('Not loaded');
    expect(out).not.toContain('Not applicable');
  });
});

describe('Flagged for review', () => {
  it('lists the set high to low, then oldest first, with export links', () => {
    const out = html(
      h(ReviewSetSection, {
        now: NOW,
        flags: [
          flag({ id: '1', priority: 'low', comment: 'low one' }),
          flag({
            id: '2',
            priority: 'high',
            comment: 'new high',
            createdAt: new Date('2026-10-31T10:00:00Z'),
          }),
          flag({
            id: '3',
            priority: 'high',
            comment: 'old high',
            createdAt: new Date('2026-10-29T10:00:00Z'),
          }),
          flag({
            id: '4',
            priority: 'medium',
            comment: 'mid',
            tournament: null,
            tab: { state: 'missing', tournamentId: null, errors: [] },
          }),
          flag({ id: '5', priority: 'high', comment: 'finished', status: 'done' }),
        ],
      }),
    );
    expect(out).toMatch(/<h2[^>]*>Flagged for review<\/h2>/);
    const order = ['old high', 'new high', 'mid', 'low one'].map((c) => out.indexOf(c));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Done items wait behind "Show done".
    expect(out).not.toContain('finished');
    expect(out).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Show done/);
    expect(out).toContain('href="/api/admin/review-set?format=json&amp;status=open"');
    expect(out).toContain('href="/api/admin/review-set?format=csv&amp;status=open"');
    expect(out).toMatch(/aria-label="Priority for Oxford IV"/);
    expect(out).toMatch(/>Mark done</);
    expect(out).toContain('Not loaded');
    expect(out).toContain('1 d ago');
  });

  it('says so when nothing has been flagged', () => {
    const out = html(h(ReviewSetSection, { now: NOW, flags: [] }));
    expect(out).toContain('Nothing flagged yet');
    expect(out).not.toContain('<table');
  });
});
