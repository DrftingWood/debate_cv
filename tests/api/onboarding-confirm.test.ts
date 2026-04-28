import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authMock,
  prismaMock,
  resetPrismaMock,
  fakeSession,
  expectUnauthorized,
  jsonRequest,
  readJson,
} from '../setup/api-test-utils';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => ({ auth: m.authMock })));
vi.mock('@/lib/db', () => import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { POST } = await import('@/app/api/onboarding/confirm/route');

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
});

describe('POST /api/onboarding/confirm — set-style claim semantics', () => {
  it('returns 401 when unauthenticated', () =>
    expectUnauthorized(() =>
      POST(jsonRequest('/api/onboarding/confirm', { body: { names: [] } })),
    ));

  it('claims the requested names', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.$queryRaw.mockResolvedValue([{ id: BigInt(1) }]);
    prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
    prismaMock.person.updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(
      jsonRequest('/api/onboarding/confirm', {
        body: { names: ['Abhishek Acharya'] },
      }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ claimed: number; unclaimed: number }>(res);
    expect(data.claimed).toBe(1);
    expect(data.unclaimed).toBe(0);
  });

  it('unclaims picker-visible names that were not ticked (set semantics from PR #75)', async () => {
    // The user previously claimed Shaurya + Abhishek. They re-enter the
    // picker, which shows both names (because both registration names exist
    // on their DiscoveredUrls), and only tick Abhishek. The endpoint must
    // unclaim Shaurya as part of the SAME submit.
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.$queryRaw.mockResolvedValue([{ id: BigInt(1) }]);
    prismaMock.discoveredUrl.findMany.mockResolvedValue([
      { registrationName: 'Abhishek Acharya' },
      { registrationName: 'Shaurya Chandravanshi' },
    ]);
    prismaMock.person.updateMany.mockResolvedValue({ count: 1 });

    const res = await POST(
      jsonRequest('/api/onboarding/confirm', {
        body: { names: ['Abhishek Acharya'] },
      }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ claimed: number; unclaimed: number }>(res);
    expect(data.claimed).toBe(1);
    expect(data.unclaimed).toBe(1);
    // The unclaim updateMany should be scoped to picker-visible names
    // (Abhishek + Shaurya) MINUS the requested name (Abhishek) — i.e.,
    // just Shaurya's normalized name.
    expect(prismaMock.person.updateMany).toHaveBeenCalledWith({
      where: {
        claimedByUserId: 'user-1',
        normalizedName: { in: ['shaurya chandravanshi'] },
      },
      data: { claimedByUserId: null },
    });
  });

  it('does NOT unclaim names outside the picker scope (defence in depth)', async () => {
    // If the user has a claimed Person whose normalizedName isn't visible
    // in the picker (no DiscoveredUrl with that registration name), the
    // submission must NOT touch it — preventing accidental unclaim of
    // identities the user couldn't see to retick.
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.$queryRaw.mockResolvedValue([{ id: BigInt(1) }]);
    prismaMock.discoveredUrl.findMany.mockResolvedValue([
      { registrationName: 'Abhishek Acharya' }, // only this name visible
    ]);
    prismaMock.person.updateMany.mockResolvedValue({ count: 0 });

    await POST(
      jsonRequest('/api/onboarding/confirm', {
        body: { names: ['Abhishek Acharya'] },
      }),
    );
    // The updateMany may or may not be called, but if called, the `in`
    // list must be empty (picker scope − requested = ∅).
    if (prismaMock.person.updateMany.mock.calls.length > 0) {
      const arg = prismaMock.person.updateMany.mock.calls[0]![0] as {
        where: { normalizedName: { in: string[] } };
      };
      expect(arg.where.normalizedName.in).toEqual([]);
    }
  });
});
