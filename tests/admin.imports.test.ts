import { beforeEach, describe, expect, it, vi } from 'vitest';

// Task R6: the Imports tab's read model. Its default view must be the very
// set the summary line counts as "Imports to review" (the Inbox's), stored
// tournaments are listed apart as "Covered by stored copy", rows are one per
// tournament across users with the users named, and a mark takes a group out
// of the default view until its failure changes.

type MarkRow = { fingerprint: string; checkedBy: string; checkedAt: Date; note: null };

const h = vi.hoisted(() => ({
  db: {
    ingestJob: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    tournament: { findMany: vi.fn() },
    tournamentAudit: { findMany: vi.fn() },
    cvErrorReport: { findMany: vi.fn() },
  },
  marks: new Map<string, Map<string, MarkRow>>(),
  matchJobs: vi.fn(),
  groups: vi.fn(),
  tabs: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: h.db }));
vi.mock('@/lib/admin/adminChecks', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/adminChecks')>()),
  marksFor: async (kind: string, subjects: string[]) =>
    new Map([...(h.marks.get(kind) ?? new Map())].filter(([s]) => subjects.includes(s))),
}));
vi.mock('@/lib/admin/scrapeHealth', () => ({ matchJobs: h.matchJobs }));
vi.mock('@/lib/admin/parserWarnings', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/parserWarnings')>()),
  loadWarningGroups: h.groups,
}));
vi.mock('@/lib/admin/tabStatus', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/tabStatus')>()),
  loadTabStates: h.tabs,
}));

const { listImports, readImportsFilter, IMPORTS_PER_PAGE } =
  await import('@/lib/admin/importsList');
const { countInbox } = await import('@/lib/admin/inbox');

const NOW = new Date('2026-10-31T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

/** `[job id, user id]`, its URL and how long ago it last failed. */
const job = ([id, userId]: [string, string], url: string, days = 1) => ({
  id,
  userId,
  url,
  attempts: 3,
  lastError: 'HTTP 404 Not Found',
  finishedAt: daysAgo(days),
  scheduledAt: daysAgo(days),
});
const STORED = { id: '5', name: 'Oxford IV 2025', scrapedAt: daysAgo(3) };

beforeEach(() => {
  h.marks = new Map();
  for (const model of Object.values(h.db)) model.findMany.mockReset().mockResolvedValue([]);
  h.db.user.findMany.mockResolvedValue([
    { id: 'u1', email: 'maya@example.com' },
    { id: 'u2', email: 'noor@example.com' },
  ]);
  h.db.tournament.findMany.mockResolvedValue([
    {
      id: 5n,
      name: STORED.name,
      sourceUrlRaw: 'https://oxiv.calicotab.com/oxiv2025/privateurls/k3y/',
    },
  ]);
  h.matchJobs.mockReset().mockResolvedValue({ stored: new Map(), ambiguous: new Map() });
  h.groups.mockReset().mockResolvedValue([]);
  h.tabs
    .mockReset()
    .mockImplementation(
      async (ids: string[]) =>
        new Map(ids.map((id) => [id, { state: 'loaded', tournamentId: id, errors: [] }])),
    );
});

/** j1 and j2 fail on one unstored tournament (two users); j3 is stored. */
function twoKinds() {
  h.db.ingestJob.findMany.mockResolvedValue([
    job(['j1', 'u1'], 'https://new.calicotab.com/new2026/privateurls/aaa/'),
    job(['j2', 'u2'], 'https://new.calicotab.com/new2026/privateurls/bbb/', 2),
    job(['j3', 'u1'], 'https://oxiv.calicotab.com/oxiv2025/privateurls/ccc/', 3),
  ]);
  h.matchJobs.mockResolvedValue({ stored: new Map([['j3', STORED]]), ambiguous: new Map() });
}

describe('the default view (failing)', () => {
  it('lists unstored tournaments only, one row per host and slug with its users', async () => {
    twoKinds();
    const list = await listImports({ filter: 'failing', page: 1 });
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({
      key: 'new.calicotab.com/new2026',
      section: 'failing',
      name: 'new.calicotab.com/new2026',
      tabUrl: 'https://new.calicotab.com/new2026/',
      attempts: 6,
      users: ['maya@example.com', 'noor@example.com'],
      moreUsers: 0,
      jobIds: ['j1', 'j2'],
    });
    expect(list.rows[0]!.tab.state).toBe('missing');
    expect(JSON.stringify(list)).not.toMatch(/privateurls\/(aaa|bbb|ccc)/);
  });

  it('counts exactly what the summary line calls Imports to review', async () => {
    twoKinds();
    const list = await listImports({ filter: 'failing', page: 1 });
    const inbox = await countInbox(NOW);
    expect(list.counts.failing).toBe(inbox.import);
    expect(list.total).toBe(inbox.import);
  });

  it('lists a stored tournament apart, as covered by the stored copy, never as failing', async () => {
    twoKinds();
    const covered = await listImports({ filter: 'covered', page: 1 });
    expect(covered.counts).toEqual({ failing: 1, covered: 1, checked: 0 });
    expect(covered.rows).toHaveLength(1);
    expect(covered.rows[0]).toMatchObject({
      key: 'stored:5',
      section: 'covered',
      name: 'Oxford IV 2025',
      tournamentId: '5',
      tabUrl: 'https://oxiv.calicotab.com/oxiv2025/',
      fingerprint: null,
      scrapedAt: STORED.scrapedAt,
    });
  });
});

describe('marks', () => {
  const subject = 'new.calicotab.com/new2026';

  it('takes a marked group out of the default view and into Checked', async () => {
    twoKinds();
    const failing = await listImports({ filter: 'failing', page: 1 });
    const fingerprint = failing.rows[0]!.fingerprint!;
    h.marks.set(
      'import',
      new Map([
        [subject, { fingerprint, checkedBy: 'owner@x.org', checkedAt: daysAgo(1), note: null }],
      ]),
    );
    const after = await listImports({ filter: 'failing', page: 1 });
    expect(after.rows).toHaveLength(0);
    expect(after.counts).toEqual({ failing: 0, covered: 1, checked: 1 });
    const checked = await listImports({ filter: 'checked', page: 1 });
    expect(checked.rows[0]).toMatchObject({
      key: subject,
      checked: { by: 'owner@x.org' },
      changed: false,
    });
  });

  it('brings a group back, labelled changed, when its failure is no longer the one checked', async () => {
    twoKinds();
    h.marks.set(
      'import',
      new Map([
        [
          subject,
          {
            fingerprint: '0123456789abcdef',
            checkedBy: 'o@x.org',
            checkedAt: daysAgo(1),
            note: null,
          },
        ],
      ]),
    );
    const list = await listImports({ filter: 'failing', page: 1 });
    expect(list.rows[0]).toMatchObject({ key: subject, changed: true, checked: null });
  });
});

describe('count equality with the Inbox (held and changed marks)', () => {
  const subject = 'new.calicotab.com/new2026';
  const markWith = (fingerprint: string) =>
    h.marks.set(
      'import',
      new Map([
        [subject, { fingerprint, checkedBy: 'o@x.org', checkedAt: daysAgo(1), note: null }],
      ]),
    );

  it('a held mark leaves both counts at zero', async () => {
    twoKinds();
    const open = await listImports({ filter: 'failing', page: 1 });
    markWith(open.rows[0]!.fingerprint!);
    const list = await listImports({ filter: 'failing', page: 1 });
    expect(list.counts.failing).toBe(0);
    expect(list.counts.failing).toBe((await countInbox(NOW)).import);
  });

  it('a changed mark keeps both counts at one', async () => {
    twoKinds();
    markWith('0123456789abcdef');
    const list = await listImports({ filter: 'failing', page: 1 });
    expect(list.counts.failing).toBe(1);
    expect(list.counts.failing).toBe((await countInbox(NOW)).import);
  });
});

describe('Retry all', () => {
  it('names every job of the failing groups, none of the covered or checked ones', async () => {
    twoKinds();
    const failing = await listImports({ filter: 'failing', page: 1 });
    expect(failing.retryJobIds).toEqual(['j1', 'j2']);
    expect((await listImports({ filter: 'covered', page: 1 })).retryJobIds).toEqual([]);
  });
});

describe('all, paging and the filter word', () => {
  it('all lists failing first, then checked, then covered', async () => {
    twoKinds();
    const list = await listImports({ filter: 'all', page: 1 });
    expect(list.rows.map((r) => r.section)).toEqual(['failing', 'covered']);
  });

  it('pages 20 a time and clamps a page past the end', async () => {
    h.db.ingestJob.findMany.mockResolvedValue(
      Array.from({ length: 45 }, (_, i) =>
        job([`j${i}`, 'u1'], `https://t${i}.calicotab.com/t${i}/`),
      ),
    );
    const last = await listImports({ filter: 'failing', page: 99 });
    expect(IMPORTS_PER_PAGE).toBe(20);
    expect(last).toMatchObject({ total: 45, pages: 3, page: 3 });
    expect(last.rows).toHaveLength(5);
  });

  it('reads ?imports= and falls back to failing', () => {
    expect(readImportsFilter('covered')).toBe('covered');
    expect(readImportsFilter(['checked'])).toBe('checked');
    expect(readImportsFilter('nonsense')).toBe('failing');
    expect(readImportsFilter(undefined)).toBe('failing');
  });
});
