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

const { GET, POST } = await import('@/app/api/sharing/route');

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
});

describe('GET /api/sharing', () => {
  it('returns 401 when unauthenticated', () => expectUnauthorized(() => GET()));

  it('returns the user sharing config', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.user.findUnique.mockResolvedValue({
      publicCvEnabled: true,
      publicCvSlug: 'abhi',
      publicAvatarEnabled: false,
    });
    const res = await GET();
    const data = await readJson<{ enabled: boolean; slug: string; avatarEnabled: boolean }>(res);
    expect(data).toEqual({ enabled: true, slug: 'abhi', avatarEnabled: false });
  });
});

describe('POST /api/sharing — slug validation', () => {
  beforeEach(() => {
    authMock.mockResolvedValue(fakeSession('user-1'));
  });

  it('rejects too-short custom slug', async () => {
    const res = await POST(jsonRequest('/api/sharing', { body: { customSlug: 'ab' } }));
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('too_short');
  });

  it('rejects too-long custom slug', async () => {
    const res = await POST(
      jsonRequest('/api/sharing', { body: { customSlug: 'a'.repeat(31) } }),
    );
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('too_long');
  });

  it('rejects reserved slug', async () => {
    const res = await POST(jsonRequest('/api/sharing', { body: { customSlug: 'admin' } }));
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('reserved');
  });

  it('rejects slug with invalid characters', async () => {
    const res = await POST(jsonRequest('/api/sharing', { body: { customSlug: 'My_Slug' } }));
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('invalid_chars');
  });

  it('rejects slug with double hyphen', async () => {
    const res = await POST(jsonRequest('/api/sharing', { body: { customSlug: 'foo--bar' } }));
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('invalid_chars');
  });

  it('rejects slug starting with hyphen', async () => {
    const res = await POST(jsonRequest('/api/sharing', { body: { customSlug: '-foo' } }));
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('invalid_chars');
  });

  it('accepts a valid custom slug', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ publicCvSlug: 'oldhash' });
    prismaMock.user.update.mockResolvedValue({
      publicCvEnabled: true,
      publicCvSlug: 'abhishek-acharya',
      publicAvatarEnabled: true,
    });
    const res = await POST(
      jsonRequest('/api/sharing', { body: { customSlug: 'abhishek-acharya' } }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({ publicCvSlug: 'abhishek-acharya' }),
      }),
    );
  });
});

describe('POST /api/sharing — toggle behaviour', () => {
  beforeEach(() => {
    authMock.mockResolvedValue(fakeSession('user-1'));
  });

  it('generates a fresh random slug on first enable when none exists', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ publicCvSlug: null }); // pre-update probe
    prismaMock.user.findUnique.mockResolvedValue(null); // collision check returns "free"
    prismaMock.user.update.mockResolvedValue({
      publicCvEnabled: true,
      publicCvSlug: 'k7dq3m',
      publicAvatarEnabled: true,
    });

    const res = await POST(jsonRequest('/api/sharing', { body: { enabled: true } }));
    expect(res.status).toBe(200);
    const updateArg = prismaMock.user.update.mock.calls[0]![0] as {
      data: { publicCvSlug?: string; publicCvEnabled?: boolean };
    };
    expect(updateArg.data.publicCvEnabled).toBe(true);
    // Slug must be generated; we don't assert its exact value (random) but it
    // must be present and well-formed.
    expect(updateArg.data.publicCvSlug).toMatch(/^[a-z2-9]{6}$/);
  });

  it('does not regenerate the slug if user already has one', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ publicCvSlug: 'existing' });
    prismaMock.user.update.mockResolvedValue({
      publicCvEnabled: true,
      publicCvSlug: 'existing',
      publicAvatarEnabled: true,
    });

    await POST(jsonRequest('/api/sharing', { body: { enabled: true } }));
    const updateArg = prismaMock.user.update.mock.calls[0]![0] as {
      data: { publicCvSlug?: string };
    };
    // No new slug — only the toggle changed.
    expect(updateArg.data.publicCvSlug).toBeUndefined();
  });

  it('returns 401 when unauthenticated', () =>
    expectUnauthorized(() => POST(jsonRequest('/api/sharing', { body: { enabled: true } }))));
});
