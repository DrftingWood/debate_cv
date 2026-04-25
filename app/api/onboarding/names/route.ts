import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { normalizePersonName } from '@/lib/calicotab/fingerprint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Returns the unique registration names extracted from the user's private
 * URLs, with how many URLs each name appeared on and whether the matching
 * Person is already claimed by this user.
 *
 * Drives the multi-select on /onboarding: one row per distinct name, ordered
 * by URL count desc so the user's most common spelling is at the top.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const urls = await prisma.discoveredUrl.findMany({
    where: { userId },
    select: { registrationName: true, registrationPersonId: true },
  });

  const totalUrls = urls.length;
  const totalNamed = urls.filter(
    (u) => (u.registrationName ?? '').trim().length > 0,
  ).length;
  const totalUnknown = urls.filter(
    (u) => u.registrationName === null,
  ).length;
  const totalFailed = urls.filter(
    (u) => u.registrationName === '',
  ).length;

  // Group by exact display name (preserve first-seen casing). Normalize for
  // claim lookup so "Abhishek Acharya" and "abhishek acharya" share a Person.
  type NameEntry = {
    displayName: string;
    normalizedName: string;
    urlCount: number;
  };
  const byNormalized = new Map<string, NameEntry>();
  for (const u of urls) {
    const display = (u.registrationName ?? '').trim();
    if (!display) continue;
    const norm = normalizePersonName(display);
    if (!norm) continue;
    const existing = byNormalized.get(norm);
    if (existing) {
      existing.urlCount += 1;
    } else {
      byNormalized.set(norm, { displayName: display, normalizedName: norm, urlCount: 1 });
    }
  }

  // Look up which of those normalized names are already claimed by this user.
  const claimed = await prisma.person.findMany({
    where: {
      claimedByUserId: userId,
      normalizedName: { in: [...byNormalized.keys()] },
    },
    select: { normalizedName: true },
  });
  const claimedSet = new Set(claimed.map((p) => p.normalizedName));

  const names = [...byNormalized.values()]
    .map((e) => ({
      displayName: e.displayName,
      normalizedName: e.normalizedName,
      urlCount: e.urlCount,
      isMine: claimedSet.has(e.normalizedName),
    }))
    .sort((a, b) => b.urlCount - a.urlCount || a.displayName.localeCompare(b.displayName));

  return NextResponse.json({
    names,
    totals: {
      urls: totalUrls,
      named: totalNamed,
      unknown: totalUnknown, // preflight not yet run on these
      failed: totalFailed,   // preflight tried but landing was unreachable
    },
  });
}
