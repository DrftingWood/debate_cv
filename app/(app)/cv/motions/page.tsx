import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ScrollText } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildCvData } from '@/lib/cv/buildCvData';
import type { CvSpeakerRow, CvTaggedMotion } from '@/lib/cv/buildCvData';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatTile, StatRow } from '@/components/ui/StatTile';
import { SectionHeader } from '@/components/ui/Card';
import { Nil } from '@/components/ui/DataTable';
import { CvSubNav } from '@/components/CvSubNav';

export const metadata: Metadata = {
  title: 'Motions',
  description: 'Every motion you have debated, with the score and result for that round.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The motion archive.
 *
 * The ingest pipeline has scraped the motions tab since PARSER_VERSION
 * 20260611.0, but until this rebuild the text was only ever used as a tag
 * target — a debater could not read back the motions they had actually
 * debated. This page joins each released motion to the round the user
 * debated it in, and carries their score, side and result alongside.
 *
 * The join is (tournament, round number). Where a round released more than
 * one motion, every motion for that round is listed with the same round
 * data attached and marked as such: without per-room draw data there is no
 * way to know which one was in the user's room, and dropping the round
 * would hide it entirely.
 */
export default async function CvMotionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  // Same gate as /cv: without a claimed identity there is no record to join
  // motions to, and the user belongs in the onboarding wizard rather than
  // staring at an empty page with no path forward.
  const claimedCount = await prisma.person.count({
    where: { claimedByUserId: session.user.id },
  });
  if (claimedCount === 0) redirect('/onboarding');

  // Motions don't need the field summary — no placement figures here.
  const data = await buildCvData(session.user.id, { includeFieldStats: false });
  const entries = buildMotionEntries(data.speakerRows, data.taggedMotions);

  const debated = entries.filter((e) => e.debated);
  const tagged = debated.filter((e) => e.motion.motionType || e.motion.topic).length;
  const withScore = debated.filter((e) => e.score != null);
  const decided = debated.filter((e) => e.won != null);
  const wins = decided.filter((e) => e.won).length;

  const byTournament = new Map<string, MotionEntry[]>();
  for (const e of entries) {
    const list = byTournament.get(e.tournamentKey) ?? [];
    list.push(e);
    byTournament.set(e.tournamentKey, list);
  }

  return (
    <div className="space-y-8">
      <header className="border-b border-border pb-6">
        <div className="data-label">Motions</div>
        <h1 className="mt-2 font-display text-h1 font-medium tracking-tight text-ink">
          Every motion on your record
        </h1>
        <p className="mt-2 max-w-2xl text-body text-ink-soft">
          Scraped from each tournament&rsquo;s motions tab and joined to the round you debated it
          in. Tournaments that never released their motions publicly do not appear.
        </p>
      </header>

      <CvSubNav active="motions" />

      {entries.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-5 w-5" aria-hidden />}
          title="No motions on record yet"
          description="Motions appear once a tournament on your record has published its motions tab. Older tournaments may need re-ingesting before their motions are captured."
          action={
            <Link href="/dashboard">
              <Button variant="primary">Open imports</Button>
            </Link>
          }
        />
      ) : (
        <>
          <StatRow>
            <StatTile
              label="Motions debated"
              value={debated.length}
              hint={`Across ${byTournament.size} tournament${byTournament.size === 1 ? '' : 's'}`}
            />
            <StatTile
              label="With a speaker score"
              value={withScore.length}
              hint={
                withScore.length > 0
                  ? `Averaging ${(
                      withScore.reduce((s, e) => s + e.score!, 0) / withScore.length
                    ).toFixed(1)}`
                  : undefined
              }
            />
            <StatTile
              label="Round record"
              value={decided.length > 0 ? `${wins}–${decided.length - wins}` : '—'}
              hint={
                decided.length > 0
                  ? `${Math.round((wins / decided.length) * 100)}% of decided rounds`
                  : 'No results published'
              }
            />
            <StatTile
              label="Tagged"
              value={debated.length > 0 ? `${Math.round((tagged / debated.length) * 100)}%` : '—'}
              hint={
                <>
                  {tagged} of {debated.length} carry an approved tag ·{' '}
                  <Link href="/cv/tags" className="underline underline-offset-2 hover:text-ink">
                    propose more
                  </Link>
                </>
              }
            />
          </StatRow>

          <div className="space-y-8">
            {[...byTournament.entries()].map(([key, list]) => {
              const first = list[0];
              return (
                <section key={key} className="space-y-3">
                  <SectionHeader
                    label={first.year ? `${first.year}` : 'Undated'}
                    title={first.tournamentName}
                    meta={`${list.length} motion${list.length === 1 ? '' : 's'}`}
                  />
                  <ul className="space-y-2">
                    {list.map((e) => (
                      <MotionCard key={`${e.tournamentKey}:${e.motion.seq}`} entry={e} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

type MotionEntry = {
  tournamentKey: string;
  tournamentName: string;
  year: number | null;
  motion: CvTaggedMotion;
  /** True when the user has a score or a result for this round. */
  debated: boolean;
  /** Other motions released for the same round, if any. */
  siblings: number;
  score: number | null;
  position: string | null;
  won: boolean | null;
  points: number | null;
};

/**
 * Join motions to the user's rounds. Exported shape is flat and sorted for
 * display: tournaments newest first, motions in the order the tab released
 * them, which for prelims is round order.
 */
function buildMotionEntries(
  speakerRows: CvSpeakerRow[],
  motions: CvTaggedMotion[],
): MotionEntry[] {
  const rowByTournament = new Map(speakerRows.map((r) => [r.tournamentId.toString(), r]));

  const siblingCount = new Map<string, number>();
  for (const m of motions) {
    if (m.roundNumber == null) continue;
    const key = `${m.tournamentId}:${m.roundNumber}`;
    siblingCount.set(key, (siblingCount.get(key) ?? 0) + 1);
  }

  const entries: MotionEntry[] = [];
  for (const motion of motions) {
    const tid = motion.tournamentId.toString();
    const row = rowByTournament.get(tid);
    // Motions from a tournament the user only judged at have no speaker
    // row; they still belong on the page as part of the record, just
    // without personal round data attached.
    if (!row) continue;

    const score =
      motion.roundNumber == null
        ? null
        : (row.roundScores.find((s) => s.roundNumber === motion.roundNumber)?.score ?? null);
    const result =
      motion.roundNumber == null
        ? null
        : (row.teamRoundResults.find((t) => t.roundNumber === motion.roundNumber) ?? null);

    entries.push({
      tournamentKey: tid,
      tournamentName: row.tournamentName,
      year: row.year,
      motion,
      debated: score != null || result != null,
      siblings:
        motion.roundNumber == null ? 0 : (siblingCount.get(`${tid}:${motion.roundNumber}`) ?? 1) - 1,
      score,
      position: result?.position ?? null,
      won: result?.won ?? null,
      points: result?.points ?? null,
    });
  }

  entries.sort((a, b) => {
    const ya = a.year ?? -Infinity;
    const yb = b.year ?? -Infinity;
    if (ya !== yb) return yb - ya;
    if (a.tournamentName !== b.tournamentName) {
      return a.tournamentName.localeCompare(b.tournamentName);
    }
    return a.motion.seq - b.motion.seq;
  });
  return entries;
}

function MotionCard({ entry }: { entry: MotionEntry }) {
  const { motion } = entry;
  return (
    <li className="panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="num text-caption font-medium text-ink">{motion.roundLabel}</span>
        {entry.position ? <Badge variant="neutral">{entry.position}</Badge> : null}
        {motion.motionType ? <Badge variant="info">{motion.motionType}</Badge> : null}
        {motion.topic ? <Badge variant="outline">{motion.topic}</Badge> : null}
        {entry.siblings > 0 ? (
          <Badge
            variant="neutral"
            title="This round released more than one motion; the round data shown applies to the round, not necessarily to this motion."
          >
            1 of {entry.siblings + 1} this round
          </Badge>
        ) : null}
      </div>

      <p className="mt-2 text-body leading-relaxed text-ink">{motion.text}</p>

      {motion.infoSlide ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-caption text-ink-soft hover:text-ink">
            Info slide
          </summary>
          <p className="panel-inset mt-1.5 p-3 text-caption leading-relaxed text-ink-soft">
            {motion.infoSlide}
          </p>
        </details>
      ) : null}

      <dl className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-border pt-3">
        <Stat label="Your score" value={entry.score != null ? entry.score.toFixed(1) : null} />
        <Stat label="Team points" value={entry.points != null ? String(entry.points) : null} />
        <Stat
          label="Result"
          value={entry.won == null ? null : entry.won ? 'Won' : 'Lost'}
          tone={entry.won == null ? undefined : entry.won ? 'pos' : 'neg'}
        />
      </dl>
    </li>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | null;
  tone?: 'pos' | 'neg';
}) {
  return (
    <div>
      <dt className="data-label">{label}</dt>
      <dd
        className={
          'num mt-0.5 text-table ' +
          (tone === 'pos' ? 'val-pos font-medium' : tone === 'neg' ? 'val-neg' : 'text-ink')
        }
      >
        {value ?? <Nil />}
      </dd>
    </div>
  );
}
