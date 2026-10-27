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

  it('still links the account, without tokens, when the encrypted copy cannot be saved (sign-in must not break)', async () => {
    const { linkAccount, persist } = setup();
    const onError = vi.fn();
    const adapter = withoutStoredTokens({ linkAccount } as unknown as Adapter, persist, onError);
    persist.mockRejectedValueOnce(new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes'));
    await adapter.linkAccount!(account());
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'user-1');
    const written = linkAccount.mock.calls[0][0] as AdapterAccount;
    expect(written.access_token).toBeUndefined();
    expect(written.refresh_token).toBeUndefined();
    expect(written.id_token).toBeUndefined();
  });

  it('saves no Gmail token when Google returned no access token, and still links', async () => {
    const { adapter, linkAccount, persist } = setup();
    await adapter.linkAccount!(account({ access_token: undefined }));
    expect(persist).not.toHaveBeenCalled();
    expect(linkAccount).toHaveBeenCalledOnce();
  });

  it('saves no Gmail token for another provider, but still strips its tokens before linking', async () => {
    const { adapter, linkAccount, persist } = setup();
    await adapter.linkAccount!(account({ provider: 'github' }));
    expect(persist).not.toHaveBeenCalled();
    const written = linkAccount.mock.calls[0][0] as AdapterAccount;
    expect(written.provider).toBe('github');
    expect(written.access_token).toBeUndefined();
    expect(written.refresh_token).toBeUndefined();
  });

  it("returns whatever the base adapter's linkAccount returns", async () => {
    const linked = { ...account(), access_token: undefined };
    const base = { linkAccount: vi.fn(async () => linked) };
    const adapter = withoutStoredTokens(
      base as unknown as Adapter,
      vi.fn(async () => {}),
    );
    await expect(adapter.linkAccount!(account())).resolves.toBe(linked);
  });

  it('keeps every other adapter method unchanged', () => {
    const getUser = vi.fn();
    const adapter = withoutStoredTokens(
      { getUser, linkAccount: vi.fn() } as unknown as Adapter,
      vi.fn(),
    );
    expect(adapter.getUser).toBe(getUser);
  });

  it('tolerates a base adapter with no linkAccount (resolves undefined after persisting)', async () => {
    const persist = vi.fn(async () => {});
    const adapter = withoutStoredTokens({} as Adapter, persist);
    await expect(adapter.linkAccount!(account())).resolves.toBeUndefined();
    expect(persist).toHaveBeenCalledOnce();
  });
});
