import { beforeEach, describe, expect, it, vi } from 'vitest';

// Task R2: the Inbox, one list of what needs the owner. Each kind's
// candidates come from the read models already built (audits, CV reports,
// failed jobs, parser warning groups); these tests fake those reads and pin
// what reaches the list: one item per tournament, a stored tournament's
// failed import left out, marks honoured until the data changes, and the
// order, paging and counts the tab shows.

type MarkRow = { fingerprint: string; checkedBy: string; checkedAt: Date; note: null };

const h = vi.hoisted(() => ({
  db: {
    tournamentAudit: { findMany: vi.fn() },
    tournament: { findMany: vi.fn() },
    cvErrorReport: { findMany: vi.fn() },
    ingestJob: { findMany: vi.fn() },
    reviewFlag: { findMany: vi.fn() },
  },
  marks: new Map<string, Map<string, MarkRow>>(),
  matchJobs: vi.fn(),
  groups: vi.fn(),
  tournamentsOf: vi.fn(),
  tabs: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: h.db }));
// The ignored-tournament filter has its own tests (admin.inbox.ignored.test.ts).
vi.mock('@/lib/admin/inboxIgnored', () => ({
  withoutIgnoredReports: async <T>(x: T[]) => x,
  withoutIgnoredParserGroups: async <T>(x: T[]) => x,
}));
vi.mock('@/lib/admin/adminChecks', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/adminChecks')>()),
  marksFor: async (kind: string, subjects: string[]) =>
    new Map([...(h.marks.get(kind) ?? new Map())].filter(([s]) => subjects.includes(s))),
}));
vi.mock('@/lib/admin/scrapeHealth', () => ({ matchJobs: h.matchJobs }));
vi.mock('@/lib/admin/parserWarnings', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/parserWarnings')>()),
  loadWarningGroups: h.groups,
  tournamentsOf: h.tournamentsOf,
}));
vi.mock('@/lib/admin/tabStatus', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/tabStatus')>()),
  loadTabStates: h.tabs,
}));

const { listInbox, CANDIDATE_CAP, INBOX_PER_PAGE } = await import('@/lib/admin/inbox');
const { fingerprintOf } = await import('@/lib/admin/adminChecks');

const NOW = new Date('2026-10-31T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const check = (code: string, status: string, detail: string) => ({
  code,
  status,
  detail,
  pieces: [] as unknown[],
});
/** `[tournament id, users affected]`, the audit's checks, and how old it is. */
const audit = ([id, users]: [number, number], checks: unknown[], days = 1) => ({
  tournamentId: BigInt(id),
  usersAffected: users,
  computedAt: daysAgo(days),
  checks,
});
/** `[job id, user id]`, the job's URL, and how long ago it last failed. */
const job = ([id, userId]: [string, string], url: string, days = 1) => ({
  id,
  userId,
  url,
  attempts: 3,
  lastError: 'HTTP 404 Not Found',
  finishedAt: daysAgo(days),
  scheduledAt: daysAgo(days),
});
const group = (headline: string, count = 3) => ({
  key: `parseTabs|${headline}`,
  parserName: 'parseTabs',
  headline,
  count,
  latestAt: daysAgo(2),
  sample: headline,
  urls: ['https://p.calicotab.com/p/'],
});
const mark = (kind: string, subject: string, fingerprint: string) => {
  const m = h.marks.get(kind) ?? new Map<string, MarkRow>();
  m.set(subject, { fingerprint, checkedBy: 'owner@x.org', checkedAt: daysAgo(1), note: null });
  h.marks.set(kind, m);
};

beforeEach(() => {
  h.marks = new Map();
  for (const model of Object.values(h.db)) model.findMany.mockReset().mockResolvedValue([]);
  h.db.tournament.findMany.mockImplementation(
    async ({ where }: { where: { id: { in: bigint[] } } }) =>
      where.id.in.map((id) => ({
        id,
        name: `T${id}`,
        sourceUrlRaw: `https://t${id}.calicotab.com/t${id}/privateurls/s3cret/`,
      })),
  );
  h.matchJobs.mockReset().mockResolvedValue({ stored: new Map(), ambiguous: new Map() });
  h.groups.mockReset().mockResolvedValue([]);
  h.tournamentsOf.mockReset().mockImplementation(async (gs: unknown[]) => gs.map(() => []));
  h.tabs
    .mockReset()
    .mockImplementation(
      async (ids: string[]) =>
        new Map(ids.map((id) => [id, { state: 'loaded', tournamentId: id, errors: [] }])),
    );
});

describe('check items', () => {
  it('lists one item per tournament, its first failing detail plus how many more; warnings stay out', async () => {
    h.db.tournamentAudit.findMany.mockResolvedValue([
      audit(
        [7, 4],
        [
          check('motions', 'warn', 'One round has no motion.'),
          {
            ...check('champion', 'fail', 'No champion found.'),
            pieces: [
              {
                kind: 'break',
                key: 'open',
                label: 'Open break',
                url: 'https://t7.calicotab.com/t7/privateurls/k/',
              },
            ],
          },
          check('panels', 'pass', ''),
          check('rooms_consistent', 'warn', 'R4 has one room fewer.'),
          check('motions', 'fail', 'R2 has no motion.'),
        ],
      ),
    ]);
    const { rows, counts } = await listInbox({ page: 1, now: NOW });
    expect(rows).toHaveLength(1);
    expect(counts.check).toBe(1);
    const [item] = rows;
    expect(item).toMatchObject({
      key: 'check:7',
      kind: 'check',
      summary: 'No champion found.',
      more: 1,
      usersAffected: 4,
      severity: 'fail',
      changedSinceChecked: false,
      reviewFlag: null,
      tournament: { id: '7', name: 'T7', tabUrl: 'https://t7.calicotab.com/t7/', status: 'loaded' },
    });
    expect(item!.fix).toEqual({
      type: 'rescrape',
      tournamentId: '7',
      pieces: [
        { kind: 'break', key: 'open', label: 'Open break', url: 'https://t7.calicotab.com/t7/' },
      ],
    });
    expect(item!.markItems.map((m) => m.subject)).toEqual(['7:champion', '7:motions']);
    // Each check can be set aside for review on its own (the mark subject is the flag id).
    expect(item!.flagItems).toEqual([
      { source: 'audit_check', sourceId: '7:champion' },
      { source: 'audit_check', sourceId: '7:motions' },
    ]);
    expect(JSON.stringify(rows)).not.toContain('s3cret');
  });
});

describe('check items: the read and marks', () => {
  it('reads only audits with a failing check, at most 1,000', async () => {
    await listInbox({ page: 1, now: NOW });
    const args = h.db.tournamentAudit.findMany.mock.calls[0]![0];
    expect(CANDIDATE_CAP).toBe(1000);
    expect(args.take).toBe(1000);
    expect(args.where).toEqual({
      tournament: { ignored: false },
      OR: [
        { checks: { array_contains: [{ status: 'fail' }] } },
        { checks: { array_contains: [{ code: 'user_reports', status: 'warn' }] } },
      ],
    });
  });

  it('leaves out a marked check, and keeps one whose finding changed since', async () => {
    const same = check('rooms_consistent', 'fail', 'R11 has one room.');
    h.db.tournamentAudit.findMany.mockResolvedValue([
      audit([1, 2], [same]),
      audit([2, 2], [check('rooms_consistent', 'fail', 'R3 has two rooms more.')]),
    ]);
    mark('check', '1:rooms_consistent', fingerprintOf('check', same));
    mark(
      'check',
      '2:rooms_consistent',
      fingerprintOf('check', { status: 'fail', detail: 'R3 has one room more.' }),
    );
    const { rows } = await listInbox({ page: 1, now: NOW });
    expect(rows.map((r) => r.key)).toEqual(['check:2']);
    expect(rows[0]!.changedSinceChecked).toBe(true);
  });

  it('never lists a tournament whose checks all pass (a mark the audit applied is a pass)', async () => {
    h.db.tournamentAudit.findMany.mockResolvedValue([
      audit(
        [3, 9],
        [
          {
            ...check('panels', 'pass', 'Checked by owner.'),
            checkedBy: 'o@x',
            checkedAt: NOW.toISOString(),
            wasStatus: 'warn',
          },
        ],
      ),
    ]);
    expect((await listInbox({ page: 1, now: NOW })).rows).toEqual([]);
  });
});

describe('import items', () => {
  it("leaves out a stored tournament's failed import", async () => {
    h.db.ingestJob.findMany.mockResolvedValue([
      job(['j1', 'u1'], 'https://s.calicotab.com/s/privateurls/k1/'),
    ]);
    h.matchJobs.mockResolvedValue({
      stored: new Map([['j1', { id: '5', name: 'Stored', scrapedAt: NOW }]]),
      ambiguous: new Map(),
    });
    const { rows, counts } = await listInbox({ page: 1, now: NOW });
    expect(rows).toEqual([]);
    expect(counts.import).toBe(0);
  });

  it('excludes stored tournaments before the cap, reading further pages for unstored failures', async () => {
    const storedPage = Array.from({ length: CANDIDATE_CAP }, (_, i) =>
      job([`s${i}`, 'u1'], `https://s${i}.calicotab.com/s${i}/privateurls/k/`),
    );
    const lastPage = [job(['late', 'u2'], 'https://late.calicotab.com/late/privateurls/k/')];
    h.db.ingestJob.findMany.mockResolvedValueOnce(storedPage).mockResolvedValueOnce(lastPage);
    h.matchJobs.mockImplementation(async (jobs: Array<{ id: string }>) => ({
      stored: new Map(
        jobs
          .filter((j) => j.id.startsWith('s'))
          .map((j) => [j.id, { id: '5', name: 'Stored', scrapedAt: NOW }]),
      ),
      ambiguous: new Map(),
    }));
    const { rows, counts } = await listInbox({ page: 1, now: NOW });
    expect(counts.import).toBe(1);
    expect(rows.map((r) => r.key)).toEqual(['import:late.calicotab.com/late']);
  });

  it('groups jobs per host and slug, counting distinct users; Retry covers them all', async () => {
    h.db.ingestJob.findMany.mockResolvedValue([
      job(['j1', 'u1'], 'https://n.calicotab.com/new/privateurls/k1/', 3),
      job(['j2', 'u2'], 'https://n.calicotab.com/new/privateurls/k2/', 1),
      job(['j3', 'u2'], 'https://N.calicotab.com/new/', 2),
      job(['j4', 'u3'], 'https://a.calicotab.com/amb/privateurls/k4/', 1),
    ]);
    h.matchJobs.mockResolvedValue({ stored: new Map(), ambiguous: new Map([['j4', 2]]) });
    const { rows } = await listInbox({ page: 1, now: NOW });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const grouped = byKey.get('import:n.calicotab.com/new')!;
    expect(grouped).toMatchObject({
      usersAffected: 2,
      severity: 'fail',
      age: daysAgo(3),
      fix: { type: 'retry', jobIds: ['j1', 'j2', 'j3'] },
      tournament: { id: null, tabUrl: 'https://n.calicotab.com/new/', status: 'missing' },
    });
    expect(byKey.get('import:a.calicotab.com/amb')!.tournament!.status).toBe('check');
    expect(JSON.stringify(rows)).not.toContain('privateurls');
  });
});

describe('import items: the scan ceiling', () => {
  it('stops the unstored-job scan at the page ceiling when every page is stored', async () => {
    const mk = (n: number) =>
      Array.from({ length: CANDIDATE_CAP }, (_, i) =>
        job([`s${n}-${i}`, 'u1'], `https://s${n}${i}.calicotab.com/s${n}${i}/privateurls/k/`),
      );
    // Fails fast if the scan ever reads an eleventh page, rather than
    // walking an endless table (and hanging CI).
    h.db.ingestJob.findMany.mockImplementation(async (args: { skip: number }) => {
      if (args.skip / CANDIDATE_CAP >= 10) throw new Error('read past the page ceiling');
      return mk(args.skip / CANDIDATE_CAP);
    });
    h.matchJobs.mockImplementation(async (jobs: Array<{ id: string }>) => ({
      stored: new Map(jobs.map((j) => [j.id, { id: '5', name: 'Stored', scrapedAt: NOW }])),
      ambiguous: new Map(),
    }));
    const { counts, truncated } = await listInbox({ page: 1, now: NOW });
    expect(counts.import).toBe(0);
    expect(h.db.ingestJob.findMany).toHaveBeenCalledTimes(10);
    // Older failures were not scanned, and the list says so.
    expect(truncated).toBe(true);
  });

  it('is not truncated when the jobs ran out before the ceiling', async () => {
    h.db.ingestJob.findMany.mockResolvedValue([]);
    const { truncated } = await listInbox({ page: 1, now: NOW });
    expect(truncated).toBe(false);
  });
});

describe('report and parser items', () => {
  it('lists open and acknowledged reports, leaving out a marked one', async () => {
    h.db.cvErrorReport.findMany.mockResolvedValue([
      {
        id: 'r1',
        status: 'open',
        tournamentIds: ['8'],
        categories: ['wrong_teammate'],
        comment: '',
        createdAt: daysAgo(4),
        userId: 'u1',
      },
      {
        id: 'r2',
        status: 'acknowledged',
        tournamentIds: [],
        categories: [],
        comment: 'see https://x.calicotab.com/x/privateurls/zz/',
        createdAt: daysAgo(2),
        userId: 'u2',
      },
    ]);
    mark('report', 'r2', fingerprintOf('report', { status: 'acknowledged' }));
    h.db.reviewFlag.findMany.mockResolvedValue([
      { source: 'cv_report', sourceId: 'r1', priority: 'high' },
    ]);
    const { rows } = await listInbox({ page: 1, now: NOW });
    expect(rows.map((r) => r.key)).toEqual(['report:r1']);
    expect(rows[0]).toMatchObject({ reviewFlag: { priority: 'high' }, tournament: { id: '8' } });
    expect(rows[0]!.fix.type).toBe('open');
    const args = h.db.cvErrorReport.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({ status: { in: ['open', 'acknowledged'] } });
    expect(args.take).toBe(1000);
  });

  it('lists parser problem groups only, never informational notes', async () => {
    h.groups.mockResolvedValue([
      group('timing: competition likely finished (private URL email is older than 30 days)', 184),
      group('nav: breakTabs not found (optional)', 90),
      group('nav: teamTab constructed as fallback', 40),
      group('tabs: team tab not released', 30),
      group(
        'nav: limited tab visibility may be intentional (e.g., schools/child-protection privacy settings)',
        20,
      ),
      group('parse: round https://p.calicotab.com/p/results/round/2/ → 0 results', 5),
      group('fetch: participants HTTP 403', 6),
      group('tabs: team tab released to top 8 only', 5),
      group('fetch: team HTTP 403', 4),
      group('nav: resultsRounds not found', 3),
    ]);
    const { rows, counts } = await listInbox({ page: 1, now: NOW });
    expect(counts.parser).toBe(3);
    expect(rows.map((r) => r.summary)).toEqual([
      expect.stringContaining('→ 0 results'),
      expect.stringContaining('fetch: team HTTP 403'),
      expect.stringContaining('nav: resultsRounds not found'),
    ]);
    expect(rows.map((r) => r.severity)).toEqual(['fail', 'fail', 'warn']);
  });
});

describe('order, paging and counts', () => {
  it('orders check items by users affected, then oldest first', async () => {
    h.db.tournamentAudit.findMany.mockResolvedValue([
      audit([1, 1], [check('motions', 'fail', 'a')], 9),
      audit([2, 5], [check('motions', 'fail', 'b')], 1),
      audit([3, 1], [check('champion', 'fail', 'c')], 1),
      audit([4, 1], [check('champion', 'fail', 'd')], 5),
      audit([5, 5], [check('champion', 'fail', 'e')], 1),
    ]);
    const { rows } = await listInbox({ page: 1, now: NOW });
    expect(rows.map((r) => r.key)).toEqual(['check:2', 'check:5', 'check:1', 'check:4', 'check:3']);
  });

  it('pages twenty at a time, clamping the page, counting every kind whatever the filter', async () => {
    h.db.tournamentAudit.findMany.mockResolvedValue(
      Array.from({ length: 45 }, (_, i) =>
        audit([i + 1, 0], [check('motions', 'fail', 'x')], 45 - i),
      ),
    );
    h.groups.mockResolvedValue([group('parse: speakerTab → 0 rows')]);
    const first = await listInbox({ page: 1, now: NOW });
    expect(INBOX_PER_PAGE).toBe(20);
    expect(first).toMatchObject({ total: 46, page: 1, pages: 3 });
    expect(first.rows).toHaveLength(20);
    const last = await listInbox({ page: 99, now: NOW });
    expect(last.page).toBe(3);
    expect(last.rows).toHaveLength(6);
    const parserOnly = await listInbox({ page: 1, kinds: ['parser'], now: NOW });
    expect(parserOnly).toMatchObject({ total: 1, pages: 1 });
    expect(parserOnly.counts).toEqual({ check: 45, report: 0, import: 0, parser: 1 });
  });
});
