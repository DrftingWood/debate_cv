import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/db';
import { persistTokensFromAccount } from '@/lib/gmail/client';
import { wasSavedByAdapter, withoutStoredTokens } from '@/lib/authAdapter';
import * as Sentry from '@sentry/nextjs';

/**
 * Look up the DB User.id with multiple fallbacks. NextAuth v5 beta
 * occasionally hands events.signIn a `user` payload
 * without a populated `id` (e.g. when re-signing-in via a server action
 * while a session is already active — the disconnect → Reconnect Gmail
 * flow). Without this fallback, persistTokensFromAccount never gets
 * called and the GmailToken row stays missing even though Google
 * returned a fresh refresh token.
 *
 * Order of attempts:
 *   1. user.id directly (the normal case)
 *   2. Account by (provider, providerAccountId) — works once NextAuth
 *      has written the Account row
 *   3. User by email from the user or profile payload
 */
async function resolveUserId(args: {
  user: { id?: string | null; email?: string | null } | undefined;
  account: { provider?: string | null; providerAccountId?: string | null } | undefined | null;
  profile?: { email?: string | null } | undefined | null;
}): Promise<string | null> {
  if (args.user?.id) return args.user.id;
  if (args.account?.provider && args.account.providerAccountId) {
    const acct = await prisma.account.findFirst({
      where: {
        provider: args.account.provider,
        providerAccountId: args.account.providerAccountId,
      },
      select: { userId: true },
    });
    if (acct?.userId) return acct.userId;
  }
  const email = args.user?.email ?? args.profile?.email ?? null;
  if (email) {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (u?.id) return u.id;
  }
  return null;
}

/**
 * A failed Gmail token save never breaks sign-in: the user is signed in with
 * Gmail not connected, and "reconnect Gmail" restores it once the cause is
 * fixed. Make the cause loud instead. Only the error and the userId are sent;
 * the token is never put in the log line or the Sentry event.
 */
function reportTokenSaveFailure(
  area: 'auth.linkAccount' | 'auth.signIn',
  err: unknown,
  userId: string,
): void {
  console.error(
    `[${area}] could not save the encrypted Gmail token; signed in without Gmail access`,
    {
      userId,
      message: err instanceof Error ? err.message : String(err),
    },
  );
  Sentry.captureException(err, { tags: { area } });
}

const next = NextAuth({
  // Tokens go to the encrypted GmailToken, never into Account (see authAdapter).
  adapter: withoutStoredTokens(PrismaAdapter(prisma), persistTokensFromAccount, (err, userId) =>
    reportTokenSaveFailure('auth.linkAccount', err, userId),
  ),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          access_type: 'offline',
          prompt: 'consent',
          scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
        },
      },
    }),
  ],
  session: { strategy: 'database' },
  events: {
    // No events.linkAccount: it fired straight after the adapter's linkAccount
    // above, with the same tokens for the same user, so all it ever did was
    // save the token a second time. signIn stays because it is the only save
    // for a returning user (lib/authAdapter.ts lists which callbacks run when).
    async signIn({ user, account, profile }) {
      if (!account || account.provider !== 'google') return;
      // First sign-in or re-link: the adapter has already saved this token.
      if (wasSavedByAdapter(account)) return;
      const userId = await resolveUserId({ user, account, profile });
      if (!userId) {
        console.warn('[auth.signIn] could not resolve userId', {
          providerAccountId: account.providerAccountId,
          userEmail: user?.email,
          profileEmail: profile?.email,
          hasAccessToken: Boolean(account.access_token),
        });
        return;
      }
      if (!account.access_token) {
        console.warn('[auth.signIn] no access_token on account', { userId });
        return;
      }
      console.info('[auth.signIn] persisting Gmail tokens', { userId });
      try {
        await persistTokensFromAccount(userId, {
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          expires_at: account.expires_at,
          scope: account.scope,
        });
      } catch (err) {
        // Same policy as the adapter path. The session already exists by the
        // time this event runs; Auth.js would swallow a throw here too, but
        // only into its own logger, never Sentry.
        reportTokenSaveFailure('auth.signIn', err, userId);
      }
    },
  },
  pages: {
    signIn: '/',
  },
});

export const { auth, signIn, signOut } = next;
export const GET = next.handlers.GET;
export const POST = next.handlers.POST;
