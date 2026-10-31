import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReviewFlagView } from '@/lib/admin/reviewSet';
import type { ImportRow } from '@/components/admin/ImportGroupsTable';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// Task 5c render checks: the Tab cell's three states, the Failed imports
// table's Tab column, and the "Flagged for review"
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
const { ImportGroupsTable } = await import('@/components/admin/ImportGroupsTable');
const { CheckActionsProvider } = await import('@/components/admin/CheckActions');
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

const job = (over: Partial<ImportRow>): ImportRow => ({
  key: 'oxiv.calicotab.com/oxiv2025',
  section: 'failing',
  name: 'oxiv.calicotab.com/oxiv2025',
  tournamentId: null,
  tabUrl: 'https://oxiv.calicotab.com/oxiv2025/',
  tab: { state: 'missing', tournamentId: null, errors: [] },
  error: 'The tournament page was not found.',
  attempts: 3,
  users: ['maya@example.com'],
  moreUsers: 0,
  latest: null,
  jobIds: ['j1'],
  stored: null,
  mark: {
    kind: 'import',
    subject: 'oxiv.calicotab.com/oxiv2025',
    fingerprint: '0123456789abcdef',
    checkedWords: null,
    changed: false,
  },
  ...over,
});

const table = (rows: ImportRow[], retryJobIds: string[] = []) =>
  html(h(CheckActionsProvider, null, h(ImportGroupsTable, { rows, retryJobIds })));

describe('Failed imports with the Tab column', () => {
  it('puts Tab first, with a column that stays on a phone and columns that match the cells', () => {
    const out = table([job({})]);
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

  // An address that matched no single stored row is "? Check", never a
  // false "Not loaded".
  it('says "? Check", not "Not loaded", for an address that matched no single stored row', () => {
    const out = table([
      job({
        tab: { state: 'check', tournamentId: null, errors: ['2 stored tournaments share it.'] },
      }),
    ]);
    expect(out).not.toContain('Not loaded');
    expect(out).toMatch(/\?<\/span>(&nbsp;|\s)*Check/);
  });
});

describe('Failed imports: actions', () => {
  it('offers Fix, Mark checked and Review later on a failing row, and none on a covered one', () => {
    const out = table([
      job({}),
      job({ key: 'stored:5', section: 'covered', name: 'Oxford IV', mark: null }),
    ]);
    // Twice each: the desktop cell and the phone card of the one failing row.
    expect(out.match(/>Mark checked</g)).toHaveLength(2);
    expect(out.match(/>Fix</g)).toHaveLength(2);
    expect(out.match(/Review later/g)).toHaveLength(2);
    expect(out).toContain('Nothing to do: the user already has this tournament');
  });

  it('puts a checkbox only on failing rows, and Retry selected and Retry all n above them', () => {
    const out = table(
      [job({}), job({ key: 'stored:5', section: 'covered', name: 'Oxford IV', mark: null })],
      ['j1', 'j2', 'j3'],
    );
    expect(out.match(/type="checkbox"/g)).toHaveLength(2); // the header and the failing row
    expect(out).toContain('aria-label="Select oxiv.calicotab.com/oxiv2025"');
    expect(out).not.toContain('aria-label="Select Oxford IV"');
    expect(out).toContain('Retry selected');
    expect(out).toContain('Retry all 3');
    expect(out).toContain('0 selected');
    // The status line is there from the first render, empty.
    expect(out).toMatch(/role="status"[^>]*><\/p>/);
  });

  it('offers no retry bar or checkbox when every row is covered', () => {
    const out = table([job({ section: 'covered', mark: null })]);
    expect(out).not.toContain('Retry selected');
    expect(out).not.toContain('type="checkbox"');
  });

  it('a checked row has Undo, no Fix and no Review later', () => {
    const out = table([
      job({
        mark: {
          kind: 'import',
          subject: 'oxiv.calicotab.com/oxiv2025',
          fingerprint: '0123456789abcdef',
          checkedWords: 'Checked by owner on 30 Oct 2026',
          changed: false,
        },
      }),
    ]);
    expect(out).toContain('>Undo<');
    expect(out).not.toContain('>Fix<');
    expect(out).not.toContain('Review later');
  });

  // A mark says the failure is expected: Retry selected must not requeue it.
  it('has no checkbox on a checked row and no retry bar when only checked rows are listed', () => {
    const checkedRow = job({
      mark: {
        kind: 'import',
        subject: 'oxiv.calicotab.com/oxiv2025',
        fingerprint: '0123456789abcdef',
        checkedWords: 'Checked by owner on 30 Oct 2026',
        changed: false,
      },
    });
    const only = table([checkedRow]);
    expect(only).not.toContain('type="checkbox"');
    expect(only).not.toContain('Retry selected');
    // Beside an open row, the open row alone is tickable.
    const mixed = table([checkedRow, job({ key: 'b', name: 'b.calicotab.com/b' })]);
    expect(mixed.match(/type="checkbox"/g)).toHaveLength(2); // header and the open row
    expect(mixed).not.toContain('aria-label="Select oxiv.calicotab.com/oxiv2025"');
    expect(mixed).toContain('Retry selected');
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
    expect(out).toMatch(/<a [^>]*href="[^"]*"[^>]*>Show done<\/a>/);
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
