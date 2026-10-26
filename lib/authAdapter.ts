/**
 * Keep Google OAuth tokens out of the Account table.
 *
 * The stock Prisma adapter writes access_token, refresh_token and id_token to
 * Account as plain text. For this app those are Gmail-read credentials, and
 * lib/crypto.ts already holds an encrypted copy in GmailToken, so the plain
 * copy only widens who can read a user's mailbox (a database leak, a backup, a
 * branch). This wraps the adapter's linkAccount so that:
 *
 *   1. the tokens go to GmailToken first, encrypted, keyed by the adapter's
 *      own userId; and only then
 *   2. the Account row is written without them.
 *
 * Writing GmailToken here, not only in the sign-in events, matters: lib/gmail
 * /client.ts records that the events have been seen to no-op under NextAuth
 * v5 beta, which is why Account used to be treated as the source of truth. The
 * adapter call is the one write NextAuth cannot skip, so the encrypted copy is
 * made on that path.
 *
 * If saving the encrypted copy fails (a bad or missing TOKEN_ENCRYPTION_KEY, a
 * database blip), sign-in must still work: the account is linked WITHOUT
 * tokens and the failure is reported. The user is signed in with Gmail not
 * connected, and the existing "reconnect Gmail" path restores it once the cause
 * is fixed. Letting the error propagate instead turns a misconfigured secret
 * into a sign-in outage (the 2026-10-26 "Server error" on /api/auth/callback).
 * The plain tokens are never written to Account either way.
 *
 * One save per sign-in. Auth.js 5.0.0-beta.25 (@auth/core
 * lib/actions/callback/handle-login.js) calls adapter.linkAccount only when
 * the Google account is not yet linked: a first sign-in, or a signed-in user
 * re-linking after /api/account/disconnect deleted the Account row. A
 * returning user whose Account already exists skips linkAccount entirely, so
 * events.signIn (which fires on every OAuth callback) is the only save for
 * them. events.signIn therefore stays, but asks wasSavedByAdapter() first so
 * the token the adapter has just saved is not encrypted and written again.
 */

import { createHash } from 'node:crypto';
import type { Adapter, AdapterAccount } from 'next-auth/adapters';

type Tokens = {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: number | null;
  scope?: string | null;
};

/**
 * Saves made by linkAccount in this process, waiting for the events.signIn of
 * the same callback (which runs moments later, in the same request) to see
 * them. Keyed by provider, provider account id and a SHA-256 of the access
 * token, so the token itself is never held here and a later sign-in with a
 * fresh token is never mistaken for this one. Entries are consumed on read
 * and expire after a minute, so a callback that dies between the two steps
 * leaves nothing behind for long. A miss (a different serverless instance, an
 * expired entry) only costs one redundant, idempotent upsert.
 */
const SAVED_TTL_MS = 60_000;
const recentlySaved = new Map<string, number>();

function savedKey(provider: string, providerAccountId: string, accessToken: string): string {
  const digest = createHash('sha256').update(accessToken).digest('hex');
  return `${provider}:${providerAccountId}:${digest}`;
}

function markSaved(account: AdapterAccount & { access_token: string }): void {
  const now = Date.now();
  for (const [key, expires] of recentlySaved) if (expires <= now) recentlySaved.delete(key);
  recentlySaved.set(savedKey(account.provider, account.providerAccountId, account.access_token), now + SAVED_TTL_MS);
}

/**
 * True when linkAccount has just saved exactly this token for this provider
 * account; the entry is consumed. A save that FAILED is not recorded, so
 * events.signIn gets one more attempt at it (a database blip may have passed).
 */
export function wasSavedByAdapter(account: {
  provider?: string | null;
  providerAccountId?: string | null;
  access_token?: string | null;
}): boolean {
  if (!account.provider || !account.providerAccountId || !account.access_token) return false;
  const key = savedKey(account.provider, account.providerAccountId, account.access_token);
  const expires = recentlySaved.get(key);
  recentlySaved.delete(key);
  return expires !== undefined && expires > Date.now();
}

export function withoutStoredTokens(
  base: Adapter,
  persistTokens: (userId: string, tokens: Tokens) => Promise<void>,
  onPersistError: (err: unknown, userId: string) => void = () => {},
): Adapter {
  return {
    ...base,
    async linkAccount(account: AdapterAccount) {
      if (account.provider === 'google' && account.access_token) {
        try {
          await persistTokens(account.userId, {
            access_token: account.access_token,
            refresh_token: account.refresh_token,
            expires_at: account.expires_at,
            scope: account.scope,
          });
          markSaved({ ...account, access_token: account.access_token });
        } catch (err) {
          onPersistError(err, account.userId);
        }
      }
      // A copy, never the object NextAuth hands the events afterwards.
      const stripped: AdapterAccount = {
        ...account,
        access_token: undefined,
        refresh_token: undefined,
        id_token: undefined,
      };
      // The stock adapter returns the account or nothing; narrow `void` away for the Adapter type.
      return (await base.linkAccount?.(stripped)) as AdapterAccount | null | undefined;
    },
  };
}
