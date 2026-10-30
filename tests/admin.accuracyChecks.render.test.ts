import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PieceCard } from '@/lib/admin/pieceGrid';
import type { PieceRow } from '@/lib/admin/scrapeHealth';

// The components use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// Server-render checks for the per-tournament "Accuracy checks" panel (Task 5
// of the data-accuracy plan), its read model, and "Select suggested" on the
// piece grid. The fixture carries private URLs on purpose: no href and no
// prop may keep the key.

const db = vi.hoisted(() => ({
  tournamentAudit: { findUnique: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/tournaments/5',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

const { CHECKS_VERSION } = await import('@/lib/audit/checks');
const { getTournamentAccuracy } = await import('@/lib/admin/tournamentAccuracy');
const { AccuracyChecks } = await import('@/components/admin/AccuracyChecks');
const { AuditNowView } = await import('@/components/admin/AuditNowButton');
const { PieceGridView } = await import('@/components/admin/PieceGrid');
const { selectSuggested, toPieceCard } = await import('@/lib/admin/pieceGrid');

const NOW = new Date('2026-10-31T12:00:00Z');
const BASE = 'https://oxiv.calicotab.com/oxiv2025/';
const PRIVATE = `${BASE}privateurls/k3yS3cr3t/`;

const stored = {
  tournamentId: 5n,
  score: 74,
  checksVersion: CHECKS_VERSION,
  computedAt: new Date('2026-10-31T11:00:00Z'),
  checks: [
    { code: 'champion', status: 'pass', detail: 'Champion found: Team A.', pieces: [] },
    {
      code: 'rounds_complete',
      status: 'fail',
      detail: 'Round 3 has 4 rooms; round 2 had 8.',
      pieces: [{ kind: 'round', key: '3', label: 'R3', url: `${PRIVATE}results/round/3/` }],
    },
    {
      code: 'panels',
      status: 'warn',
      detail: '2 rooms have no chair.',
      pieces: [{ kind: 'round', key: '2', label: 'R2', url: null }],
    },
    {
      code: 'break_matches',
      status: 'na',
      detail: 'No break tab.',
      pieces: [],
      assumptions: ['no_open_bracket_champion'],
    },
  ],
};

beforeEach(() => {
  db.tournamentAudit.findUnique.mockReset();
  db.tournamentAudit.findUnique.mockResolvedValue(stored);
});

describe('getTournamentAccuracy', () => {
  it('reads the stored audit into rows, with public links only', async () => {
    const a = (await getTournamentAccuracy(5n))!;
    expect(a.score).toBe(74);
    expect(a.band).toBe('check');
    expect(a.checks.map((c) => c.status)).toEqual(['pass', 'fail', 'warn', 'na']);
    expect(a.checks[1]!.pieces[0]!.url).toBe(BASE);
    expect(a.suggested.map((p) => `${p.kind}:${p.key}`)).toEqual(['round:3', 'round:2']);
    expect(JSON.stringify(a).toLowerCase()).not.toContain('privateurls');
  });

  it('is null when the tournament was never audited', async () => {
    db.tournamentAudit.findUnique.mockResolvedValue(null);
    expect(await getTournamentAccuracy(5n)).toBeNull();
  });
});

describe('<AccuracyChecks>', () => {
  it('shows every label, the four pills and a detail sentence', async () => {
    const audit = (await getTournamentAccuracy(5n))!;
    const html = renderToStaticMarkup(
      React.createElement(AccuracyChecks, {
        tournamentId: '5',
        tournamentName: 'Oxford IV',
        audit,
        now: NOW,
      }),
    );
    for (const label of ['Champion', 'Rounds complete', 'Panels', 'Break size']) {
      expect(html).toContain(label);
    }
    for (const pill of ['Pass', 'Check', 'Fail', 'Not applicable']) expect(html).toContain(pill);
    expect(html).toContain('Round 3 has 4 rooms; round 2 had 8.');
    expect(html).toContain('<h2');
    expect(html).toContain('Accuracy checks');
    expect(html).toContain('74');
    expect(html).toContain('Audited');
    expect(html).toContain('1 h ago');
    expect(html).toContain('Audit again');
    // Suggested pieces are links to the public page; one without a url is text.
    expect(html).toContain(`href="${BASE}"`);
    expect(html).toContain('R3');
    expect(html).toContain('R2');
    // The open question links to the overview's panel.
    expect(html).toContain('Open question: Champion when a tab has no Open bracket');
    expect(html).toContain('href="/admin#open-questions"');
    expect(html.toLowerCase()).not.toContain('privateurls');
    expect(html).not.toContain('k3yS3cr3t');
  });

  it('says so when the tournament has not been audited', () => {
    const html = renderToStaticMarkup(
      React.createElement(AccuracyChecks, {
        tournamentId: '5',
        tournamentName: 'Oxford IV',
        audit: null,
        now: NOW,
      }),
    );
    expect(html).toContain('Not audited yet');
    expect(html).toContain('Audit again');
  });
});

describe('<AccuracyChecks> audit notes', () => {
  const render = (audit: Awaited<ReturnType<typeof getTournamentAccuracy>>) =>
    renderToStaticMarkup(
      React.createElement(AccuracyChecks, {
        tournamentId: '5',
        tournamentName: 'Oxford IV',
        audit,
        now: NOW,
      }),
    );

  it('says in words when the audit used older checks', async () => {
    db.tournamentAudit.findUnique.mockResolvedValue({ ...stored, checksVersion: 'old' });
    const audit = (await getTournamentAccuracy(5n))!;
    expect(audit.outdated).toBe(true);
    db.tournamentAudit.findUnique.mockResolvedValue(stored);
    expect((await getTournamentAccuracy(5n))!.outdated).toBe(false);
    expect(render(audit)).toContain('Audited with older checks');
  });

  it('says so when no check results are stored', async () => {
    db.tournamentAudit.findUnique.mockResolvedValue({ ...stored, checks: [] });
    const html = render((await getTournamentAccuracy(5n))!);
    expect(html).toContain('No check results stored');
    expect(html).not.toContain('Audited with older checks');
  });

  it('has no duplicate Tab link beside the page header button', async () => {
    expect(render((await getTournamentAccuracy(5n))!)).not.toContain('Tab of Oxford IV');
  });
});

describe('Audit again', () => {
  it('has its own label and status wording', () => {
    const html = renderToStaticMarkup(
      React.createElement(AuditNowView, {
        pending: true,
        error: null,
        onRun: () => {},
        label: 'Audit again',
        busyLabel: 'Auditing…',
        status: 'Auditing Oxford IV.',
      }),
    );
    expect(html).toContain('Auditing…');
    expect(html).toContain('Auditing Oxford IV.');
  });
});

const card = (kind: PieceCard['kind'], key: string, status: PieceCard['status'] = 'ok') =>
  ({ id: `${kind}:${key}`, kind, key, label: key, status }) as PieceCard;

describe('selectSuggested', () => {
  const grid = [card('team', ''), card('round', '2'), card('round', '3', 'failed')];

  it('ticks exactly the suggested pieces that are in the grid', () => {
    const got = selectSuggested(grid, [
      { kind: 'round', key: '3' },
      { kind: 'round', key: '9' },
      { kind: 'team', key: '' },
    ]);
    expect([...got].sort()).toEqual(['round:3', 'team:']);
  });

  it('ticks nothing when nothing is suggested', () => {
    expect(selectSuggested(grid, []).size).toBe(0);
  });
});

describe('PieceGrid with suggestions', () => {
  const row: PieceRow = {
    kind: 'round',
    key: '3',
    label: 'R3',
    status: 'failed',
    httpStatus: 500,
    attempts: 1,
    loadedAt: null,
    lastAttemptAt: NOW,
    nextRetryAt: null,
    lastError: null,
    url: `${PRIVATE}results/round/3/`,
  };
  const view = (extra: Record<string, unknown>) =>
    renderToStaticMarkup(
      React.createElement(PieceGridView, {
        tabs: [],
        rounds: [toPieceCard(row, NOW)],
        selected: new Set<string>(),
        running: null,
        error: null,
        result: null,
        suggestedCount: 1,
        onToggle: () => {},
        onSelectFailed: () => {},
        onSelectSuggested: () => {},
        onClear: () => {},
        onSubmit: () => {},
        ...extra,
      }),
    );

  it('offers Select suggested and an Open on tab link per card', () => {
    const html = view({});
    expect(html).toContain('Select suggested');
    expect(html).toContain('Open on tab');
    // A 24px-tall target (UX-8), not a 16px line of text.
    expect(html).toMatch(/class="[^"]*inline-flex min-h-6[^"]*">Open on tab/);
    expect(html).toContain(`href="${BASE}"`);
    expect(html.toLowerCase()).not.toContain('privateurls');
  });

  it('leaves Select suggested out when nothing is suggested', () => {
    expect(view({ suggestedCount: 0 })).not.toContain('Select suggested');
  });
});
