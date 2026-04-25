import { google } from 'googleapis';
import { prisma } from '@/lib/db';

// Derived from the constructor so no direct dep on google-auth-library is needed.
export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
import { decryptValue, encryptValue } from '@/lib/crypto';

export function makeOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.AUTH_GOOGLE_ID,
    process.env.AUTH_GOOGLE_SECRET,
  );
}

export async function getOAuthClientForUser(userId: string): Promise<OAuth2Client | null> {
  const token = await prisma.gmailToken.findUnique({ where: { userId } });
  if (!token) return null;

  const accessToken = decryptValue(token.accessToken, token.encryptionVersion);
  const refreshToken = decryptValue(token.refreshToken, token.encryptionVersion);

  const client = makeOAuthClient();
  client.setCredentials({
    access_token: accessToken ?? undefined,
    refresh_token: refreshToken ?? undefined,
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
    expires_at?: number | null;   // seconds since epoch (NextAuth Account)
    expiry_date?: number | null;  // ms since epoch (googleapis)
    scope?: string | null;
  },
): Promise<void> {
  if (!tokens.access_token) return;
  const expiresAtMs =
    tokens.expiry_date ??
    (tokens.expires_at ? tokens.expires_at * 1000 : null);

  const encAccess = encryptValue(tokens.access_token);
  const encRefresh = encryptValue(tokens.refresh_token ?? null);
  // Writer must agree on a single version; access_token decides it.
  const version = encAccess.version;

  await prisma.gmailToken.upsert({
    where: { userId },
    update: {
      accessToken: encAccess.value ?? '',
      // Preserve existing refresh_token if Google didn't send one (common on
      // subsequent sign-ins) — don't overwrite with null.
      ...(tokens.refresh_token !== undefined
        ? { refreshToken: encRefresh.value }
        : {}),
      expiresAt: expiresAtMs ? new Date(expiresAtMs) : null,
      scope: tokens.scope ?? undefined,
      encryptionVersion: version,
    },
    create: {
      userId,
      accessToken: encAccess.value ?? '',
      refreshToken: encRefresh.value,
      expiresAt: expiresAtMs ? new Date(expiresAtMs) : null,
      scope: tokens.scope ?? null,
      encryptionVersion: version,
    },
  });
}

/**
 * Revoke the user's Google OAuth grant (hits Google's revoke endpoint) and
 * delete the stored GmailToken. Safe to call multiple times.
 */
export async function revokeAndForgetGmailToken(userId: string): Promise<void> {
  const client = await getOAuthClientForUser(userId);
  if (client) {
    const creds = client.credentials;
    const tokenToRevoke = creds.access_token ?? creds.refresh_token;
    if (tokenToRevoke) {
      try {
        await client.revokeToken(tokenToRevoke);
      } catch {
        // Token may already be expired / revoked; ignore.
      }
    }
  }
  await prisma.gmailToken.deleteMany({ where: { userId } });
}
