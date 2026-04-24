import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/db';
import { persistTokensFromAccount } from '@/lib/gmail/client';

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
      if (!user.id) return;
      await persistTokensFromAccount(user.id, {
        access_token: account.access_token,
        refresh_token: account.refresh_token,
        expires_at: account.expires_at,
        scope: account.scope,
      });
    },
    async signIn({ user, account }) {
      if (!account || account.provider !== 'google') return;
      if (!user.id) return;
      await persistTokensFromAccount(user.id, {
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

