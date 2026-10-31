import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import {
  addToReviewSet,
  COMMENT_MAX,
  FLAG_STATUSES,
  loadReviewSet,
  PRIORITIES,
  reviewSetCsv,
  SOURCES,
  toExportRecord,
  updateFlag,
} from '@/lib/admin/reviewSet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The review set (lib/admin/reviewSet.ts), admin only:
 *   - POST adds items with a priority and a comment, refreshing any that
 *     are already open → { flagged };
 *   - PATCH edits one flag's priority, comment or status → { ok: true };
 *   - GET exports the set as JSON or CSV, high to low and newest first, as
 *     a dated download: the file a later session is handed to work from.
 * Errors are codes only; the page words them (lib/admin/actionMessage.ts).
 */

const Comment = z.string().trim().min(1).max(COMMENT_MAX);

/**
 * A parser warning is flagged by `<parser>|<headline>`, kept as written and
 * exported. Real headlines are scrubbed before they are grouped
 * (parserWarnings.ts), so a key carrying a `privateurls` segment was not one
 * the page offered: it is refused rather than stored with a key in it.
 */
const Item = z
  .object({ source: z.enum(SOURCES), sourceId: z.string().min(1).max(300) })
  .refine((i) => i.source !== 'parser_warning' || !/privateurls/i.test(i.sourceId), {
    message: 'private',
  });

const PostBody = z.object({
  items: z.array(Item).min(1).max(200),
  priority: z.enum(PRIORITIES),
  comment: Comment,
});

const PatchBody = z
  .object({
    id: z.string().regex(/^\d{1,19}$/),
    priority: z.enum(PRIORITIES).optional(),
    comment: Comment.optional(),
    status: z.enum(FLAG_STATUSES).optional(),
  })
  .refine((b) => b.priority || b.comment !== undefined || b.status, { message: 'nothing' });

const Query = z.object({
  format: z.enum(['json', 'csv']).default('json'),
  status: z.enum(['open', 'all']).default('open'),
});

type Admin = { email: string } | { response: NextResponse };

async function admin(): Promise<Admin> {
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

/** A database failure, logged without the request (a comment may be in it). */
function serverError(where: string, err: unknown) {
  console.error(`[review-set] ${where} failed:`, err instanceof Error ? err.message : err);
  return NextResponse.json({ error: 'server_error' }, { status: 500 });
}

export async function POST(req: Request) {
  const who = await admin();
  if ('response' in who) return who.response;
  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest();
  try {
    return NextResponse.json(await addToReviewSet({ ...parsed.data, createdBy: who.email }));
  } catch (err) {
    return serverError('add', err);
  }
}

export async function PATCH(req: Request) {
  const who = await admin();
  if ('response' in who) return who.response;
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest();
  try {
    const result = await updateFlag({ ...parsed.data, id: BigInt(parsed.data.id) });
    if (result === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (result === 'already_open') {
      return NextResponse.json({ error: 'already_open' }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError('update', err);
  }
}

export async function GET(req: Request) {
  const who = await admin();
  if ('response' in who) return who.response;
  const params = new URL(req.url).searchParams;
  const parsed = Query.safeParse({
    format: params.get('format') ?? undefined,
    status: params.get('status') ?? undefined,
  });
  if (!parsed.success) return badRequest();
  const { format, status } = parsed.data;

  let flags;
  try {
    flags = await loadReviewSet({ status, order: 'newest' });
  } catch (err) {
    return serverError('export', err);
  }
  const date = new Date().toISOString().slice(0, 10);
  const headers = {
    'Content-Disposition': `attachment; filename="review-set-${date}.${format}"`,
    'Cache-Control': 'no-store',
  };
  if (format === 'csv') {
    return new NextResponse(reviewSetCsv(flags), {
      headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' },
    });
  }
  return NextResponse.json(
    { exportedAt: new Date().toISOString(), status, flags: flags.map(toExportRecord) },
    { headers },
  );
}
