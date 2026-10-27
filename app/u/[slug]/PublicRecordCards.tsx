import { ExternalLink } from 'lucide-react';
import type { CvJudgeRow, CvSpeakerRow } from '@/lib/cv/buildCvData';
import { formatStageForDisplay, formatBaseStageForDisplay, championTitle } from '@/lib/cv/formatStage';
import { teamTabPlacement, formatTopPercent } from '@/lib/cv/teamPlacement';
import { Badge } from '@/components/ui/Badge';
import { hashRank } from '@/lib/cv/rankDisplay';

/**
 * Phone layout for the public CV (`/u/<slug>`): one card per tournament.
 *
 * The public page used to render only the desktop ledger, and at 390 px a
 * recipient opening a shared link saw two of its eight columns (Tournament
 * and Year). Every score, rank and break sat off the right edge of a
 * scroller with no cue that it scrolled. A shared CV is opened on a phone
 * from a message at least as often as on a laptop, so the cards carry the
 * same facts as the table, labelled, with nothing truncated: touch devices
 * never show a `title` tooltip, so a clipped team name is a lost team name.
 *
 * This is a local equivalent of the `TournamentCard` the /cv record is
 * having extracted into `components/TournamentCard.tsx` (UI/UX audit,
 * 2026-10-27, task T3). Once that lands this file can be swapped for the
 * shared component. It is kept separate until then because the public view
 * deliberately differs: no report button, no round ledger, no partner list.
 */

/** Furthest outround reached, per category when the team broke in more than one. */
export function fmtPublicLastOutround(r: CvSpeakerRow): string | null {
  if (r.eliminationReachedByCategory && r.eliminationReachedByCategory.length > 1) {
    const joined = r.eliminationReachedByCategory
      .map((e) => `${e.category}: ${formatBaseStageForDisplay(e.stage)}`)
      .join(' · ');
    return r.wonTournament === true ? `${joined} (${championTitle(r.eliminationReached)})` : joined;
  }
  if (!r.eliminationReached) return null;
  const display = formatStageForDisplay(r.eliminationReached);
  return r.wonTournament === true ? `${display} (${championTitle(r.eliminationReached)})` : display;
}

/**
 * The break marker. When the outround is known it goes inside the gold
 * badge rather than beside a second "Broke" badge, which said the same
 * thing twice (the /cv desktop ledger made the same change).
 */
export function PublicBreakMarker({ r }: { r: CvSpeakerRow }) {
  const outround = fmtPublicLastOutround(r);
  if (r.broke) return <Badge variant="gold">{outround ?? 'Broke'}</Badge>;
  return outround ? <span className="text-ink">{outround}</span> : null;
}

/**
 * The tournament name as a link to the tab it was read from. It opens in a
 * new tab, so it says so in text (WCAG technique G201) and shows the icon at
 * full strength rather than on hover only.
 */
function SourceLink({ href, name }: { href: string; name: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-6 min-w-0 items-start gap-1.5 break-words py-0.5 font-display text-h4 font-medium text-ink hover:text-primary"
    >
      <span className="min-w-0">{name}</span>
      <ExternalLink className="mt-1.5 h-3.5 w-3.5 shrink-0 text-ink-soft" aria-hidden />
      <span className="sr-only"> (opens in new tab)</span>
    </a>
  );
}

function CardHead({ href, name, year }: { href: string; name: string; year: number | null }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <SourceLink href={href} name={name} />
      <span className="num shrink-0 pt-1 text-caption text-ink-soft">{year ?? '—'}</span>
    </div>
  );
}

function Field({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="data-label">{label}</dt>
      <dd className={'mt-0.5 break-words text-table text-ink ' + (mono ? 'num' : '')}>{value}</dd>
      {hint ? <dd className="text-caption text-ink-soft">{hint}</dd> : null}
    </div>
  );
}

/**
 * Team rank always carries its field size when the tab published one, and
 * the "top N%" is the team's share of the team tab: placement is a team fact
 * (DESIGN_INSTRUCTIONS §9, PR #167), so the speaker-tab rank sits in its own
 * field labelled as the speaker tab and never stands in for it.
 */
function teamRankField(r: CvSpeakerRow) {
  if (r.teamRank == null) return null;
  const p = teamTabPlacement(r.teamRank, r.totalTeams);
  return (
    <Field
      label="Team rank"
      value={p ? `${hashRank(p.rank, r.teamRankTied)} of ${p.of}` : hashRank(r.teamRank, r.teamRankTied)}
      hint={p ? `top ${formatTopPercent(p.topPercent)} of the team tab` : undefined}
      mono
    />
  );
}

export function PublicSpeakerCard({ r }: { r: CvSpeakerRow }) {
  const marker = <PublicBreakMarker r={r} />;
  return (
    <li className="panel p-4">
      <CardHead href={r.sourceUrl} name={r.tournamentName} year={r.year} />
      {r.broke || fmtPublicLastOutround(r) ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-caption">{marker}</div>
      ) : null}
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
        {teamRankField(r)}
        {r.speakerRankOpen != null ? (
          <Field label="Speaker-tab rank" value={hashRank(r.speakerRankOpen, r.speakerRankTied)} mono />
        ) : null}
        {r.speakerAvgScore ? <Field label="Speaker avg" value={r.speakerAvgScore} mono /> : null}
        {r.teamName ? <Field label="Team" value={r.teamName} /> : null}
        {r.format ? <Field label="Format" value={r.format} /> : null}
      </dl>
    </li>
  );
}

export function PublicJudgeCard({ r }: { r: CvJudgeRow }) {
  const chaired = formatStageForDisplay(r.lastOutroundChaired);
  const judged = formatStageForDisplay(r.lastOutroundJudged);
  return (
    <li className="panel p-4">
      <CardHead href={r.sourceUrl} name={r.tournamentName} year={r.year} />
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Field
          label="Prelims chaired"
          value={r.inroundsChaired != null ? String(r.inroundsChaired) : '—'}
          mono
        />
        <Field
          label="Prelims judged"
          value={r.inroundsJudged != null ? String(r.inroundsJudged) : '—'}
          mono
        />
        {chaired ? <Field label="Last outround chaired" value={chaired} /> : null}
        {judged ? <Field label="Last outround judged" value={judged} /> : null}
        {r.format ? <Field label="Format" value={r.format} /> : null}
      </dl>
    </li>
  );
}
