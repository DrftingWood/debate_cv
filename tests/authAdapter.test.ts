import { describe, expect, it, vi } from 'vitest';
import type { Adapter, AdapterAccount } from 'next-auth/adapters';
import { withoutStoredTokens } from '@/lib/authAdapter';

const account = (over: Partial<AdapterAccount> = {}): AdapterAccount => ({
  userId: 'user-1',
  type: 'oidc',
  provider: 'google',
  providerAccountId: 'g-123',
  access_token: 'AT-secret',
  refresh_token: 'RT-secret',
  id_token: 'IDT-secret',
  expires_at: 1_800_000_000,
  scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
  token_type: 'bearer',
  ...over,
});

function setup() {
  const calls: string[] = [];
  const linkAccount = vi.fn(async (_account: AdapterAccount) => {
    calls.push('link');
  });
  const persist = vi.fn(async () => {
    calls.push('persist');
  });
  const adapter = withoutStoredTokens({ linkAccount } as unknown as Adapter, persist);
  return { adapter, linkAccount, persist, calls };
}

describe('withoutStoredTokens', () => {
  it('saves the encrypted Gmail token first, then links the account', async () => {
    const { adapter, persist, calls } = setup();
    await adapter.linkAccount!(account());
    expect(calls).toEqual(['persist', 'link']);
    expect(persist).toHaveBeenCalledWith('user-1', {
      access_token: 'AT-secret',
      refresh_token: 'RT-secret',
      expires_at: 1_800_000_000,
      scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
    });
  });

  it('links the account without access, refresh or id tokens, keeping the rest', async () => {
    const { adapter, linkAccount } = setup();
    await adapter.linkAccount!(account());
    const written = linkAccount.mock.calls[0][0] as AdapterAccount;
    expect(written.access_token).toBeUndefined();
    expect(written.refresh_token).toBeUndefined();
    expect(written.id_token).toBeUndefined();
    expect(written).toMatchObject({
      userId: 'user-1',
      provider: 'google',
      providerAccountId: 'g-123',
      expires_at: 1_800_000_000,
      token_type: 'bearer',
    });
  });

  it('does not modify the account object it was given (the events read it afterwards)', async () => {
    const { adapter } = setup();
    const original = account();
    await adapter.linkAccount!(original);
    expect(original.access_token).toBe('AT-secret');
    expect(original.refresh_token).toBe('RT-secret');
  });

  it('creates no account row when the encrypted copy cannot be saved', async () => {
    const { adapter, linkAccount, persist } = setup();
    persist.mockRejectedValueOnce(new Error('db down'));
    await expect(adapter.linkAccount!(account())).rejects.toThrow('db down');
    expect(linkAccount).not.toHaveBeenCalled();
  });

  it('saves no Gmail token when Google returned no access token, and still links', async () => {
    const { adapter, linkAccount, persist } = setup();
    await adapter.linkAccount!(account({ access_token: undefined }));
    expect(persist).not.toHaveBeenCalled();
    expect(linkAccount).toHaveBeenCalledOnce();
  });
});
