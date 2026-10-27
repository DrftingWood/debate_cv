import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authMock,
  prismaMock,
  resetPrismaMock,
  fakeSession,
  expectUnauthorized,
  expectMalformedBody,
  jsonRequest,
  readJson,
} from '../setup/api-test-utils';
import type { FoundRow } from '@/lib/discovery/match';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => m.authMockModule));
vi.mock('@/lib/db', () => import('../setup/api-test-utils').then((m) => m.dbMockModule));

const loadFoundMock = vi.fn();
vi.mock('@/lib/discovery/loader', () => ({ loadFound: loadFoundMock }));

// The real limiter, over the mocked $queryRaw, so the per-decision cost and
// the 50-a-day policy are both exercised.
const { POST } = await import('@/app/api/discovery/decisions/route');
const { RATE_LIMITS } = await import('@/lib/rateLimit');

const OWNER = 'owner@example.com';

function row(over: Partial<FoundRow> = {}): FoundRow {
  return {
    tournamentId: '10',
    personId: '100',
    tournamentName: 'WUDC 2024',
    year: 2024,
    region: null,
    publicUrl: '',
    listedName: 'Abhishek Acharya',
    roles: ['speaker'],
    teamName: 'Ashoka A',
    claimedBy: null,
    slots: [],
    eudc: false,
    teammates: [],
    busiestYear: null,
    key: `${over.tournamentId ?? '10'}:${over.personId ?? '100'}`,
    anchor: 'Abhishek Acharya',
    proximity: 'match',
    tier: 'strong',
    score: 70,
    evidence: ['Same name'],
    warnings: [],
    blockReason: null,
    blockText: null,
    decision: null,
    ...over,
  };
}

const call = (items: unknown) => POST(jsonRequest('/api/discovery/decisions', { body: { items } }));
const item = (decision: string, tournamentId = '10', personId = '100') => ({
  tournamentId,
  personId,
  decision,
});

/** The rate-limit counter the upsert RETURNs after this request. */
function counterAt(count: number) {
  prismaMock.$queryRaw.mockResolvedValue([{ count, windowStart: new Date() }]);
}

beforeEach(() => {
  resetPrismaMock();
  authMock.mockReset();
  loadFoundMock.mockReset();
  process.env.ADMIN_EMAIL = OWNER;
  delete process.env.DISCOVERY_LIST;
  delete process.env.DISCOVERY_LIST_EMAILS;
  authMock.mockResolvedValue(fakeSession('user-1', { email: OWNER, name: 'Abhishek Acharya' }));
  loadFoundMock.mockResolvedValue({ rows: [row()], input: {} });
  prismaMock.appearanceCandidate.findMany.mockResolvedValue([]);
  prismaMock.appearanceCandidate.upsert.mockResolvedValue({});
  prismaMock.appearanceCandidate.update.mockResolvedValue({});
  counterAt(1);
});

describe('POST /api/discovery/decisions: access', () => {
  it('401 when signed out', async () => {
    await expectUnauthorized(() => call([item('confirm')]));
  });

  it('404 for a user without the discovery flag, before touching anything', async () => {
    authMock.mockResolvedValue(fakeSession('user-2', { email: 'someone@example.com' }));
    const res = await call([item('confirm')]);
    expect(res.status).toBe(404);
    expect(loadFoundMock).not.toHaveBeenCalled();
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('404 for the owner too when the kill switch is off', async () => {
    process.env.DISCOVERY_LIST = 'off';
    expect((await call([item('confirm')])).status).toBe(404);
  });

  it('opted-in testers listed in DISCOVERY_LIST_EMAILS get through', async () => {
    process.env.DISCOVERY_LIST_EMAILS = 'tester@example.com';
    authMock.mockResolvedValue(fakeSession('user-3', { email: 'Tester@example.com' }));
    expect((await call([item('reject')])).status).toBe(200);
  });

  it('400 on a malformed body', async () => {
    await expectMalformedBody(() => call([]));
    await expectMalformedBody(() => call([item('delete')]));
    await expectMalformedBody(() => call([{ ...item('confirm'), personId: '1; drop' }]));
    await expectMalformedBody(() => call(Array.from({ length: 51 }, () => item('reject'))));
  });
});

describe('daily limit (50 decisions per user per day)', () => {
  it('is the policy in RATE_LIMITS', () => {
    expect(RATE_LIMITS['discovery:decide']).toEqual({ limit: 50, windowSec: 86400 });
  });

  it('charges one unit per decision, not per request', async () => {
    loadFoundMock.mockResolvedValue({
      rows: [row({ tournamentId: '1' }), row({ tournamentId: '2' }), row({ tournamentId: '3' })],
    });
    await call([item('confirm', '1'), item('confirm', '2'), item('confirm', '3')]);
    const values = prismaMock.$queryRaw.mock.calls[0].slice(1);
    expect(values[0]).toBe('discovery:decide:user-1');
    expect(values.filter((v) => v === 3)).toHaveLength(3);
  });

  it('refuses with 429 once the day is used up, and writes nothing', async () => {
    counterAt(51);
    const res = await call([item('reject')]);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(await readJson<{ error: string }>(res)).toMatchObject({ error: 'rate_limited' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('the 50th decision of the day is still allowed', async () => {
    counterAt(50);
    expect((await call([item('reject')])).status).toBe(200);
  });

  it('a bulk that would cross the limit is refused whole', async () => {
    counterAt(52);
    loadFoundMock.mockResolvedValue({
      rows: [row({ tournamentId: '1' }), row({ tournamentId: '2' })],
    });
    expect((await call([item('confirm', '1'), item('confirm', '2')])).status).toBe(429);
  });
});

describe('validation against the current list', () => {
  it('409 for an appearance the matcher does not show this user', async () => {
    const res = await call([item('confirm', '99', '999')]);
    expect(res.status).toBe(409);
    expect(await readJson<{ error: string }>(res)).toMatchObject({ error: 'not_a_candidate' });
  });

  it('409 when marking a blocked row as you; hiding it is fine', async () => {
    loadFoundMock.mockResolvedValue({ rows: [row({ tier: 'blocked' })] });
    expect((await call([item('confirm')])).status).toBe(409);
    expect((await call([item('reject')])).status).toBe(200);
  });

  it('bulk "This is me" is for Strong rows only', async () => {
    loadFoundMock.mockResolvedValue({
      rows: [row({ tournamentId: '1' }), row({ tournamentId: '2', tier: 'possible' })],
    });
    const res = await call([item('confirm', '1'), item('confirm', '2')]);
    expect(res.status).toBe(409);
    expect(await readJson<{ error: string }>(res)).toMatchObject({ error: 'bulk_strong_only' });
  });

  it('a single Possible row can be marked on its own', async () => {
    loadFoundMock.mockResolvedValue({ rows: [row({ tier: 'possible', proximity: 'close' })] });
    expect((await call([item('confirm')])).status).toBe(200);
  });

  it('restore needs a recorded decision', async () => {
    expect((await call([item('restore')])).status).toBe(409);
  });
});

describe('writes', () => {
  it('records "This is me" keyed on tournament + person, with the evidence shown', async () => {
    loadFoundMock.mockResolvedValue({ rows: [row({ warnings: ['Check this'] })] });
    const res = await call([item('confirm')]);
    expect(res.status).toBe(200);
    const arg = prismaMock.appearanceCandidate.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({
      userId_tournamentId_personId: { userId: 'user-1', tournamentId: 10n, personId: 100n },
    });
    expect(arg.create).toMatchObject({
      status: 'confirmed',
      proximity: 'match',
      evidence: ['Same name', 'Check this'],
      matcherVersion: 1,
    });
    expect(arg.create.decidedAt).toBeInstanceOf(Date);
  });

  it('only ever writes AppearanceCandidate: nothing reaches the CV', async () => {
    await call([item('confirm')]);
    expect(prismaMock.person.update).not.toHaveBeenCalled();
    expect(prismaMock.person.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.tournamentParticipant.update).not.toHaveBeenCalled();
    expect(prismaMock.discoveredUrl.create).not.toHaveBeenCalled();
  });

  it('restore sets the row back to an open candidate', async () => {
    prismaMock.appearanceCandidate.findMany.mockResolvedValue([
      { tournamentId: 10n, personId: 100n },
    ]);
    loadFoundMock.mockResolvedValue({ rows: [] });
    expect((await call([item('restore')])).status).toBe(200);
    expect(prismaMock.appearanceCandidate.update.mock.calls[0][0].data).toEqual({
      status: 'candidate',
      decidedAt: null,
    });
  });

  it('a "Not me" survives a re-scrape: the stored row is updated even when the matcher lost it', async () => {
    prismaMock.appearanceCandidate.findMany.mockResolvedValue([
      { tournamentId: 10n, personId: 100n },
    ]);
    loadFoundMock.mockResolvedValue({ rows: [] });
    expect((await call([item('reject')])).status).toBe(200);
    expect(prismaMock.appearanceCandidate.update.mock.calls[0][0].data.status).toBe('rejected');
  });

  it('one decision per appearance per request: the last one wins', async () => {
    await call([item('confirm'), item('reject')]);
    expect(prismaMock.appearanceCandidate.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.appearanceCandidate.upsert.mock.calls[0][0].create.status).toBe('rejected');
  });
});
