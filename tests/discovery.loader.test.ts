/**
 * The Found loader over the mocked Prisma client: which names seed a search,
 * which tournaments are left out, and that every Person read is bounded by
 * the unique index (an IN of keys or a capped range), never a scan.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));

const { loadFound, RANGE_CAP } = await import('@/lib/discovery/loader');

const ME = 'user-1';

type Url = {
  tournamentId: bigint;
  ingestedAt: Date | null;
  registrationName: string | null;
  claimedBy: string | null;
};

function urls(list: Url[]) {
  prismaMock.discoveredUrl.findMany.mockResolvedValue(
    list.map((u) => ({
      tournamentId: u.tournamentId,
      ingestedAt: u.ingestedAt,
      registrationName: u.registrationName,
      registrationPerson: u.claimedBy ? { claimedByUserId: u.claimedBy } : null,
    })),
  );
}

const person = (id: bigint, displayName: string, claimedByUserId: string | null = null) => ({
  id,
  displayName,
  claimedByUserId,
  suppressedAt: null,
});

const part = (tournamentId: bigint, personId: bigint, name: string) => ({
  tournamentId,
  personId,
  teamName: 'Ashoka A',
  roles: [{ role: 'speaker' }],
  tournament: {
    name,
    year: 2024,
    region: null,
    sourceUrlRaw: `https://x.calicotab.com/t${tournamentId}/`,
  },
});

beforeEach(() => {
  resetPrismaMock();
  prismaMock.appearanceCandidate.findMany.mockResolvedValue([]);
  prismaMock.tournamentParticipant.findMany.mockResolvedValue([]);
  prismaMock.person.findMany.mockResolvedValue([]);
  prismaMock.teamResult.findMany.mockResolvedValue([]);
  prismaMock.eliminationResult.findMany.mockResolvedValue([]);
  prismaMock.judgeAssignment.findMany.mockResolvedValue([]);
});

describe('anchors', () => {
  it('never seeds from the Google name: no ingested registration name, no search', async () => {
    urls([]);
    const { input } = await loadFound(ME, 'Abhishek Acharya');
    expect(input.anchorCount).toBe(0);
    expect(prismaMock.person.findMany).not.toHaveBeenCalled();
  });

  it('ignores names on URLs not yet ingested, or held by someone else (typed/onboarding names)', async () => {
    urls([
      { tournamentId: 1n, ingestedAt: null, registrationName: 'Abhishek Acharya', claimedBy: ME },
      {
        tournamentId: 2n,
        ingestedAt: new Date(),
        registrationName: 'Abhishek Acharya',
        claimedBy: 'user-2',
      },
    ]);
    const { input } = await loadFound(ME, 'Abhishek Acharya');
    expect(input.anchorCount).toBe(0);
  });

  it('seeds from an ingested, claimed registration name', async () => {
    urls([
      {
        tournamentId: 1n,
        ingestedAt: new Date(),
        registrationName: 'Abhishek Acharya',
        claimedBy: ME,
      },
    ]);
    const { input } = await loadFound(ME, 'Abhi Acharya');
    expect(input.anchorCount).toBe(1);
  });

  it('holds back a registration name unlike the user (a forwarded URL)', async () => {
    urls([
      { tournamentId: 1n, ingestedAt: new Date(), registrationName: 'Priya Rao', claimedBy: ME },
    ]);
    const { input } = await loadFound(ME, 'Abhishek Acharya');
    expect(input).toMatchObject({ anchorCount: 0, heldBack: 1 });
    expect(prismaMock.person.findMany).not.toHaveBeenCalled();
  });
});

describe('queries', () => {
  beforeEach(() => {
    urls([
      {
        tournamentId: 1n,
        ingestedAt: new Date(),
        registrationName: 'Abhishek Acharya',
        claimedBy: ME,
      },
    ]);
  });

  it('reads Person only through the normalizedName index, each range capped', async () => {
    await loadFound(ME, 'Abhishek Acharya');
    const calls = prismaMock.person.findMany.mock.calls.map((c) => c[0]);
    expect(calls.length).toBeGreaterThan(1);
    for (const args of calls) {
      const where = args.where.normalizedName;
      expect(where).toBeDefined();
      if (where.gte) expect(args.take).toBe(RANGE_CAP + 1);
      else expect(Array.isArray(where.in)).toBe(true);
    }
  });

  it('leaves out tournaments the user has a private URL for, and finds the others', async () => {
    prismaMock.person.findMany.mockResolvedValue([person(100n, 'Abhishek Acharya', ME)]);
    prismaMock.tournamentParticipant.findMany.mockImplementation(
      async (args: { where: { personId?: unknown } }) => {
        if (
          args.where.personId &&
          typeof args.where.personId === 'object' &&
          'in' in (args.where.personId as object)
        ) {
          return [part(1n, 100n, 'SIDO 2025'), part(2n, 100n, 'WUDC 2024')];
        }
        return [];
      },
    );
    const { rows } = await loadFound(ME, 'Abhishek Acharya');
    expect(rows.map((r) => r.tournamentId)).toEqual(['2']);
    expect(rows[0]).toMatchObject({ claimedBy: 'me', publicUrl: 'https://x.calicotab.com/t2/' });
  });

  it('never offers a suppressed person or a stand-in', async () => {
    prismaMock.person.findMany.mockResolvedValue([
      { ...person(100n, 'Abhishek Acharya'), suppressedAt: new Date() },
      person(101n, 'Swing 3'),
    ]);
    const { rows } = await loadFound(ME, 'Abhishek Acharya');
    expect(rows).toEqual([]);
    expect(prismaMock.tournamentParticipant.findMany).toHaveBeenCalledTimes(1); // own record only
  });

  it('flags a truncated range', async () => {
    prismaMock.person.findMany.mockImplementation(async (args: { take?: number }) =>
      args.take
        ? Array.from({ length: args.take }, (_, i) => person(BigInt(1000 + i), `Zed ${i}`))
        : [],
    );
    const { input } = await loadFound(ME, 'Abhishek Acharya');
    expect(input.truncated).toBe(true);
  });
});
