import { google } from 'googleapis';
import { prisma } from '@/lib/db';
import { decryptValue, encryptValue } from '@/lib/crypto';

// Derived from the constructor so no direct dep on google-auth-library is needed.
export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

function makeOAuthClient(): OAuth2Client {
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
  let token = await prisma.gmailToken.findUnique({ where: { userId } });
  if (!token) {
    const recovered = await syncGmailTokenFromAccount(userId);
    if (recovered) {
      token = await prisma.gmailToken.findUnique({ where: { userId } });
    }
  }
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

/**
 * Recover a missing GmailToken row from the user's Google Account row.
 *
 * NextAuth's PrismaAdapter writes OAuth tokens directly into Account
 * (access_token, refresh_token, expires_at, scope as plaintext columns
 * — that's the adapter's contract, not ours). Our GmailToken table is a
 * derived, encrypted-at-rest cache that's normally populated by
 * events.signIn / events.linkAccount in lib/auth.ts.
 *
 * In NextAuth v5 beta the events flow has been observed to no-op the
 * write while still logging success (the Reconnect Gmail flow:
 * disconnect → consent → land back with badge still saying "not
 * connected" even though [auth.signIn] persisting Gmail tokens
 * appeared in runtime logs). Treating Account as the source of truth
 * and rebuilding GmailToken from it sidesteps that dependency
 * entirely — it works whether or not events fired correctly.
 *
 * Returns true when a row was written (caller should re-read), false
 * when there's no Account to recover from. Safe to call when a
 * GmailToken already exists, but callers should check first to avoid
 * the redundant Account read.
 */
export async function syncGmailTokenFromAccount(userId: string): Promise<boolean> {
  try {
    const account = await prisma.account.findFirst({
      where: { userId, provider: 'google' },
      select: { access_token: true, refresh_token: true, expires_at: true, scope: true },
    });
    if (!account?.access_token) return false;
    await persistTokensFromAccount(userId, {
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      expires_at: account.expires_at,
      scope: account.scope,
    });
    console.info('[gmail.sync] recovered GmailToken from Account', { userId });
    return true;
  } catch (err) {
    // Self-healing must never crash the caller. The settings page renders
    // through this path; the ingest API route's getOAuthClientForUser
    // calls it on every cache-miss. Surface the message so the next prod
    // log pull names the failing column / constraint — the prior deploy
    // (cb55b44) propagated the throw and broke the settings page render.
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[gmail.sync] failed to recover GmailToken from Account', { userId, message });
    return false;
  }
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
