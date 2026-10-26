import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterAccount } from 'next-auth/adapters';

/**
 * lib/auth.ts is NextAuth configuration plus a sign-in event that copies
 * Google's tokens into the encrypted GmailToken row when the adapter has not
 * just done so. The adapter wrapper has
 * its own suite (authAdapter.test.ts); this one pins the rest: the Google
 * provider's scope and offline-access settings, the database session
 * strategy, the adapter's error hook, and the userId fallback chain inside
 * the events (resolveUserId), which exists because NextAuth v5 beta sometimes
 * hands the events a user without an id.
 *
 * NextAuth itself is mocked to capture the config object it is given, so the
 * events run as plain functions with no OAuth round trip.
 */

const h = vi.hoisted(() => ({
  config: undefined as undefined | Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  baseLinkAccount: vi.fn(),
  persist: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('next-auth', () => ({
  default: (config: Record<string, unknown>) => {
    h.config = config;
    return {
      auth: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
      handlers: { GET: vi.fn(), POST: vi.fn() },
    };
  },
}));
vi.mock('next-auth/providers/google', () => ({
  default: (options: Record<string, unknown>) => ({ id: 'google', options }),
}));
vi.mock('@auth/prisma-adapter', () => ({
  PrismaAdapter: () => ({ linkAccount: h.baseLinkAccount }),
}));
vi.mock('@/lib/gmail/client', () => ({ persistTokensFromAccount: h.persist }));
vi.mock('@sentry/nextjs', () => ({ captureException: h.captureException }));
vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));

import { prismaMock, resetPrismaMock } from './setup/api-test-utils';
import '@/lib/auth';

type Events = {
  signIn: (args: {
    user: Record<string, unknown>;
    account: Record<string, unknown> | null;
    profile?: Record<string, unknown>;
  }) => Promise<void>;
};
const events = () => h.config!.events as Events;

const googleAccount = (over: Record<string, unknown> = {}) => ({
  provider: 'google',
  providerAccountId: 'g-123',
  type: 'oidc',
  access_token: 'AT',
  refresh_token: 'RT',
  expires_at: 1_800_000_000,
  scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
  ...over,
});

const tokensOf = { access_token: 'AT', refresh_token: 'RT', expires_at: 1_800_000_000, scope: googleAccount().scope };

beforeEach(() => {
  resetPrismaMock();
  h.persist.mockReset().mockResolvedValue(undefined);
  h.baseLinkAccount.mockReset().mockResolvedValue(undefined);
  h.captureException.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('NextAuth configuration', () => {
  it('uses database sessions and the landing page as the sign-in page', () => {
    expect(h.config!.session).toEqual({ strategy: 'database' });
    expect(h.config!.pages).toEqual({ signIn: '/' });
  });

  it('asks Google for offline access, a consent prompt and read-only Gmail', () => {
    const [google] = h.config!.providers as Array<{ id: string; options: { authorization: { params: Record<string, string> } } }>;
    expect(google.id).toBe('google');
    expect(google.options.authorization.params).toEqual({
      access_type: 'offline',
      prompt: 'consent',
      scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
    });
  });

  it("the adapter's persist-failure hook logs and reports to Sentry, and sign-in still links", async () => {
    const boom = new Error('bad TOKEN_ENCRYPTION_KEY');
    h.persist.mockRejectedValueOnce(boom);
    const adapter = h.config!.adapter as { linkAccount: (a: AdapterAccount) => Promise<unknown> };
    await adapter.linkAccount({ ...googleAccount(), userId: 'user-1' } as AdapterAccount);
    expect(h.baseLinkAccount).toHaveBeenCalledTimes(1);
    // Wording changed from "linked without Gmail access" when the adapter and
    // events.signIn started sharing one reporter (reportTokenSaveFailure).
    expect(console.error).toHaveBeenCalledWith(
      '[auth.linkAccount] could not save the encrypted Gmail token; signed in without Gmail access',
      { userId: 'user-1', message: 'bad TOKEN_ENCRYPTION_KEY' },
    );
    expect(h.captureException).toHaveBeenCalledWith(boom, { tags: { area: 'auth.linkAccount' } });
  });

  it('registers no linkAccount event (it only repeated the adapter save)', () => {
    expect(Object.keys(h.config!.events as object)).toEqual(['signIn']);
  });
});

// This suite used to run against events.linkAccount too. That event is gone:
// it ran straight after the adapter's linkAccount with the same tokens, so it
// was a second save of the same token on every first sign-in.
describe.each(['signIn'] as const)('events.%s', (name) => {
  const run = (user: Record<string, unknown>, account: Record<string, unknown>, profile?: Record<string, unknown>) =>
    events().signIn({ user, account, profile });

  it('persists tokens under user.id when NextAuth supplies it, with no lookups', async () => {
    await run({ id: 'user-1', email: 'a@example.com' }, googleAccount());
    expect(h.persist).toHaveBeenCalledWith('user-1', tokensOf);
    expect(prismaMock.account.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('ignores non-Google providers entirely', async () => {
    await run({ id: 'user-1' }, googleAccount({ provider: 'github' }));
    expect(h.persist).not.toHaveBeenCalled();
  });

  it('without user.id, falls back to the Account row by provider + providerAccountId', async () => {
    prismaMock.account.findFirst.mockResolvedValue({ userId: 'user-from-account' });
    await run({ email: 'a@example.com' }, googleAccount());
    expect(prismaMock.account.findFirst).toHaveBeenCalledWith({
      where: { provider: 'google', providerAccountId: 'g-123' },
      select: { userId: true },
    });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(h.persist).toHaveBeenCalledWith('user-from-account', tokensOf);
  });

  it('then falls back to the User row by the user payload email', async () => {
    prismaMock.account.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-from-email' });
    await run({ email: 'a@example.com' }, googleAccount());
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'a@example.com' },
      select: { id: true },
    });
    expect(h.persist).toHaveBeenCalledWith('user-from-email', tokensOf);
  });

  it('warns and persists nothing when no userId can be resolved', async () => {
    prismaMock.account.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);
    await run({ email: 'nobody@example.com' }, googleAccount());
    expect(h.persist).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(`[auth.${name}] could not resolve userId`, expect.any(Object));
  });

  it('warns and persists nothing when Google returned no access token', async () => {
    await run({ id: 'user-1' }, googleAccount({ access_token: undefined }));
    expect(h.persist).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(`[auth.${name}] no access_token on account`, { userId: 'user-1' });
  });

  it('does not query by email when neither payload carries one', async () => {
    prismaMock.account.findFirst.mockResolvedValue(null);
    await run({}, googleAccount());
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(h.persist).not.toHaveBeenCalled();
  });
});

describe('events.signIn only', () => {
  it('uses the OAuth profile email when the user payload has none', async () => {
    prismaMock.account.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-from-profile' });
    await events().signIn({ user: {}, account: googleAccount(), profile: { email: 'p@example.com' } });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'p@example.com' },
      select: { id: true },
    });
    expect(h.persist).toHaveBeenCalledWith('user-from-profile', tokensOf);
  });

  it('prefers the user payload email over the profile email', async () => {
    prismaMock.account.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u' });
    await events().signIn({ user: { email: 'user@example.com' }, account: googleAccount(), profile: { email: 'p@example.com' } });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'user@example.com' },
      select: { id: true },
    });
  });

  it('a sign-in with no account (e.g. email/credentials) is a no-op', async () => {
    await events().signIn({ user: { id: 'user-1' }, account: null });
    expect(h.persist).not.toHaveBeenCalled();
  });

  it('a persist failure inside the event is reported, not thrown (same as the adapter path)', async () => {
    // Previously pinned as propagating. Auth.js wraps events and would only
    // log the throw to its own logger, so it never reached Sentry; the
    // adapter path already caught and reported. Both now behave the same.
    const boom = new Error('db down');
    h.persist.mockRejectedValueOnce(boom);
    await expect(events().signIn({ user: { id: 'user-1' }, account: googleAccount() })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      '[auth.signIn] could not save the encrypted Gmail token; signed in without Gmail access',
      { userId: 'user-1', message: 'db down' },
    );
    expect(h.captureException).toHaveBeenCalledWith(boom, { tags: { area: 'auth.signIn' } });
  });

  it('the failure report carries no token', async () => {
    h.persist.mockRejectedValueOnce(new Error('db down'));
    await events().signIn({
      user: { id: 'user-1' },
      account: googleAccount({ access_token: 'AT-very-secret', refresh_token: 'RT-very-secret' }),
    });
    const reported = JSON.stringify([
      vi.mocked(console.error).mock.calls,
      vi.mocked(console.info).mock.calls,
      h.captureException.mock.calls.map(([e, ctx]) => [String(e), ctx]),
    ]);
    expect(reported).not.toContain('very-secret');
  });
});

/**
 * Which sign-ins save a token, replaying the order Auth.js 5.0.0-beta.25
 * calls things in (@auth/core lib/actions/callback): adapter.linkAccount only
 * when the Google account is not linked yet, then events.signIn on every
 * OAuth callback. Before this, a first sign-in saved the same token three
 * times (adapter, events.linkAccount, events.signIn).
 */
describe('one token save per sign-in', () => {
  const adapter = () => h.config!.adapter as { linkAccount: (a: AdapterAccount) => Promise<unknown> };

  it('first sign-in (or re-link after disconnect): the adapter saves, signIn does not save again', async () => {
    const account = googleAccount({ access_token: 'AT-first' });
    await adapter().linkAccount({ ...account, userId: 'user-1' } as AdapterAccount);
    await events().signIn({ user: { id: 'user-1' }, account });
    expect(h.persist).toHaveBeenCalledTimes(1);
    expect(h.persist).toHaveBeenCalledWith('user-1', expect.objectContaining({ access_token: 'AT-first' }));
  });

  it('returning user (Account already linked, no adapter call): signIn is the one save', async () => {
    await events().signIn({ user: { id: 'user-1' }, account: googleAccount({ access_token: 'AT-returning' }) });
    expect(h.persist).toHaveBeenCalledTimes(1);
  });

  it("the adapter's mark is consumed: the next sign-in with the same token saves again", async () => {
    const account = googleAccount({ access_token: 'AT-consumed' });
    await adapter().linkAccount({ ...account, userId: 'user-1' } as AdapterAccount);
    await events().signIn({ user: { id: 'user-1' }, account });
    await events().signIn({ user: { id: 'user-1' }, account });
    expect(h.persist).toHaveBeenCalledTimes(2);
  });

  it('a different token after an adapter save is not skipped', async () => {
    await adapter().linkAccount({ ...googleAccount({ access_token: 'AT-old' }), userId: 'user-1' } as AdapterAccount);
    await events().signIn({ user: { id: 'user-1' }, account: googleAccount({ access_token: 'AT-new' }) });
    expect(h.persist).toHaveBeenCalledTimes(2);
    expect(h.persist).toHaveBeenLastCalledWith('user-1', expect.objectContaining({ access_token: 'AT-new' }));
  });

  it('if the adapter save failed, signIn tries once more, and neither failure breaks sign-in', async () => {
    h.persist.mockRejectedValueOnce(new Error('blip')).mockRejectedValueOnce(new Error('blip again'));
    const account = googleAccount({ access_token: 'AT-retry' });
    await adapter().linkAccount({ ...account, userId: 'user-1' } as AdapterAccount);
    await expect(events().signIn({ user: { id: 'user-1' }, account })).resolves.toBeUndefined();
    expect(h.persist).toHaveBeenCalledTimes(2);
    expect(h.captureException).toHaveBeenCalledTimes(2);
    expect(h.baseLinkAccount).toHaveBeenCalledTimes(1);
  });

  it('the mark expires after a minute, so a stale one cannot suppress a later save', async () => {
    vi.useFakeTimers();
    try {
      const account = googleAccount({ access_token: 'AT-stale' });
      await adapter().linkAccount({ ...account, userId: 'user-1' } as AdapterAccount);
      vi.advanceTimersByTime(61_000);
      await events().signIn({ user: { id: 'user-1' }, account });
      expect(h.persist).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
