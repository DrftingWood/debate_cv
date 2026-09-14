import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authMock,
  prismaMock,
  resetPrismaMock,
  fakeSession,
  expectUnauthorized,
  readJson,
} from '../setup/api-test-utils';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => ({ auth: m.authMock })));
vi.mock('@/lib/db', () => import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { POST } = await import('@/app/api/persons/[id]/claim/route');

const req = () => new Request('http://localhost/api/persons/5/claim', { method: 'POST' });
const params = Promise.resolve({ id: '5' });

/** The Person the caller is trying to claim, as returned by the attendance query. */
function attendedAs(displayName: string, suppressedAt: Date | null = null) {
  prismaMock.tournamentParticipant.findMany.mockResolvedValue([
    { tournamentId: 1n, person: { displayName, suppressedAt } },
  ]);
}

/** The registration names on the caller's own private URLs. */
function myRegistrationNames(names: string[]) {
  prismaMock.discoveredUrl.findMany.mockResolvedValue(
    names.map((registrationName) => ({ registrationName })),
  );
}

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
  prismaMock.person.updateMany.mockResolvedValue({ count: 1 });
});

describe('POST /api/persons/[id]/claim', () => {
  it('returns 401 when unauthenticated', () =>
    expectUnauthorized(() => POST(req(), { params })));

  it('rejects a Person at a tournament the caller never ingested', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.tournamentParticipant.findMany.mockResolvedValue([]);

    const res = await POST(req(), { params });
    expect(res.status).toBe(403);
    expect((await readJson<{ error: string }>(res)).error).toBe('forbidden');
    expect(prismaMock.person.updateMany).not.toHaveBeenCalled();
  });

  it('rejects claiming someone else at a tournament you DID attend', async () => {
    // The squatting attack: attendance alone used to authorise claiming any
    // of the hundreds of people on that tab.
    authMock.mockResolvedValue(fakeSession('user-1', { name: 'Maya Rao' }));
    attendedAs('Some Other Debater');
    myRegistrationNames(['Maya Rao']);

    const res = await POST(req(), { params });
    expect(res.status).toBe(403);
    expect((await readJson<{ error: string }>(res)).error).toBe('identity_mismatch');
    expect(prismaMock.person.updateMany).not.toHaveBeenCalled();
  });

  it('allows the claim when the private URL registration name matches', async () => {
    authMock.mockResolvedValue(fakeSession('user-1', { name: 'Unrelated Google Name' }));
    attendedAs('Maya Rao');
    myRegistrationNames(['Maya Rao']);

    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    expect(prismaMock.person.updateMany).toHaveBeenCalledTimes(1);
  });

  it('matches fuzzily, so a middle name on the tab is not a lockout', async () => {
    authMock.mockResolvedValue(fakeSession('user-1', { name: 'x' }));
    attendedAs('Maya Priya Rao');
    myRegistrationNames(['Maya Rao']);

    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
  });

  it('falls back to the Google account name when no registration name was captured', async () => {
    // Preflight can fail (dead URL, Cloudflare); that must not lock a user
    // out of their own record.
    authMock.mockResolvedValue(fakeSession('user-1', { name: 'Maya Rao' }));
    attendedAs('Maya Rao');
    myRegistrationNames([]);

    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
  });

  it('explains what to do when no name is available at all', async () => {
    authMock.mockResolvedValue(fakeSession('user-1', { name: null }));
    attendedAs('Maya Rao');
    myRegistrationNames([]);

    const res = await POST(req(), { params });
    expect(res.status).toBe(403);
    const data = await readJson<{ error: string; reason: string }>(res);
    expect(data.error).toBe('identity_mismatch');
    expect(data.reason).toMatch(/preflight/i);
  });

  it('reports a conflict when another account already holds the identity', async () => {
    authMock.mockResolvedValue(fakeSession('user-1', { name: 'Maya Rao' }));
    attendedAs('Maya Rao');
    myRegistrationNames(['Maya Rao']);
    prismaMock.person.updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    expect((await readJson<{ error: string }>(res)).error).toBe('already_claimed_by_other');
  });

  it('refuses a Person who has asked to be erased, even to a name match', async () => {
    // Suppression has to beat the identity check, not sit behind it: a claim
    // would republish the withdrawn name on the claimant's CV.
    authMock.mockResolvedValue(fakeSession('user-1', { name: 'Maya Rao' }));
    attendedAs('Maya Rao', new Date());
    myRegistrationNames(['Maya Rao']);

    const res = await POST(req(), { params });
    expect(res.status).toBe(403);
    expect((await readJson<{ error: string }>(res)).error).toBe('name_withdrawn');
    expect(prismaMock.person.updateMany).not.toHaveBeenCalled();
  });

  it('records when the claim happened', async () => {
    authMock.mockResolvedValue(fakeSession('user-1', { name: 'Maya Rao' }));
    attendedAs('Maya Rao');
    myRegistrationNames(['Maya Rao']);

    await POST(req(), { params });
    const call = prismaMock.person.updateMany.mock.calls[0][0] as {
      data: { claimedAt?: Date };
    };
    expect(call.data.claimedAt).toBeInstanceOf(Date);
  });
});
