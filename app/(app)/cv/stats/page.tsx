import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { BarChart3 } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildCvData } from '@/lib/cv/buildCvData';
import { computeSpeakerStats } from '@/lib/cv/speakerStats';
import { buildStatsFacts } from '@/lib/cv/statsFacts';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { CvSubNav } from '@/components/CvSubNav';
import { FilterableStats } from '@/components/stats/FilterableStats';

export const metadata: Metadata = {
  title: 'Statistics',
  description: 'Your speaker record measured against itself and against the field.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The analysis surface — everything the record implies but doesn't say.
 *
 * Ordered the way a debater actually reads their own numbers: what is my
 * level, how consistent am I, how did I place against the people in the
 * room, what happens across a tournament, and finally the splits that say
 * where the wins and losses concentrate. Every block carries the sample it
 * rests on, and nothing here interprets style — see the header note in
 * lib/cv/speakerStats.ts for the rules this page is built to.
 *
 * The server builds the record and its round table once; the sections render
 * in FilterableStats, which recomputes them in the browser as partner,
 * pairing and seat filters change.
 */
export default async function CvStatsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  // Same gate as /cv — an unclaimed user has no rows to compute over.
  const claimedCount = await prisma.person.count({
    where: { claimedByUserId: session.user.id },
  });
  if (claimedCount === 0) redirect('/onboarding');

  const data = await buildCvData(session.user.id);
  const stats = computeSpeakerStats(data);
  const { scoreProfile, results, volume } = stats;
  const facts = buildStatsFacts(data);

  const hasAnything =
    scoreProfile.speeches > 0 ||
    results.decidedRounds > 0 ||
    stats.seasons.length > 0 ||
    stats.judgingSeasons.length > 0;

  // Only what the statistics read crosses to the browser: not the user's
  // email, and only motions from tournaments the user spoke at (a judge-only
  // tournament's motions feed the archive on /cv/motions, not these figures).
  const spoken = new Set(data.speakerRows.map((r) => r.tournamentId.toString()));
  const clientData = {
    speakerRows: data.speakerRows,
    judgeRows: data.judgeRows,
    taggedMotions: data.taggedMotions.filter((m) => spoken.has(m.tournamentId.toString())),
    fieldStats: data.fieldStats,
  };

  return (
    <div className="space-y-8">
      <header className="border-b border-border pb-6">
        <div className="data-label">Statistics</div>
        <h1 className="mt-2 font-display text-h1 font-medium tracking-tight text-ink">
          Your record, measured
        </h1>
        <p className="mt-2 max-w-2xl text-body text-ink-soft">
          Built from {volume.speechesScored.toLocaleString()} scored speeches across{' '}
          {volume.tournamentsSpoken} tournament{volume.tournamentsSpoken === 1 ? '' : 's'}. Every
          figure is computed from the tab pages themselves — nothing here is an estimate or an
          interpretation of style.
        </p>
      </header>

      <CvSubNav active="stats" />

      {!hasAnything ? (
        <EmptyState
          icon={<BarChart3 className="h-5 w-5" aria-hidden />}
          title="Not enough data yet"
          description="Statistics appear once at least one tournament with parsed results is on your record. Ingest tournaments from Imports first."
          action={
            <Link href="/dashboard">
              <Button variant="primary">Open imports</Button>
            </Link>
          }
        />
      ) : (
        <FilterableStats data={clientData} facts={facts} />
      )}
    </div>
  );
}
