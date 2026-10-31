import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InboxItem, InboxList } from '@/lib/admin/inboxTypes';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// Task R4: the Inbox panel. Static renders of what the owner sees: a row per
// item with its kind word, the status cell, summary, badges, users, age and
// the three actions (each named for its tournament), the kind chips with
// counts, the empty state, and the phone's card layout.

const KEY = 'k3yS3cr3t';
const h = vi.hoisted(() => ({ inbox: vi.fn() }));
vi.mock('@/lib/admin/summary', () => ({ readInbox: h.inbox }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

const { InboxTab } = await import('@/components/admin/tabs/InboxTab');

const NOW = new Date('2026-10-31T12:00:00Z');
const counts = { check: 4, report: 2, import: 3, parser: 1 };

const base = {
  more: 0,
  usersAffected: 0,
  severity: 'fail' as const,
  age: new Date('2026-10-28T12:00:00Z'),
  markItems: [{ kind: 'check' as const, subject: '5:no_teams', fingerprint: 'a'.repeat(16) }],
  flagItems: [],
  reviewFlag: null,
  changedSinceChecked: false,
};

const checkItem: InboxItem = {
  ...base,
  key: 'check:5',
  kind: 'check',
  tournament: {
    id: '5',
    name: 'Oxford IV 2025',
    tabUrl: `https://oxiv.calicotab.com/oxiv2025/privateurls/${KEY}/`,
    status: 'partial',
  },
  summary: 'Round 3 has no results',
  more: 2,
  usersAffected: 4,
  fix: {
    type: 'rescrape',
    tournamentId: '5',
    pieces: [{ kind: 'round', key: '3', label: 'Round 3', url: null }],
  },
  flagItems: [{ source: 'audit_check', sourceId: '5:rounds_complete' }],
  changedSinceChecked: true,
  reviewFlag: { priority: 'high' },
};
const importItem: InboxItem = {
  ...base,
  key: 'import:n.calicotab.com/new',
  kind: 'import',
  tournament: {
    id: null,
    name: 'n.calicotab.com/new',
    tabUrl: 'https://n.calicotab.com/new/',
    status: 'missing',
  },
  summary: 'The site returned not found',
  usersAffected: 2,
  fix: { type: 'retry', jobIds: ['j1', 'j2'] },
  markItems: [{ kind: 'import', subject: 'n.calicotab.com/new', fingerprint: 'b'.repeat(16) }],
  flagItems: [
    { source: 'import', sourceId: 'j1' },
    { source: 'import', sourceId: 'j2' },
  ],
};
const parserItem: InboxItem = {
  ...base,
  key: 'parser:x',
  kind: 'parser',
  tournament: null,
  summary: 'Ballot table not found',
  fix: { type: 'open', href: '/admin?tab=parser' },
  markItems: [{ kind: 'parser', subject: 'x', fingerprint: 'c'.repeat(16) }],
  flagItems: [{ source: 'parser_warning', sourceId: 'x' }],
};

const list = (rows: InboxItem[], extra: Partial<InboxList> = {}): InboxList => ({
  rows,
  total: rows.length,
  page: 1,
  pages: 1,
  counts,
  truncated: false,
  ...extra,
});

const render = async (search: Record<string, string> = {}) =>
  renderToStaticMarkup(await InboxTab({ search, now: NOW }));
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')');

beforeEach(() => {
  h.inbox.mockReset();
  h.inbox.mockResolvedValue(list([checkItem, importItem, parserItem]));
});

describe('Inbox rows', () => {
  it('shows each kind as a word, the summary with "+n more", users and age', async () => {
    const out = await render();
    const t = text(out);
    for (const word of ['Accuracy', 'Import', 'Parser']) expect(t).toContain(word);
    expect(t).toContain('Oxford IV 2025');
    expect(t).toContain('Round 3 has no results');
    expect(t).toContain('+2 more');
    expect(out).toMatch(/<td[^>]*cell-num[^>]*>4</);
    expect(t).toContain('3 d ago');
    // The name links to the stored tournament's page.
    expect(out).toContain('href="/admin/tournaments/5"');
  });

  it('names every action for its tournament, in the shell vocabulary', async () => {
    const out = await render();
    expect(out).toContain('aria-label="Mark checked: Oxford IV 2025"');
    expect(out).toContain('aria-label="Review later: n.calicotab.com/new"');
    expect(out).toContain('aria-label="Fix: Re-scrape suggested (1) for Oxford IV 2025"');
    expect(out).toContain('aria-label="Fix: retry n.calicotab.com/new"');
    expect(out).toContain('aria-label="Fix: open Ballot table not found"');
    expect(out).toContain('href="/admin?tab=parser"');
    expect(text(out)).toContain('Mark checked');
    expect(text(out)).toContain('Review later');
  });

  it('offers Review later on an accuracy check, and on every kind that can be flagged', async () => {
    const out = await render();
    expect(out).toContain('aria-label="Review later: Oxford IV 2025"');
    expect(out).toContain('aria-label="Review later: Ballot table not found"');
  });

  it('offers no Review later for an item with nothing to flag', async () => {
    h.inbox.mockResolvedValue(list([{ ...parserItem, flagItems: [] }]));
    expect(await render()).not.toContain('Review later: Ballot table not found');
  });

  it('marks a changed item and a flagged one', async () => {
    const t = text(await render());
    expect(t).toContain('Changed since you checked it');
    expect(t).toContain('Flagged · High');
  });

  it('puts the one status cell beside the name and a public link, never the private key', async () => {
    const out = await render();
    expect(text(out)).toContain('Partly');
    expect(text(out)).toContain('Not loaded');
    expect(out).toContain('href="https://oxiv.calicotab.com/oxiv2025/"');
    expect(out.toLowerCase()).not.toContain('privateurls');
    expect(out).not.toContain(KEY);
  });
});

describe('Inbox bulk bar and row menu', () => {
  it('has a bulk bar that is a named group, announces the count and shows select-all on a phone', async () => {
    const out = await render();
    expect(out).toContain('role="group" aria-label="Bulk actions"');
    expect(out).toMatch(/aria-live="polite"[^>]*>0 selected</);
    // The header box is for md and up; below it the bar carries a labelled one.
    expect(out).toMatch(/<label[^>]*md:hidden[^>]*>[\s\S]*?Select all 3 shown/);
  });

  it('has a row menu whose summary hides the browser marker', async () => {
    const out = await render();
    expect(out).toContain('[&amp;::-webkit-details-marker]:hidden');
  });

  it('has a row menu with the tab link and the details page', async () => {
    const out = await render();
    expect(out).toContain('Open tab');
    expect(out).toContain('Open details');
    expect(out).toContain('More actions for Oxford IV 2025');
  });
});

describe('Inbox shell', () => {
  it('has one h2 and no h1, a labelled table, and a column for every header', async () => {
    const out = await render();
    expect(out.match(/<h1[ >]/g)).toBeNull();
    expect(out.match(/<h2[ >]/g)).toHaveLength(1);
    expect(out).toContain('<caption class="sr-only">Inbox items</caption>');
    const ths = (out.match(/<th scope="col"/g) ?? []).length;
    const cols = (out.match(/<col[ >]/g) ?? []).length;
    expect(cols).toBe(ths);
  });

  it('folds to cards on a phone: the column group goes with the cells that fill it', async () => {
    const out = await render();
    expect(out).toContain('<colgroup class="max-md:hidden">');
    expect(out).toMatch(/<tr[^>]*max-md:grid/);
  });

  it('shows kind chips with counts, the current one marked, keeping other parameters', async () => {
    const out = await render({ kinds: 'import', tab: 'inbox' });
    const t = text(out);
    expect(t).toContain('All 10');
    expect(t).toContain('Accuracy 4');
    expect(t).toContain('CV reports 2');
    expect(t).toContain('Imports 3');
    expect(t).toContain('Parser 1');
    expect(out).toMatch(/aria-current="true"[^>]*>[^<]*Imports/);
    // Toggling a second kind on keeps the first, and the other parameters stay.
    expect(out).toContain('kinds=check%2Cimport');
    expect(out).toContain('tab=inbox');
    expect(h.inbox).toHaveBeenCalledWith(1, 'import');
  });

  it('reads the page named by ?inboxPage= and pages with the shared Pager', async () => {
    h.inbox.mockResolvedValue(list([checkItem], { total: 45, page: 2, pages: 3 }));
    const out = await render({ inboxPage: '2' });
    expect(h.inbox).toHaveBeenCalledWith(2, '');
    expect(text(out)).toContain('21–40 of 45');
    expect(out).toContain('aria-label="Inbox pages"');
    expect(out).toContain('inboxPage=3');
  });

  it('says why it is empty', async () => {
    h.inbox.mockResolvedValue(list([], { counts: { check: 0, report: 0, import: 0, parser: 0 } }));
    expect(text(await render())).toContain('Nothing needs you. Every flag is fixed or checked.');
  });

  it('says a filter matched nothing when other kinds still wait', async () => {
    h.inbox.mockResolvedValue(list([]));
    const t = text(await render({ kinds: 'parser' }));
    expect(t).toContain('Nothing of this kind needs you');
    expect(t).not.toContain('Every flag is fixed or checked');
  });

  it("says older failures weren't scanned when the import scan was cut short", async () => {
    h.inbox.mockResolvedValue(list([importItem], { truncated: true }));
    expect(text(await render())).toContain("Older failures weren't scanned");
  });

  it('says the read failed rather than showing an empty inbox', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.inbox.mockRejectedValue(new Error('db down'));
    expect(text(await render())).toContain("Couldn't load the inbox");
  });
});
