import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

// Stored data first (owner, 2026-10-30): the import step links a finished,
// stored tournament without fetching its private URL, and finds the user in it
// by the names they have claimed. A private-URL page is read only when those
// names are not in the tournament.
vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const {
  linkFromStoredTournament,
  linkStoredJobsFirst,
  matchStoredParticipant,
  requeueUnmatchedStoredLinks,
} = await import('@/lib/calicotab/storedFirst');
const { isCalicotabHost } = await import('@/lib/calicotab/fetchSession');
const { PARSER_VERSION } = await import('@/lib/calicotab/version');

const URL_ = 'https://oxiv.calicotab.com/oxiv2025/privateurls/abc123/';

const stored = (over: Record<string, unknown> = {}) => ({
  id: 9n,
  fingerprint: 'fp-oxiv',
  sourceUrlRaw: 'https://oxiv.calicotab.com/oxiv2025/',
  scrapedAt: new Date('2026-10-28T00:00:00Z'),
  year: 2025,
  parserVersion: PARSER_VERSION,
  totalTeams: 40,
  totalParticipants: 120,
  ...over,
});

const participants = (...names: string[]) =>
  names.map((displayName, i) => ({ person: { id: BigInt(100 + i), displayName } }));

/** A finished, stored tournament with these participants, for a user who claimed `claimed`. */
function storedTournament(opts: { claimed: string[]; names: string[]; ingestedAt?: Date | null }) {
  prismaMock.discoveredUrl.findFirst.mockResolvedValue({ ingestedAt: opts.ingestedAt ?? null });
  prismaMock.tournament.findMany.mockResolvedValue([stored()]);
  prismaMock.teamResult.findFirst.mockResolvedValue({ id: 1n });
  prismaMock.person.findMany.mockResolvedValue(
    opts.claimed.map((displayName) => ({ displayName })),
  );
  prismaMock.tournamentParticipant.findMany.mockResolvedValue(participants(...opts.names));
  prismaMock.discoveredUrl.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.discoveredUrl.aggregate.mockResolvedValue({
    _min: { messageDate: new Date('2025-11-14T09:00:00Z') },
  } as never);
  prismaMock.tournament.updateMany.mockResolvedValue({ count: 1 });
}

const linkData = () => prismaMock.discoveredUrl.updateMany.mock.calls[0]?.[0].data;

beforeEach(() => resetPrismaMock());

describe('linkFromStoredTournament', () => {
  it('links a finished stored tournament and the claimed name in it, with no request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    storedTournament({ claimed: ['Maya Rao'], names: ['Priya Raman', 'Maya Rao'] });

    const linked = await linkFromStoredTournament(URL_, 'u1');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(linked).toMatchObject({ tournamentId: 9n, personId: 101n, personName: 'Maya Rao' });
    expect(linkData()).toMatchObject({ tournamentId: 9n, registrationPersonId: 101n });
    expect(linkData().ingestedAt).toBeInstanceOf(Date);
  });

  it('links the tournament alone for a user still in onboarding (nothing claimed yet)', async () => {
    storedTournament({ claimed: [], names: ['Maya Rao'] });
    const linked = await linkFromStoredTournament(URL_, 'u1');
    expect(linked).toMatchObject({ tournamentId: 9n, personId: null });
    expect(linkData()).not.toHaveProperty('registrationPersonId');
    expect(prismaMock.tournamentParticipant.findMany).not.toHaveBeenCalled();
  });

  it('gives a yearless stored tournament the year its link was emailed', async () => {
    storedTournament({ claimed: [], names: ['Maya Rao'] });
    await linkFromStoredTournament(URL_, 'u1');
    expect(prismaMock.tournament.updateMany).toHaveBeenCalledWith({
      where: { id: 9n, year: null },
      data: { year: 2025 },
    });
  });

  it('reads the page when the claimed names are not in the tournament (a forwarded link)', async () => {
    storedTournament({ claimed: ['Maya Rao'], names: ['Priya Raman'] });
    await expect(linkFromStoredTournament(URL_, 'u1')).resolves.toBeNull();
    expect(prismaMock.discoveredUrl.updateMany).not.toHaveBeenCalled();
  });

  it('reads the page for a close name only: a close name is not evidence on its own', async () => {
    storedTournament({ claimed: ['Maya Rao'], names: ['M. Rao'] });
    await expect(linkFromStoredTournament(URL_, 'u1')).resolves.toBeNull();
  });

  it('goes the live way for a URL linked before (a re-ingest)', async () => {
    storedTournament({ claimed: ['Maya Rao'], names: ['Maya Rao'], ingestedAt: new Date() });
    await expect(linkFromStoredTournament(URL_, 'u1')).resolves.toBeNull();
    expect(prismaMock.discoveredUrl.updateMany).not.toHaveBeenCalled();
  });

  it('goes the live way when the stored copy is from an older parser', async () => {
    storedTournament({ claimed: ['Maya Rao'], names: ['Maya Rao'] });
    prismaMock.tournament.findMany.mockResolvedValue([stored({ parserVersion: 'old' })]);
    await expect(linkFromStoredTournament(URL_, 'u1')).resolves.toBeNull();
  });

  it('goes the live way when Re-ingest all marked the row (epoch scrapedAt)', async () => {
    storedTournament({ claimed: ['Maya Rao'], names: ['Maya Rao'] });
    prismaMock.tournament.findMany.mockResolvedValue([stored({ scrapedAt: new Date(0) })]);
    await expect(linkFromStoredTournament(URL_, 'u1')).resolves.toBeNull();
  });

  it('goes the live way for a tournament still running (no team tab stored)', async () => {
    storedTournament({ claimed: ['Maya Rao'], names: ['Maya Rao'] });
    prismaMock.teamResult.findFirst.mockResolvedValue(null);
    await expect(linkFromStoredTournament(URL_, 'u1')).resolves.toBeNull();
  });

  it('goes the live way when nothing is stored for the site', async () => {
    storedTournament({ claimed: ['Maya Rao'], names: ['Maya Rao'] });
    prismaMock.tournament.findMany.mockResolvedValue([]);
    await expect(linkFromStoredTournament(URL_, 'u1')).resolves.toBeNull();
  });
});

describe('matchStoredParticipant', () => {
  it('returns none for two people matching equally: the page decides', async () => {
    prismaMock.tournamentParticipant.findMany.mockResolvedValue(
      participants('Maya Rao', 'Rao Maya'),
    );
    await expect(matchStoredParticipant(9n, ['Maya Rao'])).resolves.toEqual({ kind: 'none' });
  });

  it('returns none with no verified name at all', async () => {
    await expect(matchStoredParticipant(9n, ['', ' '])).resolves.toEqual({ kind: 'none' });
    expect(prismaMock.tournamentParticipant.findMany).not.toHaveBeenCalled();
  });

  it('skips suppressed people', async () => {
    prismaMock.tournamentParticipant.findMany.mockResolvedValue([]);
    await matchStoredParticipant(9n, ['Maya Rao']);
    expect(prismaMock.tournamentParticipant.findMany.mock.calls[0]?.[0].where).toEqual({
      tournamentId: 9n,
      person: { suppressedAt: null },
    });
  });
});

describe('requeueUnmatchedStoredLinks', () => {
  it('queues the linked tournaments none of the confirmed names reaches', async () => {
    prismaMock.discoveredUrl.findMany.mockResolvedValue([{ url: URL_ }]);
    prismaMock.ingestJob.updateMany.mockResolvedValue({ count: 1 });

    await expect(requeueUnmatchedStoredLinks('u1')).resolves.toBe(1);

    expect(prismaMock.discoveredUrl.findMany.mock.calls[0]?.[0].where).toEqual({
      userId: 'u1',
      tournamentId: { not: null },
      ingestedAt: { not: null },
      registrationPersonId: null,
      reingestLocked: false,
      tournament: { participants: { none: { person: { claimedByUserId: 'u1' } } } },
    });
    expect(prismaMock.ingestJob.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { userId: 'u1', url: { in: [URL_] }, status: { not: 'running' } },
      data: { status: 'pending', attempts: 0 },
    });
  });

  it('does nothing when every linked tournament has a confirmed name', async () => {
    prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
    await expect(requeueUnmatchedStoredLinks('u1')).resolves.toBe(0);
    expect(prismaMock.ingestJob.updateMany).not.toHaveBeenCalled();
  });
});

describe('isCalicotabHost', () => {
  it('knows calicotab and its subdomains, and nothing else', () => {
    expect(isCalicotabHost('calicotab.com')).toBe(true);
    expect(isCalicotabHost('OXIV.calicotab.com')).toBe(true);
    expect(isCalicotabHost('calicotab.com.evil.example')).toBe(false);
    expect(isCalicotabHost('t.herokuapp.com')).toBe(false);
  });
});

describe('linkStoredJobsFirst: the stored pass before the queue', () => {
  // Owner, 2026-10-30: go through every new private URL first and load the
  // ones the pre-scrape already has; only then work through the ones that
  // need calicotab. Before, the queue ran first-come, first-served, so a
  // stored tournament waited behind a slow live scrape for the one
  // calicotab slot, although linking it needs no request.
  const OTHER = 'https://newtourney.calicotab.com/nt2026/privateurls/zzz999/';
  const claimedIds = () =>
    prismaMock.ingestJob.updateMany.mock.calls
      .filter((c) => (c[0] as { data: { status?: string } }).data.status === 'running')
      .map((c) => (c[0] as { where: { id: string } }).where.id);
  const doneIds = () =>
    prismaMock.ingestJob.update.mock.calls
      .map((c) => c[0] as { where: { id: string }; data: { status?: string } })
      .filter((a) => a.data.status === 'done')
      .map((a) => a.where.id);
  const putBack = () =>
    prismaMock.ingestJob.updateMany.mock.calls
      .map((c) => c[0] as { where: { id: string }; data: Record<string, unknown> })
      .filter((a) => a.data.status === 'pending');

  beforeEach(() => {
    prismaMock.ingestJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.ingestJob.update.mockResolvedValue({ userId: 'u1' } as never);
    prismaMock.ingestJob.findMany.mockResolvedValue([
      { id: 'live', userId: 'u1', url: OTHER },
      { id: 'stored', userId: 'u1', url: URL_ },
    ]);
  });

  it('links the stored tournament with no request and leaves the live one for the queue', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    storedTournament({ claimed: ['Maya Rao'], names: ['Maya Rao'] });
    prismaMock.tournament.findMany.mockImplementation((async (args: {
      where: { OR: Array<{ sourceUrlRaw: { startsWith: string } }> };
    }) => (args.where.OR[0]!.sourceUrlRaw.startsWith.includes('oxiv') ? [stored()] : [])) as never);

    const linked = await linkStoredJobsFirst({ userId: 'u1' });

    expect(linked).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(claimedIds()).toEqual(['stored']);
    expect(doneIds()).toEqual(['stored']);
    expect(putBack()).toEqual([]);
  });

  it('puts a stored job back, attempt untouched, when the user’s names are not in it', async () => {
    storedTournament({ claimed: ['Maya Rao'], names: ['Someone Else'] });
    prismaMock.tournament.findMany.mockImplementation((async (args: {
      where: { OR: Array<{ sourceUrlRaw: { startsWith: string } }> };
    }) => (args.where.OR[0]!.sourceUrlRaw.startsWith.includes('oxiv') ? [stored()] : [])) as never);

    expect(await linkStoredJobsFirst({ userId: 'u1' })).toBe(0);
    expect(doneIds()).toEqual([]);
    expect(putBack().map((a) => a.where.id)).toEqual(['stored']);
    expect(putBack()[0]!.data).not.toHaveProperty('attempts');
  });

  it('skips a job another drain claimed first', async () => {
    storedTournament({ claimed: ['Maya Rao'], names: ['Maya Rao'] });
    prismaMock.ingestJob.updateMany.mockResolvedValue({ count: 0 });
    expect(await linkStoredJobsFirst({ userId: 'u1' })).toBe(0);
    expect(prismaMock.discoveredUrl.updateMany).not.toHaveBeenCalled();
  });
});
