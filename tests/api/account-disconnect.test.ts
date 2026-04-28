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

  it('returns 500 when token revocation throws', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    vi.mocked(revokeAndForgetGmailToken).mockRejectedValue(new Error('Google API down'));
    const res = await POST();
    expect(res.status).toBe(500);
  });
});
