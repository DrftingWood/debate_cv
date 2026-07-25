import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authMock,
  prismaMock,
  resetPrismaMock,
  fakeSession,
  readJson,
} from '../setup/api-test-utils';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => ({ auth: m.authMock })));
vi.mock('@/lib/db', () => import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const requireAdminMock = vi.fn();
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));

const { POST, DELETE } = await import('@/app/api/admin/persons/[id]/suppress/route');

const req = (method: string) =>
  new Request('http://localhost/api/admin/persons/5/suppress', { method });
const params = Promise.resolve({ id: '5' });

function asAdmin() {
  authMock.mockResolvedValue(fakeSession('admin-1', 'admin@example.com'));
  requireAdminMock.mockResolvedValue('admin@example.com');
}

/** The Person the erasure request is about. */
function person(overrides: { claimedByUserId?: string | null; suppressedAt?: Date | null } = {}) {
  prismaMock.person.findUnique.mockResolvedValue({
    id: 5n,
    displayName: 'Maya Rao',
    claimedByUserId: null,
    suppressedAt: null,
    ...overrides,
  });
}

beforeEach(() => {
  authMock.mockReset();
  requireAdminMock.mockReset();
  resetPrismaMock();
  prismaMock.person.update.mockResolvedValue({ id: 5n });
});

describe('POST /api/admin/persons/[id]/suppress', () => {
  it('is admin-only — erasing a stranger is not a self-service button', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));

    const res = await POST(req('POST'), { params });
    expect(res.status).toBe(403);
    expect(prismaMock.person.update).not.toHaveBeenCalled();
  });

  it('suppresses an unclaimed Person by stamping suppressedAt', async () => {
    asAdmin();
    person();

    const res = await POST(req('POST'), { params });
    expect(res.status).toBe(200);
    const call = prismaMock.person.update.mock.calls[0][0] as {
      data: { suppressedAt: Date };
    };
    expect(call.data.suppressedAt).toBeInstanceOf(Date);
  });

  it('refuses a Person claimed by an account — that is the deletion path', async () => {
    asAdmin();
    person({ claimedByUserId: 'user-9' });

    const res = await POST(req('POST'), { params });
    expect(res.status).toBe(409);
    expect((await readJson<{ error: string }>(res)).error).toBe('claimed_person');
    expect(prismaMock.person.update).not.toHaveBeenCalled();
  });

  it('is idempotent — re-suppressing does not move the timestamp', async () => {
    asAdmin();
    const when = new Date('2026-01-02T03:04:05.000Z');
    person({ suppressedAt: when });

    const res = await POST(req('POST'), { params });
    expect(res.status).toBe(200);
    expect(await readJson<{ changed: boolean; suppressedAt: string }>(res)).toMatchObject({
      changed: false,
      suppressedAt: when.toISOString(),
    });
    expect(prismaMock.person.update).not.toHaveBeenCalled();
  });

  it('404s an unknown Person', async () => {
    asAdmin();
    prismaMock.person.findUnique.mockResolvedValue(null);

    const res = await POST(req('POST'), { params });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/persons/[id]/suppress', () => {
  it('restores a suppressed Person', async () => {
    asAdmin();
    person({ suppressedAt: new Date() });

    const res = await DELETE(req('DELETE'), { params });
    expect(res.status).toBe(200);
    const call = prismaMock.person.update.mock.calls[0][0] as {
      data: { suppressedAt: Date | null };
    };
    expect(call.data.suppressedAt).toBeNull();
  });

  it('is a no-op on a Person that was never suppressed', async () => {
    asAdmin();
    person();

    const res = await DELETE(req('DELETE'), { params });
    expect(res.status).toBe(200);
    expect(prismaMock.person.update).not.toHaveBeenCalled();
  });
});
