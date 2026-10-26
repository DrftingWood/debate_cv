import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { persistTokensFromAccount } from '@/lib/gmail/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One-off: move every plain-text Google token out of Account.
 *
 * Before the adapter was wrapped (lib/authAdapter.ts), sign-in wrote access,
 * refresh and id tokens to Account unencrypted. For each such row this makes
 * sure the encrypted GmailToken holds the tokens, and only then clears the
 * plain ones. A row whose encrypted copy cannot be written is left untouched
 * and counted, so running it twice is safe and nothing is lost on a failure.
 * Admin only; returns counts, never a token.
 */
export async function POST() {
  try {
    await requireAdmin();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

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

  return NextResponse.json({ accountsChecked: rows.length, scrubbed, leftUntouched: kept });
}
