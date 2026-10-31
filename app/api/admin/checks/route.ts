import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import { markAllChecked, MARK_KINDS, NOTE_MAX, undoMark } from '@/lib/admin/adminChecks';
import { runAudit } from '@/lib/audit/run';
import { CHECK_LABELS } from '@/lib/audit/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * "Mark checked" (lib/admin/adminChecks.ts), admin only:
 *   - POST marks up to 200 items checked → { marked };
 *   - DELETE undoes one mark → { ok: true }.
 * A tournament check's mark changes that tournament's score, so both re-audit
 * the tournaments they touched before replying: the page the admin sees next
 * already shows the new score, rather than waiting for the cron's sweep.
 * Errors are codes only; the page words them.
 */

const CHECK_CODES = Object.keys(CHECK_LABELS);

// A check's subject is `<tournamentId>:<code>` (run.ts's checkSubject).
// Digits only for the id, as in the audit route: BigInt() alone would accept
// '0x10'. The code must be a known check, so a typo cannot store a mark that
// nothing will ever read.
const CHECK_SUBJECT = /^(\d{1,18}):([a-z_]+)$/;

const parseCheckSubject = (subject: string): bigint | null => {
  const m = CHECK_SUBJECT.exec(subject);
  return m && m[1] && m[2] && CHECK_CODES.includes(m[2]) ? BigInt(m[1]) : null;
};

const Subject = z.string().min(1).max(300);

/** A check's mark must name a known tournament check; other kinds pass. */
const subjectFits = (t: { kind: string; subject: string }) =>
  t.kind !== 'check' || parseCheckSubject(t.subject) != null;

const Target = z.object({ kind: z.enum(MARK_KINDS), subject: Subject }).refine(subjectFits);

const PostBody = z.object({
  items: z
    .array(
      z
        .object({
          kind: z.enum(MARK_KINDS),
          subject: Subject,
          fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
        })
        .refine(subjectFits),
    )
    .min(1)
    .max(200),
  note: z.string().trim().max(NOTE_MAX).optional(),
});

async function admin(): Promise<{ email: string } | { response: NextResponse }> {
  try {
    return { email: await requireAdmin() };
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return {
      response: NextResponse.json(
        { error: status === 403 ? 'forbidden' : 'unauthorized' },
        { status: status === 403 ? 403 : 401 },
      ),
    };
  }
}

const badRequest = () => NextResponse.json({ error: 'bad_request' }, { status: 400 });

/** A failure, reported without the request body (a note may be in it). */
function serverError(where: string, err: unknown) {
  console.error(`[admin-checks] ${where} failed:`, err instanceof Error ? err.message : err);
  Sentry.captureException(err, { tags: { route: 'api/admin/checks', step: where } });
  return NextResponse.json({ error: 'server_error' }, { status: 500 });
}

/** The tournaments whose checks the items touch, each once, in first-seen order. */
function tournamentsOf(items: Array<{ kind: string; subject: string }>): bigint[] {
  const ids = new Map<string, bigint>();
  for (const it of items) {
    if (it.kind !== 'check') continue;
    const id = parseCheckSubject(it.subject);
    if (id != null) ids.set(String(id), id);
  }
  return [...ids.values()];
}

/**
 * Re-audits in chunks of 25 (run.ts's sweep size): a bulk mark can touch up
 * to 200 tournaments, and one runAudit loads and writes its whole batch in a
 * single transaction. If this fails after the marks were stored, the marks
 * stand and the admin sees an error; the next audit of those tournaments
 * (a re-scrape, the cron's sweep or "Audit now") applies them.
 */
const REAUDIT_CHUNK = 25;
async function reaudit(ids: bigint[]): Promise<void> {
  for (let i = 0; i < ids.length; i += REAUDIT_CHUNK) {
    await runAudit(ids.slice(i, i + REAUDIT_CHUNK));
  }
}

export async function POST(req: Request) {
  const who = await admin();
  if ('response' in who) return who.response;
  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest();
  const { items, note } = parsed.data;
  try {
    const marked = await markAllChecked(
      items.map((it) => ({ ...it, note: note || null, by: who.email })),
    );
    await reaudit(tournamentsOf(items));
    return NextResponse.json({ marked });
  } catch (err) {
    return serverError('mark', err);
  }
}

export async function DELETE(req: Request) {
  const who = await admin();
  if ('response' in who) return who.response;
  const parsed = Target.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest();
  const { kind, subject } = parsed.data;
  try {
    await undoMark(kind, subject);
    await reaudit(tournamentsOf([parsed.data]));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError('undo', err);
  }
}
