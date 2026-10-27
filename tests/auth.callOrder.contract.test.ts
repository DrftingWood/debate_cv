import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterAccount, AdapterSession, AdapterUser } from 'next-auth/adapters';
// Auth.js internals, imported by path because @auth/core's package exports
// do not expose them. They are the code that runs on /api/auth/callback/google:
// getUserAndAccount builds the account from Google's token response,
// handleLoginOrRegister decides whether adapter.linkAccount runs, and
// parseProviders gives the Google provider its default account() mapping.
import { handleLoginOrRegister } from '../node_modules/@auth/core/lib/actions/callback/handle-login.js';
import * as oauthCallback from '../node_modules/@auth/core/lib/actions/callback/oauth/callback.js';
import parseProviders from '../node_modules/@auth/core/lib/utils/providers.js';

// Exported by the .js but left out of its .d.ts, so typed here by hand.
// The signature is Auth.js's own (four positional arguments), hence the tuple.
const getUserAndAccount = (oauthCallback as Record<string, unknown>).getUserAndAccount as (
  ...args: [profile: unknown, provider: unknown, tokens: unknown, logger: unknown]
) => Promise<{
  user?: AdapterUser;
  account?: AdapterAccount;
}>;

/**
 * Contract test: the one-save-per-sign-in design in lib/auth.ts and
 * lib/authAdapter.ts against the Auth.js code that is actually installed.
 *
 * auth.config.test.ts replays the callback order by hand, from a reading of
 * @auth/core. That reading was done against 0.37.2 (next-auth 5.0.0-beta.25).
 * This suite runs the installed library's own login handler with the app's
 * real adapter wrapper, real events and real Google provider, so an upgrade
 * that changes when linkAccount runs, or what the events receive, fails here
 * instead of in production. Only the database (an in-memory adapter), the
 * token encryption (persistTokensFromAccount) and Sentry are fakes.
 *
 * The steps mirror @auth/core lib/actions/callback/index.js for OAuth:
 * getUserAndAccount, then handleLoginOrRegister, then events.signIn with the
 * account from the token response.
 */

const h = vi.hoisted(() => ({
  config: undefined as undefined | Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  base: undefined as undefined | Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
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
// next-auth/providers/google is NOT mocked: the real provider is under test.
vi.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: () => h.base }));
vi.mock('@/lib/gmail/client', () => ({ persistTokensFromAccount: h.persist }));
vi.mock('@sentry/nextjs', () => ({ captureException: h.captureException }));
vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));

/** Just enough of the Prisma adapter, in memory, for the OAuth branch. */
function memoryAdapter() {
  const users = new Map<string, AdapterUser>();
  const accounts: AdapterAccount[] = [];
  const sessions = new Map<string, AdapterSession>();
  const findAccount = (q: { provider: string; providerAccountId: string }) =>
    accounts.find((a) => a.provider === q.provider && a.providerAccountId === q.providerAccountId);
  return {
    users,
    accounts,
    sessions,
    getUser: async (id: string) => users.get(id) ?? null,
    getUserByEmail: async (email: string) =>
      [...users.values()].find((u) => u.email === email) ?? null,
    getUserByAccount: async (q: { provider: string; providerAccountId: string }) => {
      const a = findAccount(q);
      return a ? (users.get(a.userId) ?? null) : null;
    },
    createUser: async ({ id: _ignored, ...data }: AdapterUser) => {
      const user = { ...data, id: `user-${users.size + 1}` } as AdapterUser;
      users.set(user.id, user);
      return user;
    },
    updateUser: async (u: AdapterUser) => u,
    linkAccount: vi.fn(async (a: AdapterAccount) => {
      accounts.push(a);
    }),
    createSession: async (s: AdapterSession) => {
      sessions.set(s.sessionToken, s);
      return s;
    },
    getSessionAndUser: async (token: string) => {
      const session = sessions.get(token);
      return session ? { session, user: users.get(session.userId)! } : null;
    },
    deleteSession: async (token: string) => {
      sessions.delete(token);
    },
  };
}

let base: ReturnType<typeof memoryAdapter>;
h.base = base = memoryAdapter();
await import('@/lib/auth');

const GMAIL_SCOPE = 'openid email profile https://www.googleapis.com/auth/gmail.readonly';

/** A Google token response, as oauth4webapi hands it over (expires_at added by Auth.js). */
const tokenResponse = (over: Record<string, unknown> = {}) => ({
  access_token: 'AT-1',
  refresh_token: 'RT-1',
  id_token: 'IDT-1',
  expires_in: 3599,
  expires_at: 1_800_000_000,
  scope: GMAIL_SCOPE,
  token_type: 'bearer',
  ...over,
});

const googleClaims = {
  sub: 'g-123',
  email: 'debater@example.com',
  name: 'A Debater',
  picture: 'https://x/y.png',
};

/** One OAuth callback for the Google provider, in @auth/core's order. */
async function googleCallback(
  opts: { sessionToken?: string; tokens?: Record<string, unknown> } = {},
) {
  const config = h.config!;
  const { provider } = parseProviders({
    providerId: 'google',
    config: { providers: config.providers, basePath: '/api/auth' },
    url: new URL('http://localhost/api/auth'),
  } as never);
  const logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const { user: userFromProvider, account } = await getUserAndAccount(
    googleClaims,
    provider,
    tokenResponse(opts.tokens),
    logger,
  );
  const options = {
    adapter: config.adapter,
    events: config.events,
    provider,
    jwt: {},
    cookies: { sessionToken: { name: 'authjs.session-token' } },
    session: {
      strategy: 'database',
      maxAge: 30 * 24 * 60 * 60,
      generateSessionToken: () => crypto.randomUUID(),
    },
  };
  const result = await handleLoginOrRegister(
    // Typed as string, but the callback passes undefined when no session cookie is set.
    opts.sessionToken as string,
    userFromProvider!,
    account!,
    options as never,
  );
  await config.events.signIn?.({
    user: result.user,
    account,
    profile: googleClaims,
    isNewUser: result.isNewUser,
  });
  return result;
}

const savedTokens = (over: Record<string, unknown> = {}) => ({
  access_token: 'AT-1',
  refresh_token: 'RT-1',
  expires_at: 1_800_000_000,
  scope: GMAIL_SCOPE,
  ...over,
});

beforeEach(() => {
  base.users.clear();
  base.accounts.length = 0;
  base.sessions.clear();
  base.linkAccount.mockClear();
  h.persist.mockReset().mockResolvedValue(undefined);
  h.captureException.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('installed Auth.js callback order: new and returning users', () => {
  it('first sign-in: user created, Account linked without tokens, the token saved exactly once', async () => {
    const result = await googleCallback();
    expect(result.isNewUser).toBe(true);
    expect(base.linkAccount).toHaveBeenCalledTimes(1);
    expect(h.persist).toHaveBeenCalledTimes(1);
    expect(h.persist).toHaveBeenCalledWith('user-1', savedTokens());
    const [stored] = base.accounts;
    expect(stored).toMatchObject({
      provider: 'google',
      providerAccountId: 'g-123',
      userId: 'user-1',
      scope: GMAIL_SCOPE,
    });
    expect(stored.access_token).toBeUndefined();
    expect(stored.refresh_token).toBeUndefined();
    expect(stored.id_token).toBeUndefined();
  });

  it('returning user, signed out: no linkAccount, events.signIn is the one save', async () => {
    await googleCallback();
    h.persist.mockClear();
    base.linkAccount.mockClear();
    await googleCallback({ tokens: { access_token: 'AT-2', refresh_token: undefined } });
    expect(base.linkAccount).not.toHaveBeenCalled();
    expect(h.persist).toHaveBeenCalledTimes(1);
    // Google usually omits the refresh token here; persistTokensFromAccount keeps the stored one.
    expect(h.persist).toHaveBeenCalledWith(
      'user-1',
      savedTokens({ access_token: 'AT-2', refresh_token: undefined }),
    );
  });
});

describe('installed Auth.js callback order: signed-in reconnects and failures', () => {
  it('reconnect while still linked and signed in: no linkAccount, events.signIn is the one save', async () => {
    await googleCallback();
    const [sessionToken] = base.sessions.keys();
    h.persist.mockClear();
    base.linkAccount.mockClear();
    await googleCallback({ sessionToken, tokens: { access_token: 'AT-3', refresh_token: 'RT-3' } });
    expect(base.linkAccount).not.toHaveBeenCalled();
    expect(h.persist).toHaveBeenCalledTimes(1);
    expect(h.persist).toHaveBeenCalledWith(
      'user-1',
      savedTokens({ access_token: 'AT-3', refresh_token: 'RT-3' }),
    );
  });

  it('re-link after disconnect (Account deleted, still signed in): the adapter saves once, signIn skips', async () => {
    await googleCallback();
    const [sessionToken] = base.sessions.keys();
    base.accounts.length = 0; // what /api/account/disconnect does to the Account row
    h.persist.mockClear();
    base.linkAccount.mockClear();
    await googleCallback({ sessionToken, tokens: { access_token: 'AT-4', refresh_token: 'RT-4' } });
    expect(base.linkAccount).toHaveBeenCalledTimes(1);
    expect(base.accounts[0].userId).toBe('user-1');
    expect(h.persist).toHaveBeenCalledTimes(1);
    expect(h.persist).toHaveBeenCalledWith(
      'user-1',
      savedTokens({ access_token: 'AT-4', refresh_token: 'RT-4' }),
    );
  });

  it('a failing token save never breaks sign-in and never reaches a log line', async () => {
    h.persist.mockRejectedValue(new Error('bad TOKEN_ENCRYPTION_KEY'));
    const result = await googleCallback({
      tokens: { access_token: 'AT-secret-x', refresh_token: 'RT-secret-x' },
    });
    expect(result.user.id).toBe('user-1');
    expect(base.sessions.size).toBe(1);
    expect(base.accounts).toHaveLength(1);
    // Adapter attempt, then events.signIn's retry (a failed save is not marked as saved).
    expect(h.persist).toHaveBeenCalledTimes(2);
    expect(h.captureException).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify([
      vi.mocked(console.error).mock.calls,
      vi.mocked(console.warn).mock.calls,
      vi.mocked(console.info).mock.calls,
    ]);
    expect(logged).not.toContain('secret-x');
  });
});
