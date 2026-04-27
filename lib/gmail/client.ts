import { google } from 'googleapis';
import { prisma } from '@/lib/db';
import { decryptValue, encryptValue } from '@/lib/crypto';

// Derived from the constructor so no direct dep on google-auth-library is needed.
export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export function makeOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.AUTH_GOOGLE_ID,
    process.env.AUTH_GOOGLE_SECRET,
  );
}

type ExistingGmailToken = {
  refreshToken: string | null;
  encryptionVersion: string | null;
};

export function buildGmailTokenUpdate(
  tokens: {
    access_token: string;
    refresh_token?: string | null;
    expires_at?: number | null;
    expiry_date?: number | null;
    scope?: string | null;
  },
  existing?: ExistingGmailToken | null,
): {
  accessToken: string;
  refreshToken: string | null | undefined;
  expiresAt: Date | null;
  scope: string | null | undefined;
  encryptionVersion: string | null;
} {
  const expiresAtMs =
    tokens.expiry_date ??
    (tokens.expires_at ? tokens.expires_at * 1000 : null);
  const encAccess = encryptValue(tokens.access_token);

  let refreshToken: string | null | undefined;
  if (tokens.refresh_token != null) {
    refreshToken = encryptValue(tokens.refresh_token).value;
  } else if (existing?.refreshToken != null) {
    refreshToken = encryptValue(
      decryptValue(existing.refreshToken, existing.encryptionVersion),
    ).value;
  }

  return {
    accessToken: encAccess.value ?? '',
    refreshToken,
    expiresAt: expiresAtMs ? new Date(expiresAtMs) : null,
    scope: tokens.scope ?? undefined,
    encryptionVersion: encAccess.version,
  };
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
  const existing = await prisma.gmailToken.findUnique({
    where: { userId },
    select: { refreshToken: true, encryptionVersion: true },
  });
  const update = buildGmailTokenUpdate(
    { ...tokens, access_token: tokens.access_token },
    existing,
  );
  const refreshTokenUpdate =
    update.refreshToken !== undefined ? { refreshToken: update.refreshToken } : {};

  await prisma.gmailToken.upsert({
    where: { userId },
    update: {
      accessToken: update.accessToken,
      // If Google omits the refresh token, re-write the preserved value with
      // this key so the row-level encryptionVersion still describes both fields.
      ...refreshTokenUpdate,
      expiresAt: update.expiresAt,
      scope: update.scope,
      encryptionVersion: update.encryptionVersion,
    },
    create: {
      userId,
      accessToken: update.accessToken,
      refreshToken: update.refreshToken ?? null,
      expiresAt: update.expiresAt,
      scope: update.scope ?? null,
      encryptionVersion: update.encryptionVersion,
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
