import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  generateRandomSlug,
  validateCustomSlug,
  type CustomSlugError,
} from '@/lib/sharing/slug';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — return the user's current sharing config so /settings/sharing and
 * the /cv Share popover can render the same view.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      publicCvEnabled: true,
      publicCvSlug: true,
      publicAvatarEnabled: true,
    },
  });
  return NextResponse.json({
    enabled: user?.publicCvEnabled ?? false,
    slug: user?.publicCvSlug ?? null,
    avatarEnabled: user?.publicAvatarEnabled ?? true,
  });
}

const Body = z.object({
  enabled: z.boolean().optional(),
  customSlug: z.string().nullable().optional(),
  avatarEnabled: z.boolean().optional(),
});

/**
 * POST — partial update.
 *
 *  - Setting enabled=true generates a random slug if none exists yet.
 *  - Setting customSlug to a string validates + claims it (first-come).
 *  - Setting customSlug=null reverts to a freshly-generated random slug.
 *  - avatarEnabled toggles the public-page profile photo.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const parse = Body.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json(
      { error: 'bad_request', details: parse.error.flatten() },
      { status: 400 },
    );
  }
  const { enabled, customSlug, avatarEnabled } = parse.data;

  // Validate custom slug up-front so we don't half-write.
  let resolvedCustom: string | null | undefined;
  if (customSlug !== undefined) {
    if (customSlug === null) {
      resolvedCustom = null;
    } else {
      const trimmed = customSlug.trim().toLowerCase();
      const err = validateCustomSlug(trimmed);
      if (err) return errorForSlug(err);
      resolvedCustom = trimmed;
    }
  }

  // Pull current state so we know whether to generate a slug on enable.
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { publicCvSlug: true },
  });
  const data: Prisma.UserUpdateInput = {};
  if (enabled !== undefined) data.publicCvEnabled = enabled;
  if (avatarEnabled !== undefined) data.publicAvatarEnabled = avatarEnabled;

  // Slug resolution:
  //   - Explicit customSlug => use it (or regenerate random on null).
  //   - First-time enable    => generate a random slug.
  //   - Otherwise            => leave existing slug.
  if (resolvedCustom !== undefined) {
    data.publicCvSlug = resolvedCustom ?? (await freshUniqueSlug());
  } else if (enabled === true && !current?.publicCvSlug) {
    data.publicCvSlug = await freshUniqueSlug();
  }

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        publicCvEnabled: true,
        publicCvSlug: true,
        publicAvatarEnabled: true,
      },
    });
    return NextResponse.json({
      enabled: updated.publicCvEnabled,
      slug: updated.publicCvSlug,
      avatarEnabled: updated.publicAvatarEnabled,
    });
  } catch (e) {
    // Unique constraint on publicCvSlug → another user already owns this
    // custom slug. Tell the caller specifically so the form can show a
    // good error.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json(
        { error: 'slug_taken', hint: 'That slug is already in use. Try another.' },
        { status: 409 },
      );
    }
    throw e;
  }
}

/**
 * Generate a random slug, retrying on the (extremely unlikely) collision.
 * Cap at 5 attempts; further collisions point to a pathological state we
 * want to surface as a 500 rather than loop forever.
 *
 * Authoritative uniqueness comes from the `User.publicCvSlug @unique`
 * constraint in the schema, which Postgres enforces at INSERT/UPDATE
 * time even under concurrency. The findUnique here is a usability
 * optimization that lets us pick an unused slug BEFORE attempting the
 * write — without it, two users racing to claim the same random slug
 * would both call `user.update`, one would get a 409 we'd have to retry,
 * and we'd burn a round-trip. With it, the loop deduplicates client-side
 * and the constraint catches the rare race that slips through. Either
 * way the database guarantees uniqueness; this function is just polite.
 */
async function freshUniqueSlug(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const candidate = generateRandomSlug();
    const exists = await prisma.user.findUnique({
      where: { publicCvSlug: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  throw new Error('Could not generate unique slug after 5 attempts');
}

function errorForSlug(err: CustomSlugError) {
  const messages: Record<CustomSlugError['code'], string> = {
    too_short: 'Slug must be at least 3 characters.',
    too_long: 'Slug must be at most 30 characters.',
    invalid_chars:
      'Slug can only contain lowercase letters, digits, and hyphens (no leading or trailing hyphen, no double hyphens).',
    reserved: 'That slug is reserved. Try another.',
  };
  return NextResponse.json({ error: err.code, hint: messages[err.code] }, { status: 400 });
}
