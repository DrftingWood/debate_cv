import { beforeEach, describe, expect, it, vi } from 'vitest';

// Task R6: the Parser tab's read model. The default view lists problems only
// (never an informational headline), its count is the Inbox's parser figure,
// the info view holds the expected states, and a mark moves a problem group
// into Checked until its count jumps into a new bucket.

type MarkRow = { fingerprint: string; checkedBy: string; checkedAt: Date; note: null };

const h = vi.hoisted(() => ({
  db: {
    tournamentAudit: { findMany: vi.fn() },
    cvErrorReport: { findMany: vi.fn() },
    ingestJob: { findMany: vi.fn() },
  },
  marks: new Map<string, Map<string, MarkRow>>(),
  groups: vi.fn(),
  views: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: h.db }));
vi.mock('@/lib/admin/adminChecks', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/adminChecks')>()),
  marksFor: async (kind: string, subjects: string[]) =>
    new Map([...(h.marks.get(kind) ?? new Map())].filter(([s]) => subjects.includes(s))),
}));
vi.mock('@/lib/admin/scrapeHealth', () => ({
  matchJobs: vi.fn(async () => ({ stored: new Map(), ambiguous: new Map() })),
}));
vi.mock('@/lib/admin/parserWarnings', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/parserWarnings')>()),
  loadWarningGroups: h.groups,
  warningViews: h.views,
}));

const { listParser, readParserFilter } = await import('@/lib/admin/parserList');
const { countInbox } = await import('@/lib/admin/inbox');
const { fingerprintOf } = await import('@/lib/admin/adminChecks');

const NOW = new Date('2026-10-31T12:00:00Z');
const group = (headline: string, count = 3) => ({
  key: `parseTabs|${headline}`,
  parserName: 'parseTabs',
  headline,
  count,
  latestAt: NOW,
  sample: headline,
  urls: [],
});
const PROBLEM = 'parse: round 3 -> 0 results';
const INFO = 'timing: competition likely finished';

beforeEach(() => {
  h.marks = new Map();
  for (const model of Object.values(h.db)) model.findMany.mockReset().mockResolvedValue([]);
  h.groups.mockReset().mockResolvedValue([group(INFO, 184), group(PROBLEM, 3)]);
  h.views
    .mockReset()
    .mockImplementation(async (gs: ReturnType<typeof group>[]) =>
      gs.map(({ urls: _u, ...g }) => ({ ...g, tournaments: [], moreTournaments: 0 })),
    );
});

describe('the default view (problems)', () => {
  it('leaves informational headlines out, however busy they are', async () => {
    const list = await listParser({ filter: 'problems', page: 1, now: NOW });
    expect(list.rows.map((r) => r.headline)).toEqual([PROBLEM]);
    expect(list.counts).toEqual({ problems: 1, info: 1, checked: 0 });
  });

  it('counts what the Inbox counts as parser items', async () => {
    const list = await listParser({ filter: 'problems', page: 1, now: NOW });
    expect(list.counts.problems).toBe((await countInbox(NOW)).parser);
  });

  it('carries the fingerprint a mark stores, and none on informational groups', async () => {
    const problems = await listParser({ filter: 'problems', page: 1, now: NOW });
    expect(problems.rows[0]!.fingerprint).toBe(fingerprintOf('parser', { count: 3 }));
    const info = await listParser({ filter: 'info', page: 1, now: NOW });
    expect(info.rows.map((r) => [r.headline, r.fingerprint])).toEqual([[INFO, null]]);
  });
});

describe('marks', () => {
  const key = `parseTabs|${PROBLEM}`;
  const marked = (fingerprint: string) =>
    h.marks.set(
      'parser',
      new Map([[key, { fingerprint, checkedBy: 'owner@x.org', checkedAt: NOW, note: null }]]),
    );

  it('moves a marked group into Checked, with who marked it', async () => {
    marked(fingerprintOf('parser', { count: 3 }));
    const problems = await listParser({ filter: 'problems', page: 1, now: NOW });
    expect(problems.rows).toHaveLength(0);
    const checked = await listParser({ filter: 'checked', page: 1, now: NOW });
    expect(checked.rows[0]).toMatchObject({
      headline: PROBLEM,
      checked: { by: 'owner@x.org' },
    });
  });

  it('brings it back as changed when its count moved into a new bucket', async () => {
    marked(fingerprintOf('parser', { count: 3 }));
    h.groups.mockResolvedValue([group(PROBLEM, 40)]);
    const list = await listParser({ filter: 'problems', page: 1, now: NOW });
    expect(list.rows[0]).toMatchObject({ headline: PROBLEM, changed: true, checked: null });
  });
});

describe('the filter word', () => {
  it('reads ?parser= and falls back to problems', () => {
    expect(readParserFilter('info')).toBe('info');
    expect(readParserFilter(['checked'])).toBe('checked');
    expect(readParserFilter('x')).toBe('problems');
  });
});
