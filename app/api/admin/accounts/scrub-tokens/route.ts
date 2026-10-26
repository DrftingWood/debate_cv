import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { decryptValue, encryptValue, getEncryptionKey } from '@/lib/crypto';
import { persistTokensFromAccount } from '@/lib/gmail/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One-off: leave no Google token readable in the database.
 *
 * Two jobs, in this order, and only when TOKEN_ENCRYPTION_KEY is set:
 *
 *   1. Encrypt every GmailToken row still stored as plain text
 *      (encryptionVersion null). Encryption is skipped, without error, when the
 *      key is unset (encryptValue returns the text unchanged), so a row can be
 *      "saved" and still be readable. In production the 2026-10-26 check found
 *      every GmailToken row in that state.
 *   2. For each Account with plain tokens, make sure GmailToken holds them
 *      (encrypted), and only then clear the plain ones.
 *
 * A row whose encrypted copy cannot be written is left untouched and counted,
 * so running it twice is safe and nothing is lost on a failure. With no key it
 * refuses (409) rather than copy plain text from one table into another.
 * Admin only; returns counts, never a token.
 */
export async function POST() {
  try {
    await requireAdmin();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  if (!getEncryptionKey()) {
    return NextResponse.json(
      { error: 'TOKEN_ENCRYPTION_KEY_not_set', hint: 'Set TOKEN_ENCRYPTION_KEY in Vercel and redeploy before running this.' },
      { status: 409 },
    );
  }

  // 1. Encrypt GmailToken rows that are still plain text.
  const legacy = await prisma.gmailToken.findMany({
    where: { encryptionVersion: null },
    select: { userId: true, accessToken: true, refreshToken: true },
  });
  let encrypted = 0;
  let encryptFailed = 0;
  for (const row of legacy) {
    try {
      const access = encryptValue(decryptValue(row.accessToken, null));
      const refresh = encryptValue(decryptValue(row.refreshToken, null));
      await prisma.gmailToken.update({
        where: { userId: row.userId },
        data: { accessToken: access.value ?? '', refreshToken: refresh.value, encryptionVersion: access.version },
      });
      encrypted += 1;
    } catch {
      encryptFailed += 1;
    }
  }

  // 2. Clear the plain tokens in Account once an encrypted GmailToken exists.
  const rows = await prisma.account.findMany({
    where: { OR: [{ access_token: { not: null } }, { refresh_token: { not: null } }, { id_token: { not: null } }] },
    select: { id: true, userId: true, provider: true, access_token: true, refresh_token: true, expires_at: true, scope: true },
  });

  let scrubbed = 0;
  let kept = 0;
  for (const row of rows) {
    try {
      if (row.provider === 'google' && row.access_token) {
        const existing = await prisma.gmailToken.findUnique({ where: { userId: row.userId }, select: { userId: true } });
        // An existing encrypted copy is the same grant (or a newer one): keep it.
        if (!existing) {
          await persistTokensFromAccount(row.userId, {
            access_token: row.access_token,
            refresh_token: row.refresh_token,
            expires_at: row.expires_at,
            scope: row.scope,
          });
        }
      }
      await prisma.account.update({
        where: { id: row.id },
        data: { access_token: null, refresh_token: null, id_token: null },
      });
      scrubbed += 1;
    } catch {
      kept += 1;
    }
  }

  return NextResponse.json({
    gmailTokensEncrypted: encrypted,
    gmailTokensFailed: encryptFailed,
    accountsChecked: rows.length,
    scrubbed,
    leftUntouched: kept,
  });
}
