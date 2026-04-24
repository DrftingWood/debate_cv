import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { prisma } from '@/lib/db';

export function makeOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.AUTH_GOOGLE_ID,
    process.env.AUTH_GOOGLE_SECRET,
  );
}

export async function getOAuthClientForUser(userId: string): Promise<OAuth2Client | null> {
  const token = await prisma.gmailToken.findUnique({ where: { userId } });
  if (!token) return null;
  const client = makeOAuthClient();
  client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken ?? undefined,
    expiry_date: token.expiresAt ? token.expiresAt.getTime() : undefined,
    scope: token.scope ?? undefined,
  });
  return client;
}

export async function persistTokensFromAccount(
  userId: string,
  tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expires_at?: number | null; // seconds since epoch (NextAuth Account) OR
    expiry_date?: number | null; // ms since epoch (googleapis)
    scope?: string | null;
  },
): Promise<void> {
  if (!tokens.access_token) return;
  const expiresAtMs =
    tokens.expiry_date ??
    (tokens.expires_at ? tokens.expires_at * 1000 : null);
  await prisma.gmailToken.upsert({
    where: { userId },
    update: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? undefined,
      expiresAt: expiresAtMs ? new Date(expiresAtMs) : null,
      scope: tokens.scope ?? undefined,
    },
    create: {
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: expiresAtMs ? new Date(expiresAtMs) : null,
      scope: tokens.scope ?? null,
    },
  });
}
