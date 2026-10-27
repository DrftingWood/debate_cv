/**
 * The Found loader over the mocked Prisma client: the names searched are the
 * user's claimed names only, the search is ONE query of whole-key equality
 * with every exclusion inside it, round facts are read by exact pairs, and
 * every run logs one timing line.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));

const { loadFound, ALIAS_CAP } = await import('@/lib/discovery/loader');
const { candidateQuery } = await import('@/lib/discovery/candidates');

const ME = 'user-1';

function claimed(...names: string[]) {
  prismaMock.person.findMany.mockResolvedValue(names.map((displayName) => ({ displayName })));
}

const cand = (over: Record<string, unknown> = {}) => ({
  alias: 0,
  tournamentId: 2n,
  personId: 100n,
  teamName: 'Ashoka A',
  roles: ['speaker'],
  tournamentName: 'WUDC 2024',
  year: 2024,
  region: null,
  sourceUrlRaw: 'https://x.calicotab.com/t2/',
  displayName: 'Abhishek Acharya',
  claimedByUserId: ME,
  matchKind: 'exact',
  aliasTotal: 1,
  ...over,
});

/** The Sql object the loader handed to $queryRaw. */
function sentQuery(): Prisma.Sql {
  return prismaMock.$queryRaw.mock.calls[0][0] as Prisma.Sql;
}

beforeEach(() => {
  resetPrismaMock();
  prismaMock.appearanceCandidate.findMany.mockResolvedValue([]);
  prismaMock.tournamentParticipant.findMany.mockResolvedValue([]);
  prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
  prismaMock.person.findMany.mockResolvedValue([]);
  prismaMock.teamResult.findMany.mockResolvedValue([]);
  prismaMock.eliminationResult.findMany.mockResolvedValue([]);
  prismaMock.judgeAssignment.findMany.mockResolvedValue([]);
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('names searched', () => {
  it('only the user claimed names, read by claimedByUserId', async () => {
    claimed('Abhishek Acharya');
    await loadFound(ME);
    expect(prismaMock.person.findMany.mock.calls[0][0].where).toEqual({
      claimedByUserId: ME,
      suppressedAt: null,
    });
    expect(prismaMock.discoveredUrl.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ registrationName: true }) }),
    );
  });

  it('no claimed name: no search at all', async () => {
    const { input } = await loadFound(ME);
    expect(input.aliasCount).toBe(0);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('the one search query', () => {
  it('is equality, or the in-order whole-word pattern for multi-word names only', async () => {
    claimed('Abhishek', 'Abhishek  Acharya');
    await loadFound(ME);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    const q = sentQuery();
    expect(q.sql).toContain('p."normalizedName" = k."key"');
    expect(q.sql).toContain('p."normalizedName" ~ k."pattern"');
    expect(q.sql).not.toMatch(/LIKE|ILIKE|>=|starts_with|@>|similarity|%|string_to_array/i);
    // Whitespace-collapsed keys and their patterns, passed as bound values;
    // the one-word name has no pattern (NULL), so it is equality only.
    expect(q.values).toContainEqual(['abhishek', 'abhishek acharya']);
    expect(q.values).toContainEqual([null, '(^| )abhishek( .*)? acharya( |$)']);
  });

  it('pushes every exclusion into the same statement', async () => {
    claimed('Abhishek Acharya');
    await loadFound(ME);
    const { sql, values } = sentQuery();
    expect(sql).toContain('p."suppressedAt" IS NULL');
    expect(sql).toContain('p."claimedByUserId" IS NULL OR p."claimedByUserId" =');
    expect(sql).toMatch(/NOT IN \(\s*SELECT du."tournamentId" FROM "DiscoveredUrl" du/);
    expect(sql).toContain('h."rn" <=');
    expect(values).toContain(ME);
    expect(values).toContain(ALIAS_CAP);
  });

  it('builds the same statement for the same aliases (no string building from values)', () => {
    const a = candidateQuery(ME, [{ name: 'X Y', key: "x y'; drop" }]);
    expect(a.sql).not.toContain('drop');
    expect(a.values).toContainEqual(["x y'; drop"]);
  });
});

describe('rows', () => {
  beforeEach(() => claimed('Abhishek Acharya'));

  it('turns query rows into page rows, marking the user own name', async () => {
    prismaMock.$queryRaw.mockResolvedValue([cand()]);
    const { rows } = await loadFound(ME);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tournamentId: '2',
      mine: true,
      publicUrl: 'https://x.calicotab.com/t2/',
      evidence: ['Exact match', 'this name is already on your record', '2024'],
    });
  });

  it('a name over the cap is reported with its full count, not cut silently', async () => {
    prismaMock.$queryRaw.mockResolvedValue([cand({ aliasTotal: ALIAS_CAP + 37 })]);
    const { input } = await loadFound(ME);
    expect(input.capped).toEqual([
      { name: 'Abhishek Acharya', total: ALIAS_CAP + 37, shown: ALIAS_CAP },
    ]);
  });

  it('reads round facts by exact (tournament, team/person) pairs, never IN x IN', async () => {
    prismaMock.$queryRaw.mockResolvedValue([cand(), cand({ tournamentId: 3n })]);
    await loadFound(ME);
    const team = prismaMock.teamResult.findMany.mock.calls[0][0];
    expect(team.where.tournamentId).toBeUndefined();
    expect(team.where.OR).toEqual([
      { tournamentId: 2n, teamName: 'Ashoka A' },
      { tournamentId: 3n, teamName: 'Ashoka A' },
    ]);
    const judge = prismaMock.judgeAssignment.findMany.mock.calls[0][0];
    expect(judge.where.OR).toEqual([
      { tournamentId: 2n, personId: 100n },
      { tournamentId: 3n, personId: 100n },
    ]);
    expect(prismaMock.eliminationResult.findMany.mock.calls[0][0].where.entityName).toBeUndefined();
  });
});

describe('timing and abort', () => {
  it('logs one structured timing line per run, with stage names', async () => {
    claimed('Abhishek Acharya');
    prismaMock.$queryRaw.mockResolvedValue([cand()]);
    await loadFound(ME);
    const info = vi.mocked(console.info);
    const lines = info.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[found]'));
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0].replace('[found] timing ', '')) as {
      totalMs: number;
      stages: Record<string, number>;
    };
    expect(Object.keys(parsed.stages)).toEqual(
      expect.arrayContaining(['names', 'candidates', 'teammates', 'roundFacts', 'rows']),
    );
    expect(typeof parsed.totalMs).toBe('number');
  });

  it('stops at the next stage once its signal is aborted', async () => {
    claimed('Abhishek Acharya');
    const controller = new AbortController();
    controller.abort();
    await expect(loadFound(ME, { signal: controller.signal })).rejects.toThrow('aborted');
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });
});
