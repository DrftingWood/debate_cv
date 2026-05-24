import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/db';
import { persistTokensFromAccount } from '@/lib/gmail/client';

/**
 * Look up the DB User.id with multiple fallbacks. NextAuth v5 beta
 * occasionally hands events.signIn / events.linkAccount a `user` payload
 * without a populated `id` (e.g. when re-signing-in via a server action
 * while a session is already active — the disconnect → Reconnect Gmail
 * flow). Without this fallback, persistTokensFromAccount never gets
 * called and the GmailToken row stays missing even though Google
 * returned a fresh refresh token.
 *
 * Order of attempts:
 *   1. user.id directly (the normal case)
 *   2. Account by (provider, providerAccountId) — works once NextAuth
 *      has written the new Account row in linkAccount
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

const next = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          access_type: 'offline',
          prompt: 'consent',
          scope:
            'openid email profile https://www.googleapis.com/auth/gmail.readonly',
        },
      },
    }),
  ],
  session: { strategy: 'database' },
  events: {
    async linkAccount({ user, account }) {
      if (account.provider !== 'google') return;
      const userId = await resolveUserId({ user, account });
      if (!userId) {
        console.warn('[auth.linkAccount] could not resolve userId', {
          providerAccountId: account.providerAccountId,
          userEmail: user?.email,
          hasAccessToken: Boolean(account.access_token),
        });
        return;
      }
      if (!account.access_token) {
        console.warn('[auth.linkAccount] no access_token on account', { userId });
        return;
      }
      console.info('[auth.linkAccount] persisting Gmail tokens', { userId });
      await persistTokensFromAccount(userId, {
        access_token: account.access_token,
        refresh_token: account.refresh_token,
        expires_at: account.expires_at,
        scope: account.scope,
      });
    },
    async signIn({ user, account, profile }) {
      if (!account || account.provider !== 'google') return;
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
      await persistTokensFromAccount(userId, {
        access_token: account.access_token,
        refresh_token: account.refresh_token,
        expires_at: account.expires_at,
        scope: account.scope,
      });
    },
  },
  pages: {
    signIn: '/',
  },
});

export const { auth, signIn, signOut } = next;
export const GET = next.handlers.GET;
export const POST = next.handlers.POST;
