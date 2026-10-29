import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ScrollText, ChevronDown } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildCvData } from '@/lib/cv/buildCvData';
import {
  attachKnockoutResults,
  buildMotionEntries,
  judgedWithoutKnownRounds,
  type MotionEntry,
} from '@/lib/cv/motionEntries';
import { EmptyState } from '@/components/ui/EmptyState';
import { buttonClasses } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatTile, StatRow } from '@/components/ui/StatTile';
import { Nil } from '@/components/ui/DataTable';
import { CvSubNav } from '@/components/CvSubNav';
import { isAdminEmail } from '@/lib/admin';
import { OUTCOME_COPY } from '@/lib/cv/roundOutcome';

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
 *
 * Knockout motions carry no round number, so they join instead to the
 * user's team's result in that stage (advanced, won, eliminated): outround
 * speaker scores are not published, so a result is all there is to show.
 */
export default async function CvMotionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const isAdmin = isAdminEmail(session.user.email);

  // Same gate as /cv: without a claimed identity there is no record to join
  // motions to, and the user belongs in the onboarding wizard rather than
  // staring at an empty page with no path forward.
  const claimedCount = await prisma.person.count({
    where: { claimedByUserId: session.user.id },
  });
  if (claimedCount === 0) redirect('/onboarding');

  // Motions don't need the field summary — no placement figures here.
  const data = await buildCvData(session.user.id, { includeFieldStats: false });
  const entries = attachKnockoutResults(
    buildMotionEntries(data.speakerRows, data.judgeRows, data.taggedMotions),
    data.teamOutroundResults,
  );
  // Tournaments the user judged whose panels are not recorded: left out
  // rather than listed in full, and counted so the page can say so.
  const leftOut = judgedWithoutKnownRounds(data.speakerRows, data.judgeRows, data.taggedMotions);

  const debated = entries.filter((e) => e.debated);
  const tagged = debated.filter((e) => e.motion.motionType || e.motion.topic).length;
  const fullyTagged = debated.filter((e) => e.motion.motionType && e.motion.topic).length;
  const scores = debated.map((e) => e.score).filter((s): s is number => s != null);
  const knockouts = debated.filter((e) => e.knockout != null);
  const knockoutsThrough = knockouts.filter((e) => e.knockout?.won).length;
  const decided = debated.filter((e) => e.won != null);
  const wins = decided.filter((e) => e.won).length;
  // BP rounds are never "wins": a four-team room counts 2nd or better.
  const hasBp = decided.some((e) => e.fourTeam);
  const hasTwoTeam = decided.some((e) => !e.fourTeam);
  const outcome = hasBp ? (hasTwoTeam ? 'mixed' : 'top-two') : 'win';
  // Count tournaments the user SPOKE at for the summary strip — the page
  // below also lists tournaments they only judged, which would inflate a
  // "motions debated across N tournaments" figure.
  const debatedTournaments = new Set(debated.map((e) => e.tournamentKey)).size;
  const judgedEntries = entries.filter((e) => e.judgedOnly);

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
          in. For tournaments you judged, only the rounds you sat on a panel for are listed.
          Tournaments that never released their motions publicly do not appear.
        </p>
        {leftOut > 0 ? (
          <p className="mt-2 max-w-2xl text-caption text-ink-soft">
            {leftOut} tournament{leftOut === 1 ? '' : 's'} you judged {leftOut === 1 ? 'is' : 'are'}{' '}
            not listed here because {leftOut === 1 ? 'its' : 'their'} panels aren&rsquo;t recorded,
            so there is no telling which rounds you sat on.
          </p>
        ) : null}
      </header>

      <CvSubNav active="motions" />

      {entries.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-5 w-5" aria-hidden />}
          title="No motions on record yet"
          description="Motions appear once a tournament on your record has published its motions tab. Older tournaments may need re-ingesting before their motions are captured."
          action={
            <Link href="/dashboard" className={buttonClasses({ variant: 'primary' })}>
              Open imports
            </Link>
          }
        />
      ) : (
        <>
          <StatRow>
            <StatTile
              label="Motions debated"
              value={debated.length}
              hint={
                <>
                  Across {debatedTournaments} tournament{debatedTournaments === 1 ? '' : 's'}
                  {judgedEntries.length > 0 ? ` · ${judgedEntries.length} more judged` : ''}
                </>
              }
            />
            <StatTile
              label="With a speaker score"
              value={scores.length}
              hint={
                scores.length > 0
                  ? `Averaging ${(scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(1)}`
                  : undefined
              }
            />
            <StatTile
              label={outcome === 'win' ? 'Round record' : 'Rounds 2nd or better'}
              value={
                decided.length > 0
                  ? outcome === 'win'
                    ? `${wins}–${decided.length - wins}`
                    : `${wins} of ${decided.length}`
                  : '—'
              }
              hint={
                decided.length > 0
                  ? `${Math.round((wins / decided.length) * 100)}% of decided rounds${outcome === 'win' ? '' : ` (${OUTCOME_COPY[outcome].rounds})`}`
                  : 'No results published'
              }
            />
            {knockouts.length > 0 ? (
              <StatTile
                label="Knockout record"
                value={`${knockoutsThrough}–${knockouts.length - knockoutsThrough}`}
                hint="Rounds advanced from or won, against rounds you went out in"
              />
            ) : null}
            {isAdmin ? (
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
            ) : null}
          </StatRow>

          {debated.length > 0 ? (
            <p className="max-w-2xl text-caption text-ink-soft">
              {fullyTagged} of {debated.length} motion{debated.length === 1 ? '' : 's'} you debated
              carry both a topic and a stem tag (THW, THBT, …). Knockout motions show your
              team&rsquo;s result rather than a score, because outround speaker scores are not
              published.
            </p>
          ) : null}

          {/*
            One <details> per tournament, and only the most recent opens.

            Every motion for every tournament rendered at once made this
            page 20,593px on desktop and 24,937px on a phone — 28 screens of
            motion cards with no index. Grouping by tournament already
            existed; it just was not foldable, so the grouping bought
            nothing. The headers now act as the archive's table of contents.
          */}
          <div className="space-y-3">
            {[...byTournament.entries()].map(([key, list], index) => {
              const first = list[0];
              return (
                <details key={key} className="group panel px-4" open={index === 0}>
                  <summary className="flex cursor-pointer select-none items-center justify-between gap-3 py-4">
                    <span className="min-w-0">
                      <span className="data-label block">
                        {first.year ? `${first.year}` : 'Undated'}
                      </span>
                      <span className="mt-1 block wrap-break-word font-display text-h4 font-medium text-ink">
                        {first.tournamentName}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-caption text-ink-soft">
                      {list.length} motion{list.length === 1 ? '' : 's'}
                      <ChevronDown
                        className="h-4 w-4 text-primary transition-transform group-open:rotate-180"
                        aria-hidden
                      />
                    </span>
                  </summary>
                  <ul className="space-y-2 pb-4">
                    {list.map((e) => (
                      <MotionCard key={`${e.tournamentKey}:${e.motion.seq}`} entry={e} />
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function MotionCard({ entry }: { entry: MotionEntry }) {
  const { motion } = entry;
  return (
    <li className="panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="num text-caption font-medium text-ink">{motion.roundLabel}</span>
        {entry.position ? <Badge variant="neutral">{entry.position}</Badge> : null}
        {motion.motionType ? (
          <Badge variant="info" title="Stem tag, approved by a moderator">
            {motion.motionType}
          </Badge>
        ) : null}
        {motion.topic ? <Badge variant="outline">{motion.topic}</Badge> : null}
        {entry.siblings > 0 ? (
          <Badge variant="neutral">1 of {entry.siblings + 1} this round</Badge>
        ) : null}
        {entry.judgedOnly ? (
          <Badge variant="neutral" title="You judged at this tournament rather than speaking.">
            Judged
          </Badge>
        ) : null}
      </div>
      {entry.siblings > 0 ? (
        <p className="mt-1.5 text-caption text-ink-soft">
          This round released more than one motion, so the round data below applies to the round,
          not necessarily to this motion.
        </p>
      ) : null}

      <p className="mt-2 text-body leading-relaxed text-ink">{motion.text}</p>

      {motion.infoSlide ? (
        <details className="mt-2">
          {/* inline-flex + min-h so the disclosure is a 44px target rather
              than an 18px line of text. */}
          <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-caption text-ink-soft hover:text-ink">
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
        <Stat label="Result" value={resultLabel(entry)} tone={resultTone(entry)} />
      </dl>
    </li>
  );
}

/**
 * A prelim result reads Won / Lost. A knockout reads Advanced or Eliminated,
 * and the final Won or Lost: in BP two of four teams go through a knockout
 * room, so "won" there would overstate it.
 */
function resultLabel(entry: MotionEntry): string | null {
  if (entry.knockout) {
    if (entry.knockout.final) return entry.knockout.won ? 'Won' : 'Lost';
    return entry.knockout.won ? 'Advanced' : 'Eliminated';
  }
  return entry.won == null ? null : entry.won ? 'Won' : 'Lost';
}

function resultTone(entry: MotionEntry): 'pos' | 'neg' | undefined {
  const won = entry.knockout ? entry.knockout.won : entry.won;
  return won == null ? undefined : won ? 'pos' : 'neg';
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
