import { ImageResponse } from 'next/og';
import { prisma } from '@/lib/db';
import { buildCvData } from '@/lib/cv/buildCvData';
import { ShareCard, type ShareCardPerson } from '@/components/landing/ShareCard';

// Literals: Next reads these exports statically. Node runtime because Prisma
// does not run on the edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const alt = 'A public debate record on debate cv';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Chat clients cache unfurls; keep it short so a CV later made private stops
// showing its name soon.
const HEADERS = { 'Cache-Control': 'public, max-age=300, s-maxage=300' };

/**
 * Per-CV share card. Privacy: the profile is re-read at render time and only
 * `publicCvEnabled` profiles get a name and figures. A disabled or missing
 * slug (or any failure) returns the generic card, so the response is identical
 * for "does not exist" and "is private". Figures come from the same
 * buildCvData call as the page, so the owner's own name is the only name used.
 */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let person: ShareCardPerson | undefined;
  try {
    const user = await prisma.user.findUnique({
      where: { publicCvSlug: slug },
      select: { id: true, name: true, publicCvEnabled: true, publicHiddenTournamentIds: true },
    });
    if (user?.publicCvEnabled) {
      // Same hidden list as the page: the share card must not count or reveal
      // a tournament the owner hid (C101).
      const { summary, highlights } = await buildCvData(user.id, {
        includeFieldStats: false,
        excludeTournamentIds: user.publicHiddenTournamentIds ?? [],
      });
      const y = highlights.activeYears;
      person = {
        name: user.name ?? 'Debater',
        tournaments: summary.totalTournaments,
        breaks: summary.breaks,
        activeYears: y ? (y.from === y.to ? `${y.from}` : `${y.from}–${y.to}`) : null,
      };
    }
  } catch {
    person = undefined;
  }
  return new ImageResponse(<ShareCard person={person} />, {
    ...size,
    headers: person ? HEADERS : { 'Cache-Control': 'no-store' },
  });
}
