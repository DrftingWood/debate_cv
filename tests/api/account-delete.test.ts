import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authMock,
  prismaMock,
  resetPrismaMock,
  fakeSession,
  expectUnauthorized,
  expectMalformedBody,
  jsonRequest,
  readJson,
} from '../setup/api-test-utils';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => ({ auth: m.authMock })));
vi.mock('@/lib/db', () =>
  import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })),
);
vi.mock('@/lib/gmail/client', () => ({
  revokeAndForgetGmailToken: vi.fn(),
}));

const { POST } = await import('@/app/api/account/delete/route');

const call = (confirmEmail: unknown) =>
  POST(jsonRequest('/api/account/delete', { body: { confirmEmail } }));

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
});

describe('POST /api/account/delete', () => {
  it('returns 401 when unauthenticated', () => expectUnauthorized(() => call('a@b.c')));

  it('rejects an empty confirmation', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    await expectMalformedBody(() => call(''));
  });

  it('deletes when the typed email matches, ignoring case and spaces', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'maya@example.com' });
    prismaMock.user.delete.mockResolvedValue({});
    const res = await call('  Maya@Example.com ');
    expect(res.status).toBe(200);
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('refuses a mismatched email and deletes nothing', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'maya@example.com' });
    const res = await call('someone@else.com');
    expect(res.status).toBe(400);
    expect((await readJson<{ error: string }>(res)).error).toBe('email_mismatch');
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it('does not accept DELETE from an account that has an email', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'maya@example.com' });
    expect((await call('DELETE')).status).toBe(400);
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  // SET-2: an account with no email used to be undeletable (the server
  // compared against '' and zod refuses an empty string).
  it('lets an account with no email confirm by typing DELETE', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', email: null });
    prismaMock.user.delete.mockResolvedValue({});
    expect((await call('delete')).status).toBe(200);
    expect(prismaMock.user.delete).toHaveBeenCalledOnce();
  });
});
