import type { CvJudgeRow, CvSpeakerRow } from '@/lib/cv/buildCvData';
import {
  formatStageForDisplay,
  formatBaseStageForDisplay,
  championTitle,
} from '@/lib/cv/formatStage';
import { teamTabPlacement, formatTopPercent } from '@/lib/cv/teamPlacement';
import { Badge } from '@/components/ui/Badge';
import { hashRank } from '@/lib/cv/rankDisplay';
import { TournamentCard, type TournamentCardField } from '@/components/TournamentCard';

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
 * The card itself is the shared `components/TournamentCard.tsx`, the same one
 * /cv uses, so a fix to how a tournament link or field reads lands on both
 * (PUB-1). This file only maps the public rows to its fields: the public view
 * deliberately differs from /cv in having no report button, no round ledger
 * and no partner list. A pro-am mark shows, under the team, only when the
 * owner turned on "Show pro-am marks on my public CV".
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
  return r.wonTournament === true ? championTitle(r.eliminationReached) : display;
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
 * Team rank always carries its field size when the tab published one, and
 * the "top N%" is the team's share of the team tab: placement is a team fact
 * (DESIGN_INSTRUCTIONS §9, PR #167), so the speaker-tab rank sits in its own
 * field labelled as the speaker tab and never stands in for it.
 */
function speakerFields(r: CvSpeakerRow, proAm: boolean): TournamentCardField[] {
  const out: TournamentCardField[] = [];
  if (r.teamRank != null) {
    const p = teamTabPlacement(r.teamRank, r.totalTeams);
    out.push({
      label: 'Team rank',
      value: p
        ? `${hashRank(p.rank, r.teamRankTied)} of ${p.of}`
        : hashRank(r.teamRank, r.teamRankTied),
      hint: p ? `top ${formatTopPercent(p.topPercent)} of the team tab` : undefined,
      mono: true,
    });
  }
  if (r.speakerRankOpen != null) {
    out.push({
      label: 'Speaker rank',
      value: hashRank(r.speakerRankOpen, r.speakerRankTied),
      mono: true,
    });
  }
  if (r.speakerAvgScore) out.push({ label: 'Avg speaks', value: r.speakerAvgScore, mono: true });
  if (r.teamName)
    out.push({ label: 'Team', value: r.teamName, hint: proAm ? 'Pro-am' : undefined });
  if (r.format) out.push({ label: 'Format', value: r.format });
  return out;
}

export function PublicSpeakerCard({ r, proAm = false }: { r: CvSpeakerRow; proAm?: boolean }) {
  return (
    <TournamentCard
      name={r.tournamentName}
      href={r.sourceUrl}
      year={r.year}
      result={
        r.broke || fmtPublicLastOutround(r) ? (
          <span className="text-caption">
            <PublicBreakMarker r={r} />
          </span>
        ) : null
      }
      fields={speakerFields(r, proAm)}
    />
  );
}

export function PublicJudgeCard({ r }: { r: CvJudgeRow }) {
  const chaired = formatStageForDisplay(r.lastOutroundChaired);
  const judged = formatStageForDisplay(r.lastOutroundJudged);
  const fields: TournamentCardField[] = [
    {
      label: 'Prelims chaired',
      value: r.inroundsChaired != null ? String(r.inroundsChaired) : '—',
      mono: true,
    },
    {
      label: 'Prelims judged',
      value: r.inroundsJudged != null ? String(r.inroundsJudged) : '—',
      mono: true,
    },
  ];
  if (chaired) fields.push({ label: 'Furthest outround chaired', value: chaired });
  if (judged) fields.push({ label: 'Furthest outround judged', value: judged });
  if (r.format) fields.push({ label: 'Format', value: r.format });
  return (
    <TournamentCard name={r.tournamentName} href={r.sourceUrl} year={r.year} fields={fields} />
  );
}
