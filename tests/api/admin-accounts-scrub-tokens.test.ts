import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from '../setup/api-test-utils';

vi.mock('@/lib/db', () => import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));
const requireAdminMock = vi.fn();
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));
const persistMock = vi.fn();
vi.mock('@/lib/gmail/client', () => ({ persistTokensFromAccount: persistMock }));

const { POST } = await import('@/app/api/admin/accounts/scrub-tokens/route');

const row = (id: string, userId: string, over: Record<string, unknown> = {}) => ({
  id,
  userId,
  provider: 'google',
  access_token: `AT-${id}`,
  refresh_token: `RT-${id}`,
  expires_at: 1_800_000_000,
  scope: 'gmail.readonly',
  ...over,
});

beforeEach(() => {
  requireAdminMock.mockReset();
  persistMock.mockReset();
  resetPrismaMock();
  requireAdminMock.mockResolvedValue('admin@example.com');
  persistMock.mockResolvedValue(undefined);
  prismaMock.account.update.mockResolvedValue({});
});

describe('POST /api/admin/accounts/scrub-tokens', () => {
  it('rejects non-admins and touches nothing', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    const res = await POST();
    expect(res.status).toBe(403);
    expect(prismaMock.account.findMany).not.toHaveBeenCalled();
    expect(prismaMock.account.update).not.toHaveBeenCalled();
  });

  it('saves the encrypted copy when there is none, then clears the plain tokens', async () => {
    prismaMock.account.findMany.mockResolvedValue([row('a1', 'u1')]);
    prismaMock.gmailToken.findUnique.mockResolvedValue(null);
    const res = await POST();
    expect(await res.json()).toEqual({ accountsChecked: 1, scrubbed: 1, leftUntouched: 0 });
    expect(persistMock).toHaveBeenCalledWith('u1', {
      access_token: 'AT-a1',
      refresh_token: 'RT-a1',
      expires_at: 1_800_000_000,
      scope: 'gmail.readonly',
    });
    expect(prismaMock.account.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { access_token: null, refresh_token: null, id_token: null },
    });
  });

  it('keeps an existing encrypted copy and only clears the plain tokens', async () => {
    prismaMock.account.findMany.mockResolvedValue([row('a1', 'u1')]);
    prismaMock.gmailToken.findUnique.mockResolvedValue({ userId: 'u1' });
    await POST();
    expect(persistMock).not.toHaveBeenCalled();
    expect(prismaMock.account.update).toHaveBeenCalledOnce();
  });

  it('leaves a row untouched when its encrypted copy cannot be saved, and still handles the rest', async () => {
    prismaMock.account.findMany.mockResolvedValue([row('a1', 'u1'), row('a2', 'u2')]);
    prismaMock.gmailToken.findUnique.mockResolvedValue(null);
    persistMock.mockRejectedValueOnce(new Error('encrypt failed'));
    const res = await POST();
    expect(await res.json()).toEqual({ accountsChecked: 2, scrubbed: 1, leftUntouched: 1 });
    expect(prismaMock.account.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.account.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'a2' } }));
  });

  it('never returns a token in the response', async () => {
    prismaMock.account.findMany.mockResolvedValue([row('a1', 'u1')]);
    prismaMock.gmailToken.findUnique.mockResolvedValue(null);
    const body = JSON.stringify(await (await POST()).json());
    expect(body).not.toContain('AT-');
    expect(body).not.toContain('RT-');
  });
});
