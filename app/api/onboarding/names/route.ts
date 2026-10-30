import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { normalizePersonName } from '@/lib/calicotab/fingerprint';
import { proximityToYou } from '@/lib/identity/nameProximity';
import { nameSample, PREFLIGHT_SKIPPED } from '@/lib/identity/nameSample';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Returns the unique registration names extracted from the user's private
 * URLs, with how many URLs each name appeared on and whether the matching
 * Person is already claimed by this user.
 *
 * Drives the multi-select on /onboarding: one row per distinct name, ordered
 * by URL count desc so the user's most common spelling is at the top.
 *
 * Each name also carries `verified` and `proximity` (owner, 2026-10-30). The
 * name on more than half of the pages read is the user's verified name and is
 * pre-ticked. Every other name is judged against it and against names the
 * user has already claimed: close (a spelling variant, offered un-ticked) or
 * different (probably someone else's forwarded link, offered un-ticked). With
 * no majority, names are judged against the Google profile name and nothing
 * is pre-ticked. It informs the user's tick; it blocks nothing.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const urls = await prisma.discoveredUrl.findMany({
    where: { userId },
    select: { registrationName: true, registrationPersonId: true, lastPreflightError: true },
  });

  const totalUrls = urls.length;
  const totalNamed = urls.filter((u) => (u.registrationName ?? '').trim().length > 0).length;
  const totalUnknown = urls.filter((u) => u.registrationName === null).length;
  const totalSkipped = urls.filter((u) => u.lastPreflightError === PREFLIGHT_SKIPPED).length;
  const totalFailed = urls.filter((u) => u.registrationName === '').length - totalSkipped;

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
  const mine = await prisma.person.findMany({
    where: { claimedByUserId: userId },
    select: { displayName: true },
  });
  const sample = nameSample(urls.map((u) => u.registrationName));
  const verifiedNorm =
    sample.hasMajority && sample.topName ? normalizePersonName(sample.topName) : null;
  const references = [
    verifiedNorm ? sample.topName : session.user.name,
    ...mine.map((p) => p.displayName),
  ];

  const names = [...byNormalized.values()]
    .map((e) => ({
      displayName: e.displayName,
      normalizedName: e.normalizedName,
      urlCount: e.urlCount,
      isMine: claimedSet.has(e.normalizedName),
      verified: e.normalizedName === verifiedNorm,
      proximity: proximityToYou(e.displayName, references),
      /** What `proximity` was judged against: the majority name, or the Google name. */
      comparedTo: verifiedNorm ? ('majority' as const) : ('google' as const),
    }))
    .sort((a, b) => b.urlCount - a.urlCount || a.displayName.localeCompare(b.displayName));

  return NextResponse.json({
    names,
    totals: {
      urls: totalUrls,
      named: totalNamed,
      unknown: totalUnknown, // preflight not yet run on these
      failed: totalFailed, // preflight tried but landing was unreachable
      skipped: totalSkipped, // not read: the name was settled from other links
    },
  });
}
