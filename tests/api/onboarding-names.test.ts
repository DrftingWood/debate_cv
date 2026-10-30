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
vi.mock('@/lib/db', () =>
  import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })),
);

const { GET } = await import('@/app/api/onboarding/names/route');

type Row = { displayName: string; isMine: boolean; proximity: string };

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
});

describe('GET /api/onboarding/names', () => {
  it('returns 401 when unauthenticated', () => expectUnauthorized(() => GET()));

  it('marks each name by how close it is to the Google name or a name already claimed', async () => {
    authMock.mockResolvedValue(fakeSession('user-1', { name: 'Abhishek Acharya' }));
    prismaMock.discoveredUrl.findMany.mockResolvedValue([
      { registrationName: 'Abhishek Acharya', registrationPersonId: 1n },
      { registrationName: 'A. Acharya', registrationPersonId: 2n },
      { registrationName: 'Priya Nair', registrationPersonId: 3n },
      { registrationName: 'Abhi A', registrationPersonId: 4n },
    ]);
    // first call: which of these names the user has claimed; second: all names they hold
    prismaMock.person.findMany
      .mockResolvedValueOnce([{ normalizedName: 'abhi a' }])
      .mockResolvedValueOnce([{ displayName: 'Abhi A' }]);

    const res = await GET();
    const data = await readJson<{ names: Row[] }>(res);
    const by = Object.fromEntries(data.names.map((n) => [n.displayName, n]));
    expect(by['Abhishek Acharya'].proximity).toBe('match');
    expect(by['A. Acharya'].proximity).toBe('close');
    expect(by['Priya Nair'].proximity).toBe('different');
    expect(by['Abhi A']).toMatchObject({ isMine: true, proximity: 'match' });
  });

  it('says unknown, not different, with no majority, no Google name and nothing claimed', async () => {
    authMock.mockResolvedValue(fakeSession('user-1', { name: null }));
    prismaMock.discoveredUrl.findMany.mockResolvedValue([
      { registrationName: 'Priya Nair', registrationPersonId: 3n },
      { registrationName: 'Sam Lee', registrationPersonId: 4n },
    ]);
    prismaMock.person.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const data = await readJson<{ names: Row[] }>(await GET());
    expect(data.names.map((n) => n.proximity)).toEqual(['unknown', 'unknown']);
  });

  it('marks the name on most pages read as verified and judges the rest against it', async () => {
    authMock.mockResolvedValue(fakeSession('user-1', { name: 'Someone Else' }));
    prismaMock.discoveredUrl.findMany.mockResolvedValue([
      ...Array.from({ length: 8 }, () => ({ registrationName: 'Abhishek Acharya' })),
      { registrationName: 'Abhi Acharya' },
      { registrationName: 'Priya Raman' },
      {
        registrationName: '',
        lastPreflightError: 'not read: your name was settled from your other links',
      },
    ]);
    prismaMock.person.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const data = await readJson<{
      names: Array<Row & { verified: boolean; comparedTo: string }>;
      totals: { failed: number; skipped: number };
    }>(await GET());
    const by = Object.fromEntries(data.names.map((n) => [n.displayName, n]));
    expect(by['Abhishek Acharya']).toMatchObject({ verified: true, comparedTo: 'majority' });
    expect(by['Abhi Acharya']).toMatchObject({ verified: false, proximity: 'close' });
    expect(by['Priya Raman']).toMatchObject({ verified: false, proximity: 'different' });
    expect(data.totals).toMatchObject({ failed: 0, skipped: 1 });
  });
});
