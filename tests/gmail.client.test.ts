import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptValue, encryptValue } from '@/lib/crypto';
import { buildGmailTokenUpdate } from '@/lib/gmail/client';

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
