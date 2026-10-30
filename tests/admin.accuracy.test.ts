import { beforeEach, describe, expect, it, vi } from 'vitest';

// The "Data accuracy" read model over a mocked database, and the pure parts
// of its two buttons. The rendered section is in admin.accuracy.render.test.ts.

const h = vi.hoisted(() => ({
  db: {
    tournamentAudit: { findMany: vi.fn() },
    tournament: { count: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ prisma: h.db }));

const { getAccuracyOverview, parseChecks } = await import('@/lib/admin/accuracy');
const { rescrapeAction } = await import('@/lib/admin/accuracyActions');
const { auditFailureMessage } = await import('@/lib/admin/actionMessage');

const NOW = new Date('2026-10-31T12:00:00Z');
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000);

const piece = (key: string, label = `R${key}`) => ({
  kind: 'round' as const,
  key,
  label,
  url: `https://x.calicotab.com/x/results/round/${key}/`,
});

type Row = {
  tournamentId: bigint;
  score: number;
  usersAffected: number;
  computedAt: Date;
  checks: unknown;
};
const audit = (id: number, score: number, over: Partial<Row> = {}): Row => ({
  tournamentId: BigInt(id),
  score,
  usersAffected: 0,
  computedAt: hoursAgo(1),
  checks: [],
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  h.db.tournamentAudit.findMany.mockReset();
  h.db.tournament.count.mockReset().mockResolvedValue(5);
  h.db.tournament.findMany
    .mockReset()
    .mockImplementation(async ({ where }: { where: { id: { in: bigint[] } } }) =>
      where.id.in.map((id) => ({
        id,
        name: `T${id}`,
        sourceUrlRaw: `https://x.calicotab.com/t${id}/privateurls/secret${id}/`,
      })),
    );
});

/* eslint-disable max-lines-per-function -- fixture-heavy scenarios */
describe('getAccuracyOverview', () => {
  it('scores the database from the stored rows, weighted by users on CVs', async () => {
    h.db.tournamentAudit.findMany.mockResolvedValue([
      audit(1, 100, { usersAffected: 3 }),
      audit(2, 50),
      audit(3, 80, { computedAt: hoursAgo(30) }),
    ]);
    const o = await getAccuracyOverview();
    // (100×4 + 50 + 80) / 6 = 88.3; plain mean 76.7.
    expect(o).toMatchObject({ weighted: 88, unweighted: 77, n: 3, onCvs: 1 });
    expect(o.bands).toEqual({ good: 1, check: 1, rescrape: 1 });
    // 5 tournaments: 2 never audited, 1 audited 30 h ago.
    expect(o.stale).toBe(3);
    expect(o.tournaments).toBe(5);
    expect(o.lowest.map((r) => r.score)).toEqual([50, 80, 100]);
    expect(o.lowest[0]).toMatchObject({ id: '2', name: 'T2', usersAffected: 0 });
    // The tab link is the public base, never the stored private URL.
    expect(o.lowest[0]!.tabUrl).toBe('https://x.calicotab.com/t2/');
  });

  it('lists failing checks, and suggests the deduped pieces of failing and warning checks', async () => {
    const checks = [
      { code: 'rounds_complete', status: 'fail', detail: '', pieces: [piece('3'), piece('4')] },
      { code: 'rooms_consistent', status: 'warn', detail: '', pieces: [piece('3'), piece('5')] },
      { code: 'motions', status: 'pass', detail: '', pieces: [piece('9')] },
      { code: 'user_reports', status: 'warn', detail: '', pieces: [] },
      { code: 'not_a_check', status: 'fail', detail: '', pieces: [piece('7')] },
    ];
    h.db.tournamentAudit.findMany.mockResolvedValue([
      audit(1, 40, { checks }),
      audit(2, 90, { checks: [checks[0]] }),
    ]);
    const o = await getAccuracyOverview();
    const row = o.lowest[0]!;
    expect(row.failed).toEqual([
      { code: 'rounds_complete', label: 'Rounds complete' },
      { code: 'user_reports', label: 'User reports' },
    ]);
    expect(row.suggested.map((p) => p.key)).toEqual(['3', '4', '5']);
    expect(row.suggested[0]).toEqual(piece('3'));
    expect(o.failingByCheck).toEqual([
      { code: 'rounds_complete', label: 'Rounds complete', count: 2 },
      { code: 'user_reports', label: 'User reports', count: 1 },
    ]);
  });

  it("caps the suggestion at the rescrape route's 40 pieces", async () => {
    const pieces = Array.from({ length: 60 }, (_, i) => piece(String(i + 1)));
    h.db.tournamentAudit.findMany.mockResolvedValue([
      audit(1, 0, { checks: [{ code: 'rounds_complete', status: 'fail', detail: '', pieces }] }),
    ]);
    expect((await getAccuracyOverview()).lowest[0]!.suggested).toHaveLength(40);
  });

  it('counts the tournaments each open question decided, most suspect first', async () => {
    const assumed = {
      code: 'champion',
      status: 'pass',
      detail: '',
      pieces: [],
      assumptions: ['no_open_bracket_champion', 'unknown_rule'],
    };
    h.db.tournamentAudit.findMany.mockResolvedValue([
      audit(1, 95, { checks: [assumed] }),
      audit(2, 60, { checks: [assumed] }),
      audit(3, 70, { checks: [{ ...assumed, assumptions: undefined }] }),
    ]);
    const [q] = (await getAccuracyOverview()).openQuestions;
    expect(q).toMatchObject({
      code: 'no_open_bracket_champion',
      title: 'Champion when a tab has no Open bracket',
      status: 'On hold — owner to decide',
      count: 2,
    });
    expect(q!.tournaments).toEqual([
      { id: '2', name: 'T2', tabUrl: 'https://x.calicotab.com/t2/' },
      { id: '1', name: 'T1', tabUrl: 'https://x.calicotab.com/t1/' },
    ]);
  });

  it('nothing audited: no score, and every tournament is due', async () => {
    h.db.tournamentAudit.findMany.mockResolvedValue([]);
    const o = await getAccuracyOverview();
    expect(o).toMatchObject({ weighted: null, n: 0, stale: 5, lowest: [] });
    expect(o.openQuestions[0]!.count).toBe(0);
  });
});

describe('parseChecks', () => {
  it('reads what it can and drops what it cannot', () => {
    expect(parseChecks(null)).toEqual([]);
    expect(parseChecks({ code: 'champion' })).toEqual([]);
    const parsed = parseChecks([
      'junk',
      { code: 'champion', status: 'maybe', pieces: [] },
      {
        code: 'panels',
        status: 'fail',
        pieces: [
          { kind: 'round', key: '2', label: 'R2', url: 'https://h/s/privateurls/k/' },
          { kind: 'nope', key: '1' },
          { kind: 'team', key: '' },
        ],
      },
    ]);
    expect(parsed).toEqual([
      {
        code: 'panels',
        status: 'fail',
        // No stored sentence reads as an empty one.
        detail: '',
        assumptions: [],
        pieces: [
          // A private URL stored by mistake is made public again here.
          { kind: 'round', key: '2', label: 'R2', url: 'https://h/s/' },
          { kind: 'team', key: '', label: 'team', url: null },
        ],
      },
    ]);
  });
});

describe('rescrapeAction', () => {
  it('sends the suggested pieces, and says how many', () => {
    const a = rescrapeAction([piece('3'), { ...piece(''), kind: 'team', label: 'Team tab' }]);
    expect(a.body).toEqual({
      pieces: [
        { kind: 'round', key: '3' },
        { kind: 'team', key: '' },
      ],
    });
    expect(a.label).toBe('Re-scrape suggested (2)');
    expect(a.busyLabel).toBe('Re-scraping…');
    expect(a.name('Oxford IV')).toBe('Re-scrape suggested (2) for Oxford IV');
  });
  it('with nothing suggested, re-scrapes the failed pieces', () => {
    const a = rescrapeAction([]);
    expect(a.body).toEqual({ pieces: 'failed' });
    expect(a.label).toBe('Re-scrape all failed');
    expect(a.name('Oxford IV')).toBe('Re-scrape all failed for Oxford IV');
  });
});

describe('auditFailureMessage (UX-23)', () => {
  it('words every code the audit route answers with', () => {
    const f = (error: string, status: number) => auditFailureMessage({ error, status });
    expect(f('forbidden', 403)).toMatch(/not an admin/);
    expect(f('server_error', 500)).toBe('Something went wrong on our side. Try again in a minute.');
    expect(f('bad_request', 400)).not.toContain('bad_request');
    expect(f('unauthorized', 401)).not.toContain('unauthorized');
  });
});
