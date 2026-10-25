import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authMock,
  prismaMock,
  resetPrismaMock,
  fakeSession,
  expectUnauthorized,
} from '../setup/api-test-utils';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => ({ auth: m.authMock })));
vi.mock('@/lib/db', () => import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));
vi.mock('@/lib/rateLimit', () => ({ enforceRateLimit: vi.fn(async () => null) }));

const { GET } = await import('@/app/api/account/export/route');

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
});

describe('GET /api/account/export', () => {
  it('returns 401 when unauthenticated', () => expectUnauthorized(() => GET()));

  it("does not ask for Tournament.sourceUrlRaw: that column is the FIRST ingester's private URL", async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
    prismaMock.ingestJob.findMany.mockResolvedValue([]);
    prismaMock.person.findMany.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);

    // Both places the export pulls a whole Tournament row must omit the column.
    const discovered = prismaMock.discoveredUrl.findMany.mock.calls[0][0] as {
      include: { tournament: { omit?: { sourceUrlRaw?: boolean } } | boolean };
    };
    expect(discovered.include.tournament).toMatchObject({ omit: { sourceUrlRaw: true } });

    const persons = prismaMock.person.findMany.mock.calls[0][0] as {
      include: { participations: { include: { tournament: { omit?: { sourceUrlRaw?: boolean } } | boolean } } };
    };
    expect(persons.include.participations.include.tournament).toMatchObject({ omit: { sourceUrlRaw: true } });
  });
});
