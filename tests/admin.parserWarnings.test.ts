import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

// Task 5d: parser warnings as a paged ledger. The read is bounded (the
// newest 2,000 runs with warnings in the last 30 days), grouped in memory
// by `[parser] headline`, and each group lists the tournaments its runs
// read, matched by host and slug: loaded, partly, not loaded, or "? Check"
// when two stored rows share the address (never a false "✗ Not loaded").

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const {
  groupWarnings,
  listParserWarnings,
  warningHeadline,
  WARNING_RUN_CAP,
  WARNINGS_PER_PAGE,
  WARNING_WINDOW_DAYS,
} = await import('@/lib/admin/parserWarnings');

const KEY = 'k3yS3cr3t';
const NOW = new Date('2026-10-31T12:00:00Z');
const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const priv = (host: string, slug: string) =>
  `https://${host}.calicotab.com/${slug}/privateurls/${KEY}/`;

const run = (parserName: string, warnings: string[], url: string) => ({
  parserName,
  warnings,
  createdAt: at(1),
  sourceDocument: { url },
});
const ago = (r: ReturnType<typeof run>, hours: number) => ({ ...r, createdAt: at(hours) });

beforeEach(() => {
  resetPrismaMock();
  prismaMock.parserRun.findMany.mockResolvedValue([]);
  prismaMock.tournament.findMany.mockResolvedValue([]);
  prismaMock.scrapePiece.findMany.mockResolvedValue([]);
});

describe('grouping', () => {
  it('takes the headline before " — "', () => {
    expect(warningHeadline('No speaker table — at https://x/y')).toBe('No speaker table');
    expect(warningHeadline('Plain warning')).toBe('Plain warning');
  });

  it('groups by [parser] headline, counting each warning, busiest first', () => {
    const groups = groupWarnings([
      ago(run('parseTabs', ['No speaker table — url a'], 'https://a.calicotab.com/a/'), 1),
      ago(run('parseTabs', ['No speaker table — url b'], 'https://b.calicotab.com/b/'), 5),
      ago(run('parseNav', ['No speaker table — url c'], 'https://c.calicotab.com/c/'), 2),
      ago(run('parseTabs', ['Odd row'], 'https://a.calicotab.com/a/'), 3),
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      'parseTabs|No speaker table',
      'parseNav|No speaker table',
      'parseTabs|Odd row',
    ]);
    expect(groups[0]).toMatchObject({
      parserName: 'parseTabs',
      headline: 'No speaker table',
      count: 2,
      latestAt: at(1),
    });
    expect(groups[0]!.urls).toEqual(['https://a.calicotab.com/a/', 'https://b.calicotab.com/b/']);
  });
});

describe('listParserWarnings', () => {
  it('reads at most 2,000 runs from the last 30 days, newest first', async () => {
    await listParserWarnings({ page: 1, now: NOW });
    const args = prismaMock.parserRun.findMany.mock.calls[0]![0];
    expect(WARNING_RUN_CAP).toBe(2000);
    expect(WARNING_WINDOW_DAYS).toBe(30);
    expect(args.take).toBe(2000);
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(args.where.warnings).toEqual({ isEmpty: false });
    expect(args.where.createdAt.gte).toEqual(new Date(NOW.getTime() - 30 * 86_400_000));
  });

  it('pages twenty groups at a time and clamps the page', async () => {
    prismaMock.parserRun.findMany.mockResolvedValue(
      Array.from({ length: 45 }, (_, i) =>
        run('parseTabs', [`Warning ${String(i).padStart(2, '0')}`], 'https://a.calicotab.com/a/'),
      ),
    );
    const page2 = await listParserWarnings({ page: 2, now: NOW });
    expect(WARNINGS_PER_PAGE).toBe(20);
    expect(page2).toMatchObject({ total: 45, page: 2, pages: 3 });
    expect(page2.rows).toHaveLength(20);
    expect((await listParserWarnings({ page: 9, now: NOW })).rows).toHaveLength(5);
  });

  it('matches tournaments by host and slug, with their Tab state, and never a private URL', async () => {
    prismaMock.parserRun.findMany.mockResolvedValue([
      run(
        'parseTabs',
        [`Bad row — at ${priv('oxiv', 'oxiv2025')}tab/team/`],
        priv('oxiv', 'oxiv2025'),
      ),
      run('parseTabs', ['Bad row — again'], 'https://oxiv.calicotab.com/oxiv2025/tab/team/'),
      run('parseTabs', ['Bad row — new'], priv('newt', 'newt26')),
    ]);
    prismaMock.tournament.findMany.mockResolvedValue([
      { id: 7n, name: 'Oxford IV', sourceUrlRaw: priv('oxiv', 'oxiv2025'), scrapedAt: NOW },
    ]);
    const { rows } = await listParserWarnings({ page: 1, now: NOW });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ parserName: 'parseTabs', headline: 'Bad row', count: 3 });
    expect(row.tournaments).toEqual([
      {
        id: '7',
        name: 'Oxford IV',
        tabUrl: 'https://oxiv.calicotab.com/oxiv2025/',
        tab: { state: 'loaded', tournamentId: '7', errors: [] },
      },
      {
        id: null,
        name: 'newt.calicotab.com/newt26',
        tabUrl: 'https://newt.calicotab.com/newt26/',
        tab: { state: 'missing', tournamentId: null, errors: [] },
      },
    ]);
    expect(row.sample).toBe('Bad row — at https://oxiv.calicotab.com/oxiv2025/');
    expect(JSON.stringify(rows).toLowerCase()).not.toContain('privateurls');
    expect(JSON.stringify(rows)).not.toContain(KEY);
  });
});

describe('the tournaments of a warning', () => {
  it('says "? Check", not "✗ Not loaded", when two stored rows share the address', async () => {
    prismaMock.parserRun.findMany.mockResolvedValue([
      run('parseTabs', ['Bad row'], priv('oxiv', 'oxiv2025')),
    ]);
    prismaMock.tournament.findMany.mockResolvedValue([
      { id: 7n, name: 'Oxford IV', sourceUrlRaw: priv('oxiv', 'oxiv2025'), scrapedAt: NOW },
      {
        id: 8n,
        name: 'Oxford IV (2)',
        sourceUrlRaw: 'https://oxiv.calicotab.com/oxiv2025/',
        scrapedAt: NOW,
      },
    ]);
    const { rows } = await listParserWarnings({ page: 1, now: NOW });
    const tab = rows[0]!.tournaments[0]!.tab;
    expect(tab.state).toBe('check');
    expect(tab.errors[0]).toMatch(/2 stored tournaments share this address/);
  });

  it('shows five tournaments and counts the rest', async () => {
    prismaMock.parserRun.findMany.mockResolvedValue(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((s) =>
        run('parseTabs', ['Bad row'], `https://${s}.calicotab.com/${s}/`),
      ),
    );
    const { rows } = await listParserWarnings({ page: 1, now: NOW });
    expect(rows[0]!.tournaments).toHaveLength(5);
    expect(rows[0]!.moreTournaments).toBe(2);
    // One lookup for the whole page, however many tournaments.
    expect(prismaMock.tournament.findMany).toHaveBeenCalledTimes(1);
  });
});
