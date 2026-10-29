import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { CaretDown, Quotes } from '@/components/ui/icons';
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
/**
 * Motions per page (owner, 2026-10-29: "heavily truncate the motions", then
 * "show only 20 results per page"). The archive ran to 234 motion cards and 16,000 DOM nodes on one
 * page, which froze the browser. The summary figures above the list still
 * count the whole record; only the list is paged.
 */
const PER_PAGE = 20;

export default async function CvMotionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string | string[] }>;
} = {}) {
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

  const pages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
  const raw = (await searchParams)?.page;
  const asked = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? ''), 10);
  const page = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), pages) : 1;
  const from = (page - 1) * PER_PAGE;
  const pageEntries = entries.slice(from, from + PER_PAGE);
  // A tournament whose motions straddle a page boundary says so on the
  // later page, rather than looking like a second tournament.
  const continued = from > 0 ? entries[from - 1]?.tournamentKey : undefined;

  const byTournament = new Map<string, MotionEntry[]>();
  for (const e of pageEntries) {
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
        {/* One paragraph in one style (owner review 2026-10-29: two body
            paragraphs and a smaller third note sat stacked here). */}
        <p className="mt-2 max-w-2xl text-body text-ink-soft">
          Scraped from each tournament&rsquo;s motions tab and joined to the round you debated it
          in. For tournaments you judged, only the rounds you sat on a panel for are listed.
          Tournaments that never released their motions publicly do not appear.
          {leftOut > 0
            ? ` ${leftOut} tournament${leftOut === 1 ? '' : 's'} you judged ${leftOut === 1 ? 'is' : 'are'} left out because ${leftOut === 1 ? 'its' : 'their'} panels aren’t recorded.`
            : ''}
        </p>
      </header>

      {entries.length === 0 ? (
        <EmptyState
          icon={<Quotes weight="light" className="h-5 w-5" aria-hidden />}
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
          <MotionPager page={page} pages={pages} total={entries.length} from={from} />
          <div className="space-y-3">
            {[...byTournament.entries()].map(([key, list]) => {
              const first = list[0];
              return (
                // content-visibility: an archive of 200+ motions is 16,000+
                // nodes, and laying out every group froze the page (owner
                // review 2026-10-29). Off-screen groups now skip layout and
                // paint; they stay in the DOM, so find-in-page still works.
                <details
                  key={key}
                  className="group panel px-4 [contain-intrinsic-size:auto_5rem] [content-visibility:auto]"
                  open
                >
                  <summary className="flex cursor-pointer select-none items-center justify-between gap-3 py-tight">
                    <span className="min-w-0">
                      <span className="data-label block">
                        {first.year ? `${first.year}` : 'Undated'}
                      </span>
                      <span className="mt-1 block wrap-break-word font-display text-h4 font-medium text-ink">
                        {first.tournamentName}
                        {key === continued ? (
                          <span className="ml-inline text-caption font-normal text-ink-soft">
                            continued
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-caption text-ink-soft">
                      {list.length} motion{list.length === 1 ? '' : 's'}
                      <CaretDown
                        className="h-4 w-4 text-primary transition-transform duration-180 group-open:rotate-180 motion-reduce:transition-none"
                        aria-hidden
                      />
                    </span>
                  </summary>
                  {/* Rows divided by a rule inside the group, not bordered
                      cards inside a bordered panel (owner review 2026-10-29:
                      double borders and stacked padding made a one-line
                      motion 87 px tall). */}
                  <ul className="divide-y divide-border border-t border-border pb-tight">
                    {list.map((e) => (
                      <MotionCard key={`${e.tournamentKey}:${e.motion.seq}`} entry={e} />
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
          <MotionPager page={page} pages={pages} total={entries.length} from={from} />
        </>
      )}
    </div>
  );
}

function MotionCard({ entry }: { entry: MotionEntry }) {
  const { motion } = entry;
  return (
    <li className="py-tight">
      {/* One tag style for every tag (owner review 2026-10-29: a blue
          chip, a bare outline and a grey chip sat in one row). */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="num text-caption font-medium text-ink">{motion.roundLabel}</span>
        {entry.position ? <Badge variant="outline">{entry.position}</Badge> : null}
        {motion.motionType ? (
          <Badge variant="outline" title="Stem tag, approved by a moderator">
            {motion.motionType}
          </Badge>
        ) : null}
        {motion.topic ? <Badge variant="outline">{motion.topic}</Badge> : null}
        {entry.siblings > 0 ? (
          <Badge variant="outline">1 of {entry.siblings + 1} this round</Badge>
        ) : null}
        {entry.judgedOnly ? (
          <Badge variant="outline" title="You judged at this tournament rather than speaking.">
            Judged
          </Badge>
        ) : null}
        {/* Score, points and result on the tag row, right-aligned, rather
            than a third row of their own (owner review 2026-10-29: a debated
            motion was 122-146 px tall). Judged motions have none. */}
        {entry.judgedOnly ? null : (
          <dl className="ml-auto flex flex-wrap items-baseline gap-x-stack gap-y-hair">
            <Stat label="Your score" value={entry.score != null ? entry.score.toFixed(1) : null} />
            <Stat label="Team points" value={entry.points != null ? String(entry.points) : null} />
            <Stat label="Result" value={resultLabel(entry)} tone={resultTone(entry)} />
          </dl>
        )}
      </div>
      {entry.siblings > 0 ? (
        <p className="mt-1.5 text-caption text-ink-soft">
          This round released more than one motion, so the round data below applies to the round,
          not necessarily to this motion.
        </p>
      ) : null}

      <p className="mt-hair max-w-4xl text-body leading-relaxed text-ink">{motion.text}</p>

      {motion.infoSlide ? (
        <details className="mt-2">
          {/* inline-flex + min-h so the disclosure is a 44px target rather
              than an 18px line of text. */}
          <summary className="inline-flex min-h-6 cursor-pointer items-center text-caption text-ink-soft hover:text-ink coarse:min-h-[44px]">
            Info slide
          </summary>
          <p className="panel-inset mt-1.5 p-3 text-caption leading-relaxed text-ink-soft">
            {motion.infoSlide}
          </p>
        </details>
      ) : null}
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
    // Label and value on one line, so the three sit on the tag row.
    <div className="flex items-baseline gap-hair">
      <dt className="data-label">{label}</dt>
      <dd
        className={
          'num text-table ' +
          (tone === 'pos' ? 'val-pos font-medium' : tone === 'neg' ? 'val-neg' : 'text-ink')
        }
      >
        {value ?? <Nil />}
      </dd>
    </div>
  );
}

/**
 * Page links for the archive: previous, "31–60 of 234", next. Plain links,
 * so each page is its own URL and the browser's Back steps through them.
 */
function MotionPager({
  page,
  pages,
  total,
  from,
}: {
  page: number;
  pages: number;
  total: number;
  from: number;
}) {
  if (pages <= 1) return null;
  const to = Math.min(from + PER_PAGE, total);
  const href = (n: number) => (n === 1 ? '/cv/motions' : `/cv/motions?page=${n}`);
  return (
    <nav
      aria-label="Motion pages"
      className="flex flex-wrap items-center justify-between gap-tight border-y border-border py-tight"
    >
      <span className="font-mono text-caption text-ink-soft">
        {from + 1}–{to} of {total} · page {page} of {pages}
      </span>
      <span className="flex items-center gap-inline">
        {page > 1 ? (
          <Link href={href(page - 1)} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
            ← Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={href(page + 1)} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
            Next →
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
