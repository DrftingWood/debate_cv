import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { BarChart3 } from 'lucide-react';
import { auth } from '@/lib/auth';
import { buildCvData } from '@/lib/cv/buildCvData';
import { computeCvAnalytics } from '@/lib/cv/computeCvAnalytics';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { TrendChart } from '@/components/ui/TrendChart';
import { BarList } from '@/components/ui/BarList';
import { CvSubNav } from '@/components/CvSubNav';

export const metadata: Metadata = {
  title: 'Analytics',
  description: 'Trends across your debate tournament history.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function CvAnalyticsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const data = await buildCvData(session.user.id);
  const analytics = computeCvAnalytics(data);
  const { coverage } = analytics;

  const hasAnything =
    analytics.speakerYearTrend.length > 0 ||
    analytics.roundProfile.length > 0 ||
    analytics.formatSlices.length > 0 ||
    analytics.judgingYearTrend.length > 0;

  const avgTrendPoints = analytics.speakerYearTrend
    .filter((p) => p.avgSpeakerScore != null)
    .map((p) => ({ label: String(p.year), value: p.avgSpeakerScore! }));

  const roundProfilePoints = analytics.roundProfile.map((p) => ({
    label: `R${p.roundNumber}`,
    value: p.avgScore,
  }));

  const breakBars = analytics.speakerYearTrend.map((p) => ({
    label: String(p.year),
    value: p.breakRate,
    display: `${p.breaks}/${p.tournaments} · ${Math.round(p.breakRate * 100)}%`,
  }));

  return (
    <div className="space-y-10">
      <header className="space-y-4">
        <div className="kicker">DEBATE CV — ANALYTICS</div>
        <h1 className="font-serif text-h1 italic leading-[1.05] tracking-tight text-ink">
          Trends.
        </h1>
        <hr className="hairline" />
        <div className="byline">
          Computed from {coverage.speakerTournaments + coverage.judgeTournaments} CV row
          {coverage.speakerTournaments + coverage.judgeTournaments === 1 ? '' : 's'}.
        </div>
      </header>

      <CvSubNav active="analytics" />

      {!hasAnything ? (
        <EmptyState
          icon={<BarChart3 className="h-5 w-5" aria-hidden />}
          title="Not enough data yet"
          description="Trends appear once at least one tournament with parsed results is on your CV. Ingest tournaments from the dashboard first."
          action={
            <Link href="/dashboard">
              <Button variant="primary">Open dashboard</Button>
            </Link>
          }
        />
      ) : (
        <>
          {avgTrendPoints.length > 0 ? (
            <section aria-label="Speaker average by year" className="space-y-3">
              <header>
                <div className="kicker">I · SPEAKER AVERAGE BY YEAR</div>
              </header>
              <TrendChart points={avgTrendPoints} />
              <CoverageNote
                used={coverage.speakerWithAvgScore}
                total={coverage.speakerTournaments}
                what="tournaments with a parsed speaker average"
              />
            </section>
          ) : null}

          {roundProfilePoints.length > 1 ? (
            <section aria-label="Round-by-round profile" className="space-y-3">
              <header>
                <div className="kicker">II · ROUND-BY-ROUND PROFILE</div>
                <p className="mt-1 text-caption text-ink-soft">
                  Average speaker score per prelim round number, across all tournaments
                  with per-round scores — shows whether you start slow or finish strong.
                </p>
              </header>
              <TrendChart points={roundProfilePoints} />
              <CoverageNote
                used={coverage.speakerWithRoundScores}
                total={coverage.speakerTournaments}
                what="tournaments with per-round scores"
              />
            </section>
          ) : null}

          {breakBars.length > 0 ? (
            <section aria-label="Break record by year" className="space-y-3">
              <header>
                <div className="kicker">III · BREAK RECORD BY YEAR</div>
              </header>
              <BarList items={breakBars} className="max-w-xl" />
            </section>
          ) : null}

          {analytics.positionSlices.length > 0 ? (
            <section aria-label="By team position" className="space-y-3">
              <header>
                <div className="kicker">IV · BY TEAM POSITION</div>
                <p className="mt-1 text-caption text-ink-soft">
                  How you perform from each side of the table. Position data is parsed
                  from round-results pages — older tournaments gain it on re-ingest.
                </p>
              </header>
              <div className="max-w-full overflow-x-auto">
                <table className="min-w-max text-table">
                  <thead>
                    <tr className="border-y border-ink/15 text-left uppercase tracking-[0.14em] text-kicker font-semibold text-ink-soft">
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Position</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">Rounds</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">Win rate</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium" title="Average team points per round (BP: 0–3)">
                        Avg points
                      </th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">Avg spkr score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.positionSlices.map((s) => (
                      <tr key={s.position} className="border-b border-ink/10">
                        <td className="px-4 py-2.5">{s.position}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 num">{s.rounds}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 num">
                          {s.winRate != null
                            ? `${Math.round(s.winRate * 100)}% (${s.wins}/${s.decidedRounds})`
                            : '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 num">
                          {s.avgTeamPoints != null ? s.avgTeamPoints.toFixed(2) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 num">
                          {s.avgSpeakerScore != null ? s.avgSpeakerScore.toFixed(1) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <CoverageNote
                used={coverage.speakerWithPositions}
                total={coverage.speakerTournaments}
                what="tournaments with per-round position data"
              />
            </section>
          ) : null}

          {analytics.formatSlices.length > 0 ? (
            <section aria-label="By format" className="space-y-3">
              <header>
                <div className="kicker">V · BY FORMAT</div>
              </header>
              <div className="max-w-full overflow-x-auto">
                <table className="min-w-max text-table">
                  <thead>
                    <tr className="border-y border-ink/15 text-left uppercase tracking-[0.14em] text-kicker font-semibold text-ink-soft">
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Format</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">Tournaments</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">Spkr avg</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">Breaks</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">Break rate</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">Best rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.formatSlices.map((s) => (
                      <tr key={s.format} className="border-b border-ink/10">
                        <td className="px-4 py-2.5">{s.format}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 num">{s.tournaments}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 num">
                          {s.avgSpeakerScore != null ? s.avgSpeakerScore.toFixed(1) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 num">{s.breaks}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 num">
                          {Math.round(s.breakRate * 100)}%
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 num">
                          {s.bestSpeakerRank != null ? `#${s.bestSpeakerRank}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {analytics.regionSlices.length > 0 ? (
            <section aria-label="By region" className="space-y-3">
              <header>
                <div className="kicker">VI · BY REGION</div>
                <p className="mt-1 text-caption text-ink-soft">
                  Regions are community tags, reviewed before they go live —{' '}
                  <Link href="/cv/tags" className="underline underline-offset-2 hover:text-ink">
                    tag your untagged tournaments
                  </Link>
                  .
                </p>
              </header>
              <div className="max-w-full overflow-x-auto">
                <table className="min-w-max text-table">
                  <thead>
                    <tr className="border-y border-ink/15 text-left uppercase tracking-[0.14em] text-kicker font-semibold text-ink-soft">
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Region</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">Tournaments</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">Spkr avg</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">Breaks</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">Break rate</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">Best rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.regionSlices.map((s) => (
                      <tr key={s.region} className="border-b border-ink/10">
                        <td className="px-4 py-2.5">{s.region}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 num">{s.tournaments}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 num">
                          {s.avgSpeakerScore != null ? s.avgSpeakerScore.toFixed(1) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 num">{s.breaks}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 num">
                          {Math.round(s.breakRate * 100)}%
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 num">
                          {s.bestSpeakerRank != null ? `#${s.bestSpeakerRank}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <CoverageNote
                used={coverage.speakerWithRegion}
                total={coverage.speakerTournaments}
                what="tournaments with an approved region tag"
              />
            </section>
          ) : null}

          {analytics.motionTypeSlices.length > 0 || analytics.motionTopicSlices.length > 0 ? (
            <section aria-label="By motion tag" className="space-y-4">
              <header>
                <div className="kicker">VII · BY MOTION</div>
                <p className="mt-1 text-caption text-ink-soft">
                  Per-round performance grouped by the motion&rsquo;s approved tags: the
                  stem (THW, THBT, …) and the subject area.
                </p>
              </header>
              <div className="flex flex-col gap-6 lg:flex-row lg:gap-12">
                <MotionSliceTable label="Type" items={analytics.motionTypeSlices} />
                <MotionSliceTable label="Topic" items={analytics.motionTopicSlices} />
              </div>
            </section>
          ) : null}

          {analytics.judgingYearTrend.length > 0 ? (
            <section aria-label="Judging by year" className="space-y-3">
              <header>
                <div className="kicker">VIII · JUDGING BY YEAR</div>
              </header>
              <div className="max-w-full overflow-x-auto">
                <table className="min-w-max text-table">
                  <thead>
                    <tr className="border-y border-ink/15 text-left uppercase tracking-[0.14em] text-kicker font-semibold text-ink-soft">
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Year</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">Tournaments</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">Inrounds chaired</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium">Judged outrounds at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.judgingYearTrend.map((p) => (
                      <tr key={p.year} className="border-b border-ink/10">
                        <td className="px-4 py-2.5 num">{p.year}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 num">{p.tournaments}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 num">{p.inroundsChaired}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 num">{p.outroundTournaments}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <p className="text-caption text-ink-soft">
            Slices by motion type and region will appear here as tags land.{' '}
            <Link href="/cv/tags" className="underline underline-offset-2 hover:text-ink">
              Tag your tournaments&rsquo; regions and motions →
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

function MotionSliceTable({
  label,
  items,
}: {
  label: string;
  items: { value: string; rounds: number; decidedRounds: number; wins: number; winRate: number | null; avgSpeakerScore: number | null }[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="min-w-max text-table">
        <thead>
          <tr className="border-y border-ink/15 text-left uppercase tracking-[0.14em] text-kicker font-semibold text-ink-soft">
            <th className="whitespace-nowrap px-4 py-2.5 font-medium">{label}</th>
            <th className="whitespace-nowrap px-3 py-2.5 font-medium">Rounds</th>
            <th className="whitespace-nowrap px-3 py-2.5 font-medium">Win rate</th>
            <th className="whitespace-nowrap px-3 py-2.5 font-medium">Avg spkr score</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.value} className="border-b border-ink/10">
              <td className="px-4 py-2.5">{s.value}</td>
              <td className="whitespace-nowrap px-3 py-2.5 num">{s.rounds}</td>
              <td className="whitespace-nowrap px-3 py-2.5 num">
                {s.winRate != null
                  ? `${Math.round(s.winRate * 100)}% (${s.wins}/${s.decidedRounds})`
                  : '—'}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 num">
                {s.avgSpeakerScore != null ? s.avgSpeakerScore.toFixed(1) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoverageNote({ used, total, what }: { used: number; total: number; what: string }) {
  if (used >= total) return null;
  return (
    <p className="text-caption text-ink-soft">
      Based on {used} of {total} {what}.
    </p>
  );
}
