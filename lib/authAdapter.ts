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
 */

import type { Adapter, AdapterAccount } from 'next-auth/adapters';

type Tokens = {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: number | null;
  scope?: string | null;
};

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
