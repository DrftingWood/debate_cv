import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authMock,
  prismaMock,
  resetPrismaMock,
  fakeSession,
  jsonRequest,
  readJson,
} from '../setup/api-test-utils';

// requireAdmin calls auth() internally; we swap @/lib/auth to control the
// session and then mock @/lib/admin to either resolve (admin) or throw 403.
vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => ({ auth: m.authMock })));
vi.mock('@/lib/db', () => import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const requireAdminMock = vi.fn();
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));

const { GET } = await import('@/app/api/admin/tag-proposals/route');
const { POST } = await import('@/app/api/admin/tag-proposals/[id]/route');

/** Call as an admin (requireAdmin resolves). */
function asAdmin() {
  authMock.mockResolvedValue(fakeSession('admin-1', 'admin@example.com'));
  requireAdminMock.mockResolvedValue('admin@example.com');
}

/** Simulate a non-admin caller (requireAdmin throws 403). */
function asForbidden() {
  authMock.mockResolvedValue(fakeSession('user-1'));
  requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
}

beforeEach(() => {
  authMock.mockReset();
  requireAdminMock.mockReset();
  resetPrismaMock();
});

// ── GET /api/admin/tag-proposals ─────────────────────────────────────────────

describe('GET /api/admin/tag-proposals — gating', () => {
  it('returns 403 for non-admin users', async () => {
    asForbidden();
    const res = await GET(new Request('http://test/api/admin/tag-proposals'));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/tag-proposals — status filter', () => {
  beforeEach(() => asAdmin());

  it('rejects an invalid status query param', async () => {
    const res = await GET(
      new Request('http://test/api/admin/tag-proposals?status=bogus'),
    );
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('bad_request');
    expect(prismaMock.tagProposal.findMany).not.toHaveBeenCalled();
  });

  it('defaults to status=pending when no query param', async () => {
    prismaMock.tagProposal.findMany.mockResolvedValue([]);
    await GET(new Request('http://test/api/admin/tag-proposals'));
    expect(prismaMock.tagProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'pending' } }),
    );
  });

  it('passes approved status to prisma', async () => {
    prismaMock.tagProposal.findMany.mockResolvedValue([]);
    await GET(new Request('http://test/api/admin/tag-proposals?status=approved'));
    expect(prismaMock.tagProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'approved' } }),
    );
  });

  it('passes rejected status to prisma', async () => {
    prismaMock.tagProposal.findMany.mockResolvedValue([]);
    await GET(new Request('http://test/api/admin/tag-proposals?status=rejected'));
    expect(prismaMock.tagProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'rejected' } }),
    );
  });
});

describe('GET /api/admin/tag-proposals — response shape', () => {
  beforeEach(() => asAdmin());

  it('returns serialized proposals with display context', async () => {
    prismaMock.tagProposal.findMany.mockResolvedValue([
      {
        id: 'prop-1',
        kind: 'region',
        value: 'Europe',
        status: 'pending',
        adminNote: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        tournamentId: BigInt(42),
        motionId: null,
        user: { email: 'user@example.com' },
        tournament: { name: 'Euros 2026', region: null },
        motion: null,
      },
    ]);

    const res = await GET(new Request('http://test/api/admin/tag-proposals'));
    expect(res.status).toBe(200);
    const data = await readJson<{ proposals: unknown[] }>(res);
    expect(data.proposals).toHaveLength(1);
    expect(data.proposals[0]).toEqual({
      id: 'prop-1',
      kind: 'region',
      value: 'Europe',
      status: 'pending',
      adminNote: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      userEmail: 'user@example.com',
      tournamentId: '42',
      tournamentName: 'Euros 2026',
      motionId: null,
      motionText: null,
      // Tournament.region is null — no canonical value set yet
      currentValue: null,
    });
  });

  it('exposes Tournament.region as currentValue for region proposals', async () => {
    prismaMock.tagProposal.findMany.mockResolvedValue([
      {
        id: 'prop-2',
        kind: 'region',
        value: 'North America',
        status: 'pending',
        adminNote: null,
        createdAt: new Date('2026-01-02T00:00:00Z'),
        tournamentId: BigInt(10),
        motionId: null,
        user: { email: 'a@b.com' },
        tournament: { name: 'NATS', region: 'North America' },
        motion: null,
      },
    ]);

    const res = await GET(new Request('http://test/api/admin/tag-proposals'));
    const data = await readJson<{ proposals: Array<{ currentValue: string | null }> }>(res);
    expect(data.proposals[0]!.currentValue).toBe('North America');
  });

  it('exposes Motion.motionType as currentValue for motion_type proposals', async () => {
    prismaMock.tagProposal.findMany.mockResolvedValue([
      {
        id: 'prop-3',
        kind: 'motion_type',
        value: 'THBT',
        status: 'pending',
        adminNote: null,
        createdAt: new Date(),
        tournamentId: BigInt(10),
        motionId: BigInt(7),
        user: { email: 'a@b.com' },
        tournament: { name: 'NATS', region: null },
        motion: { text: 'THBT cats rule', motionType: 'THBT', topic: null },
      },
    ]);

    const res = await GET(new Request('http://test/api/admin/tag-proposals'));
    const data = await readJson<{
      proposals: Array<{ currentValue: string | null; motionText: string | null }>;
    }>(res);
    expect(data.proposals[0]!.currentValue).toBe('THBT');
    expect(data.proposals[0]!.motionText).toBe('THBT cats rule');
  });

  it('exposes Motion.topic as currentValue for motion_topic proposals', async () => {
    prismaMock.tagProposal.findMany.mockResolvedValue([
      {
        id: 'prop-4',
        kind: 'motion_topic',
        value: 'Economics & Business',
        status: 'pending',
        adminNote: null,
        createdAt: new Date(),
        tournamentId: BigInt(10),
        motionId: BigInt(7),
        user: { email: 'a@b.com' },
        tournament: { name: 'NATS', region: null },
        motion: { text: 'THBT free trade', motionType: null, topic: 'Economics & Business' },
      },
    ]);

    const res = await GET(new Request('http://test/api/admin/tag-proposals'));
    const data = await readJson<{ proposals: Array<{ currentValue: string | null }> }>(res);
    expect(data.proposals[0]!.currentValue).toBe('Economics & Business');
  });
});

// ── POST /api/admin/tag-proposals/[id] ──────────────────────────────────────

describe('POST /api/admin/tag-proposals/[id] — gating', () => {
  it('returns 403 for non-admin users', async () => {
    asForbidden();
    const res = await POST(jsonRequest('/api/admin/tag-proposals/prop-1', { body: { action: 'reject' } }), {
      params: Promise.resolve({ id: 'prop-1' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/tag-proposals/[id] — validation', () => {
  beforeEach(() => asAdmin());

  it('returns 400 for malformed body', async () => {
    const res = await POST(
      jsonRequest('/api/admin/tag-proposals/prop-1', { body: { action: 'explode' } }),
      { params: Promise.resolve({ id: 'prop-1' }) },
    );
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('bad_request');
  });

  it('returns 404 when proposal does not exist', async () => {
    prismaMock.tagProposal.findUnique.mockResolvedValue(null);
    const res = await POST(
      jsonRequest('/api/admin/tag-proposals/missing', { body: { action: 'reject' } }),
      { params: Promise.resolve({ id: 'missing' }) },
    );
    expect(res.status).toBe(404);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('not_found');
  });
});

describe('POST /api/admin/tag-proposals/[id] — reject', () => {
  beforeEach(() => asAdmin());

  it('sets status=rejected and adminNote, does NOT write canonical columns', async () => {
    prismaMock.tagProposal.findUnique.mockResolvedValue({
      id: 'prop-r',
      kind: 'region',
      tournamentId: BigInt(42),
      motionId: null,
      value: 'Wrong Place',
      status: 'pending',
    });

    const res = await POST(
      jsonRequest('/api/admin/tag-proposals/prop-r', {
        body: { action: 'reject', adminNote: 'Not a valid region' },
      }),
      { params: Promise.resolve({ id: 'prop-r' }) },
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ id: string; status: string }>(res);
    expect(data).toEqual({ id: 'prop-r', status: 'rejected' });

    expect(prismaMock.tagProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prop-r' },
        data: expect.objectContaining({
          status: 'rejected',
          adminNote: 'Not a valid region',
        }),
      }),
    );
    // Canonical columns must not be touched on reject
    expect(prismaMock.tournament.update).not.toHaveBeenCalled();
    expect(prismaMock.motion.update).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects without an adminNote (optional field)', async () => {
    prismaMock.tagProposal.findUnique.mockResolvedValue({
      id: 'prop-r2',
      kind: 'region',
      tournamentId: BigInt(1),
      motionId: null,
      value: 'Bad Value',
      status: 'pending',
    });

    const res = await POST(
      jsonRequest('/api/admin/tag-proposals/prop-r2', { body: { action: 'reject' } }),
      { params: Promise.resolve({ id: 'prop-r2' }) },
    );
    expect(res.status).toBe(200);
    expect(prismaMock.tagProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ adminNote: null }),
      }),
    );
  });
});

describe('POST /api/admin/tag-proposals/[id] — approve: writes canonical value', () => {
  beforeEach(() => asAdmin());

  it('writes Tournament.region and auto-approves duplicates for kind=region', async () => {
    prismaMock.tagProposal.findUnique.mockResolvedValue({
      id: 'prop-a',
      kind: 'region',
      tournamentId: BigInt(42),
      motionId: null,
      value: 'Europe',
      status: 'pending',
    });

    const res = await POST(
      jsonRequest('/api/admin/tag-proposals/prop-a', { body: { action: 'approve' } }),
      { params: Promise.resolve({ id: 'prop-a' }) },
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ id: string; status: string }>(res);
    expect(data).toEqual({ id: 'prop-a', status: 'approved' });

    // Transaction must have been used
    expect(prismaMock.$transaction).toHaveBeenCalled();

    // (a) proposal itself approved
    expect(prismaMock.tagProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prop-a' },
        data: expect.objectContaining({ status: 'approved' }),
      }),
    );
    // (b) canonical column written
    expect(prismaMock.tournament.update).toHaveBeenCalledWith({
      where: { id: BigInt(42) },
      data: { region: 'Europe' },
    });
    expect(prismaMock.motion.update).not.toHaveBeenCalled();
    // (c) duplicate pending proposals for same value auto-approved
    expect(prismaMock.tagProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: 'prop-a' },
          kind: 'region',
          tournamentId: BigInt(42),
          motionId: null,
          value: 'Europe',
          status: 'pending',
        }),
        data: expect.objectContaining({ status: 'approved' }),
      }),
    );
  });

  it('writes Motion.motionType for kind=motion_type', async () => {
    prismaMock.tagProposal.findUnique.mockResolvedValue({
      id: 'prop-mt',
      kind: 'motion_type',
      tournamentId: BigInt(10),
      motionId: BigInt(7),
      value: 'THW',
      status: 'pending',
    });

    await POST(
      jsonRequest('/api/admin/tag-proposals/prop-mt', { body: { action: 'approve' } }),
      { params: Promise.resolve({ id: 'prop-mt' }) },
    );

    expect(prismaMock.motion.update).toHaveBeenCalledWith({
      where: { id: BigInt(7) },
      data: { motionType: 'THW' },
    });
    expect(prismaMock.tournament.update).not.toHaveBeenCalled();
  });

  it('writes Motion.topic for kind=motion_topic', async () => {
    prismaMock.tagProposal.findUnique.mockResolvedValue({
      id: 'prop-topic',
      kind: 'motion_topic',
      tournamentId: BigInt(10),
      motionId: BigInt(7),
      value: 'International Relations',
      status: 'pending',
    });

    await POST(
      jsonRequest('/api/admin/tag-proposals/prop-topic', { body: { action: 'approve' } }),
      { params: Promise.resolve({ id: 'prop-topic' }) },
    );

    expect(prismaMock.motion.update).toHaveBeenCalledWith({
      where: { id: BigInt(7) },
      data: { topic: 'International Relations' },
    });
    expect(prismaMock.tournament.update).not.toHaveBeenCalled();
  });

  it('is idempotent when re-approving an already-approved proposal', async () => {
    // The spec says re-applying a terminal status is OK (idempotent). We still
    // run the transaction — the canonical column gets the same value again,
    // which is a harmless no-op from the DB's perspective. The response is
    // still 200 { status: 'approved' }.
    prismaMock.tagProposal.findUnique.mockResolvedValue({
      id: 'prop-again',
      kind: 'region',
      tournamentId: BigInt(5),
      motionId: null,
      value: 'Oceania',
      status: 'approved',
    });

    const res = await POST(
      jsonRequest('/api/admin/tag-proposals/prop-again', { body: { action: 'approve' } }),
      { params: Promise.resolve({ id: 'prop-again' }) },
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ status: string }>(res);
    expect(data.status).toBe('approved');
  });
});
