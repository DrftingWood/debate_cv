import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptValue, encryptValue } from '@/lib/crypto';
import { buildGmailTokenUpdate } from '@/lib/gmail/client';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));

describe('buildGmailTokenUpdate', () => {
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = originalKey;
  });

  test('re-encrypts a legacy plaintext refresh token when Google omits it', () => {
    const update = buildGmailTokenUpdate(
      { access_token: 'new-access', refresh_token: undefined },
      { refreshToken: 'plain-refresh', encryptionVersion: null },
    );

    expect(update.encryptionVersion).toBe('v1');
    expect(update.refreshToken).toMatch(/^v1:/);
    expect(decryptValue(update.refreshToken, update.encryptionVersion)).toBe('plain-refresh');
  });

  test('treats null refresh_token as omitted instead of deleting the saved refresh token', () => {
    const existing = encryptValue('saved-refresh');
    const update = buildGmailTokenUpdate(
      { access_token: 'new-access', refresh_token: null },
      { refreshToken: existing.value, encryptionVersion: existing.version },
    );

    expect(decryptValue(update.refreshToken, update.encryptionVersion)).toBe('saved-refresh');
  });

  test('uses a new refresh token when Google provides one', () => {
    const update = buildGmailTokenUpdate(
      { access_token: 'new-access', refresh_token: 'new-refresh' },
      { refreshToken: 'plain-refresh', encryptionVersion: null },
    );

    expect(decryptValue(update.refreshToken, update.encryptionVersion)).toBe('new-refresh');
  });
});

describe('syncGmailTokenFromAccount', () => {
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const { resetPrismaMock } = await import('./setup/api-test-utils');
    resetPrismaMock();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = originalKey;
  });

  test('returns false when no google Account row exists', async () => {
    const { prismaMock } = await import('./setup/api-test-utils');
    const { syncGmailTokenFromAccount } = await import('@/lib/gmail/client');

    prismaMock.account.findFirst.mockResolvedValue(null);
    const result = await syncGmailTokenFromAccount('user-1');

    expect(result).toBe(false);
    expect(prismaMock.gmailToken.upsert).not.toHaveBeenCalled();
  });

  test('returns false when google Account exists but has no access_token', async () => {
    const { prismaMock } = await import('./setup/api-test-utils');
    const { syncGmailTokenFromAccount } = await import('@/lib/gmail/client');

    prismaMock.account.findFirst.mockResolvedValue({
      access_token: null,
      refresh_token: 'r',
      expires_at: 1700000000,
      scope: 'gmail.readonly',
    });
    const result = await syncGmailTokenFromAccount('user-1');

    expect(result).toBe(false);
    expect(prismaMock.gmailToken.upsert).not.toHaveBeenCalled();
  });

  test('returns false (does not throw) when prisma rejects the upsert', async () => {
    const { prismaMock } = await import('./setup/api-test-utils');
    const { syncGmailTokenFromAccount } = await import('@/lib/gmail/client');

    prismaMock.account.findFirst.mockResolvedValue({
      access_token: 'plain-access',
      refresh_token: 'plain-refresh',
      expires_at: 1700000000,
      scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
    });
    prismaMock.gmailToken.findUnique.mockResolvedValue(null);
    prismaMock.gmailToken.upsert.mockRejectedValue(
      new Error('Invalid `prisma.gmailToken.upsert()` invocation: Unknown column …'),
    );

    const result = await syncGmailTokenFromAccount('user-1');

    expect(result).toBe(false);
  });

  test('upserts an encrypted GmailToken row when Account has tokens', async () => {
    const { prismaMock } = await import('./setup/api-test-utils');
    const { syncGmailTokenFromAccount } = await import('@/lib/gmail/client');

    prismaMock.account.findFirst.mockResolvedValue({
      access_token: 'plain-access',
      refresh_token: 'plain-refresh',
      expires_at: 1700000000,
      scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
    });
    prismaMock.gmailToken.findUnique.mockResolvedValue(null);
    prismaMock.gmailToken.upsert.mockResolvedValue({});

    const result = await syncGmailTokenFromAccount('user-1');

    expect(result).toBe(true);
    expect(prismaMock.gmailToken.upsert).toHaveBeenCalledTimes(1);
    const call = prismaMock.gmailToken.upsert.mock.calls[0][0] as {
      where: { userId: string };
      create: { accessToken: string; refreshToken: string | null; encryptionVersion: string | null };
    };
    expect(call.where.userId).toBe('user-1');
    expect(call.create.encryptionVersion).toBe('v1');
    expect(decryptValue(call.create.accessToken, call.create.encryptionVersion)).toBe('plain-access');
    expect(decryptValue(call.create.refreshToken, call.create.encryptionVersion)).toBe('plain-refresh');
  });
});
