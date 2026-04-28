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
vi.mock('@/lib/gmail/client', () => ({
  revokeAndForgetGmailToken: vi.fn(),
}));

const { POST } = await import('@/app/api/account/disconnect/route');
const { revokeAndForgetGmailToken } = await import('@/lib/gmail/client');

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
  vi.mocked(revokeAndForgetGmailToken).mockReset();
});

describe('POST /api/account/disconnect', () => {
  it('returns 401 when unauthenticated', () => expectUnauthorized(() => POST()));

  it('revokes the Gmail token and deletes the linked Google Account', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    vi.mocked(revokeAndForgetGmailToken).mockResolvedValue(undefined);
    prismaMock.account.deleteMany.mockResolvedValue({ count: 1 });

    const res = await POST();
    expect(res.status).toBe(200);
    expect(revokeAndForgetGmailToken).toHaveBeenCalledWith('user-1');
    expect(prismaMock.account.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', provider: 'google' },
    });
  });

  it('returns 500 with the error message when token revocation throws', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    vi.mocked(revokeAndForgetGmailToken).mockRejectedValue(new Error('Google API down'));
    const res = await POST();
    expect(res.status).toBe(500);
    // Verify the body shape — a 500 with malformed/missing error payload
    // would let the client toast read "undefined" instead of a real message.
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('Google API down');
    // The Google Account row should NOT be deleted when revocation fails —
    // we want the user to be able to retry without re-OAuth'ing first.
    expect(prismaMock.account.deleteMany).not.toHaveBeenCalled();
  });
});
