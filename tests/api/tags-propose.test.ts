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

const { POST } = await import('@/app/api/tags/propose/route');

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
});

// ── authentication ───────────────────────────────────────────────────────────

describe('POST /api/tags/propose — auth', () => {
  it('returns 401 when unauthenticated', () =>
    expectUnauthorized(() =>
      POST(
        jsonRequest('/api/tags/propose', {
          body: { kind: 'region', tournamentId: '1', value: 'Europe' },
        }),
      ),
    ));
});

// ── schema validation ────────────────────────────────────────────────────────

describe('POST /api/tags/propose — schema validation', () => {
  beforeEach(() => authMock.mockResolvedValue(fakeSession('user-1')));

  it('rejects an unknown kind', async () => {
    const res = await POST(
      jsonRequest('/api/tags/propose', {
        body: { kind: 'invalid_kind', tournamentId: '1', value: 'Europe' },
      }),
    );
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('bad_request');
    // Zod rejects at parse time — no DB calls should have been made
    expect(prismaMock.discoveredUrl.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric tournamentId', async () => {
    const res = await POST(
      jsonRequest('/api/tags/propose', {
        body: { kind: 'region', tournamentId: 'not-a-number', value: 'Europe' },
      }),
    );
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('bad_request');
  });

  it('rejects a value not in the vocabulary for the kind', async () => {
    const res = await POST(
      jsonRequest('/api/tags/propose', {
        body: { kind: 'region', tournamentId: '1', value: 'Fake Continent' },
      }),
    );
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string; reason?: string }>(res);
    expect(data.error).toBe('bad_request');
    expect(data.reason).toMatch(/vocabulary/);
    expect(prismaMock.discoveredUrl.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a valid motion_type value with a bad value string', async () => {
    const res = await POST(
      jsonRequest('/api/tags/propose', {
        body: { kind: 'motion_type', tournamentId: '1', motionId: '5', value: 'NotAType' },
      }),
    );
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('bad_request');
  });
});

// ── motionId coupling rules ──────────────────────────────────────────────────

describe('POST /api/tags/propose — motionId coupling', () => {
  beforeEach(() => authMock.mockResolvedValue(fakeSession('user-1')));

  it('rejects kind=region WITH a motionId', async () => {
    const res = await POST(
      jsonRequest('/api/tags/propose', {
        body: { kind: 'region', tournamentId: '1', motionId: '5', value: 'Europe' },
      }),
    );
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string; reason?: string }>(res);
    expect(data.error).toBe('bad_request');
    expect(data.reason).toMatch(/region/);
    expect(prismaMock.discoveredUrl.findFirst).not.toHaveBeenCalled();
  });

  it('rejects kind=motion_type WITHOUT a motionId', async () => {
    const res = await POST(
      jsonRequest('/api/tags/propose', {
        body: { kind: 'motion_type', tournamentId: '1', value: 'THBT' },
      }),
    );
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string; reason?: string }>(res);
    expect(data.error).toBe('bad_request');
    expect(data.reason).toMatch(/motionId is required/);
    expect(prismaMock.discoveredUrl.findFirst).not.toHaveBeenCalled();
  });

  it('rejects kind=motion_topic WITHOUT a motionId', async () => {
    const res = await POST(
      jsonRequest('/api/tags/propose', {
        body: { kind: 'motion_topic', tournamentId: '1', value: 'Economics & Business' },
      }),
    );
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string; reason?: string }>(res);
    expect(data.error).toBe('bad_request');
    expect(data.reason).toMatch(/motionId is required/);
  });
});

// ── authorization (tournament on CV) ────────────────────────────────────────

describe('POST /api/tags/propose — authorization', () => {
  beforeEach(() => authMock.mockResolvedValue(fakeSession('user-1')));

  it('returns 404 when tournament is not on the user CV', async () => {
    prismaMock.discoveredUrl.findFirst.mockResolvedValue(null);
    const res = await POST(
      jsonRequest('/api/tags/propose', {
        body: { kind: 'region', tournamentId: '42', value: 'Europe' },
      }),
    );
    expect(res.status).toBe(404);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('not_found');
    // Confirm we queried with the right tournament (BigInt-coerced) and userId
    expect(prismaMock.discoveredUrl.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          tournamentId: BigInt(42),
          ingestedAt: { not: null },
        }),
      }),
    );
  });

  it('returns 404 when motionId does not belong to the tournament', async () => {
    prismaMock.discoveredUrl.findFirst.mockResolvedValue({ id: 'du-1' });
    prismaMock.motion.findFirst.mockResolvedValue(null); // motion not found / wrong tournament
    const res = await POST(
      jsonRequest('/api/tags/propose', {
        body: { kind: 'motion_type', tournamentId: '42', motionId: '99', value: 'THBT' },
      }),
    );
    expect(res.status).toBe(404);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('not_found');
    expect(prismaMock.motion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: BigInt(99),
          tournamentId: BigInt(42),
        }),
      }),
    );
  });
});

// ── create vs update ─────────────────────────────────────────────────────────

describe('POST /api/tags/propose — create path', () => {
  beforeEach(() => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.discoveredUrl.findFirst.mockResolvedValue({ id: 'du-1' });
  });

  it('creates a new region proposal when none exists', async () => {
    prismaMock.tagProposal.findFirst.mockResolvedValue(null); // no existing
    prismaMock.tagProposal.create.mockResolvedValue({ id: 'prop-1' });

    const res = await POST(
      jsonRequest('/api/tags/propose', {
        body: { kind: 'region', tournamentId: '42', value: 'Europe' },
      }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ id: string; status: string }>(res);
    expect(data).toEqual({ id: 'prop-1', status: 'pending' });

    expect(prismaMock.tagProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          kind: 'region',
          tournamentId: BigInt(42),
          motionId: null,
          value: 'Europe',
        }),
      }),
    );
    expect(prismaMock.tagProposal.update).not.toHaveBeenCalled();
  });

  it('creates a new motion_topic proposal when none exists', async () => {
    prismaMock.motion.findFirst.mockResolvedValue({ id: BigInt(7) });
    prismaMock.tagProposal.findFirst.mockResolvedValue(null);
    prismaMock.tagProposal.create.mockResolvedValue({ id: 'prop-2' });

    const res = await POST(
      jsonRequest('/api/tags/propose', {
        body: {
          kind: 'motion_topic',
          tournamentId: '42',
          motionId: '7',
          value: 'Economics & Business',
        },
      }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ id: string; status: string }>(res);
    expect(data.id).toBe('prop-2');
    expect(prismaMock.tagProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'motion_topic',
          motionId: BigInt(7),
        }),
      }),
    );
  });
});

describe('POST /api/tags/propose — update (re-propose) path', () => {
  beforeEach(() => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.discoveredUrl.findFirst.mockResolvedValue({ id: 'du-1' });
  });

  it('updates an existing proposal back to pending with new value', async () => {
    prismaMock.tagProposal.findFirst.mockResolvedValue({ id: 'prop-existing' });
    prismaMock.tagProposal.update.mockResolvedValue({ id: 'prop-existing' });

    const res = await POST(
      jsonRequest('/api/tags/propose', {
        body: { kind: 'region', tournamentId: '42', value: 'North America' },
      }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ id: string; status: string }>(res);
    expect(data).toEqual({ id: 'prop-existing', status: 'pending' });

    expect(prismaMock.tagProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prop-existing' },
        data: expect.objectContaining({
          value: 'North America',
          status: 'pending',
          adminNote: null,
          reviewedAt: null,
        }),
      }),
    );
    expect(prismaMock.tagProposal.create).not.toHaveBeenCalled();
  });

  it('looks up existing proposal with correct key fields', async () => {
    prismaMock.motion.findFirst.mockResolvedValue({ id: BigInt(7) });
    prismaMock.tagProposal.findFirst.mockResolvedValue({ id: 'prop-motion' });
    prismaMock.tagProposal.update.mockResolvedValue({ id: 'prop-motion' });

    await POST(
      jsonRequest('/api/tags/propose', {
        body: {
          kind: 'motion_type',
          tournamentId: '42',
          motionId: '7',
          value: 'THW',
        },
      }),
    );

    expect(prismaMock.tagProposal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          kind: 'motion_type',
          tournamentId: BigInt(42),
          motionId: BigInt(7),
        }),
      }),
    );
  });
});
