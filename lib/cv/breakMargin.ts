/**
 * Break margin: how far above or below the Open break line each tournament
 * finished, and the breaks missed by a single point or win.
 *
 * THE LINE. Tabbycat publishes the break as a list of teams, not as a
 * number, so the line is derived: the team-tab points (BP) or wins (every
 * two-team format) of the lowest team on the Open break tab. That is the
 * only honest definition. The other obvious one — "the best team that did
 * NOT break" — is wrong on real tabs: at IITB 2023 three teams on 10 and 11
 * points sit off a 16-team break whose last team had 9 (ineligible, capped
 * or declined), and teams level with the last breaker who lose the speaker
 * tiebreak are normal everywhere. Checked before building against two local
 * tab corpora (58 and 46 tournaments with an Open break tab) and the seeded
 * record (24): break ranks followed the team-tab order, every breaking team
 * had a standing, and outside IITB 2023 and one Tokyo IV team no team off
 * the break finished above the line.
 *
 * WHAT IS LEFT OUT, with a reason each, rather than guessed:
 *   - no Open break tab stored (ESL / EFL / novice tabs only, a category
 *     named something else such as "Abierto", or no break data at all);
 *   - a team on the break with no standing on the team tab — the missing
 *     team could be the lowest, so the line is unknown, not optimistic;
 *   - the user's team finished ABOVE the line yet is not on the break: it
 *     was ineligible or declined, and "−0" or "+2 but didn't break" reads
 *     as nonsense;
 *   - unknown format (no unit to measure in), or no team standing.
 *
 * Only the Open line. A team that broke ESL but not Open is measured against
 * the Open line and flagged `brokeElsewhere`; category lines are a different
 * bracket with a different field and are not blended in here.
 *
 * UNITS are never mixed: BP margins are team points, everything else is
 * wins, and figures are grouped by format — Asian Parliamentary and Australs
 * both count wins but over different round counts and fields, so they are
 * not pooled either.
 *
 * Tournament-level: under a seat filter the page withholds this section.
 */

import type { CvSpeakerRow } from '@/lib/cv/buildCvData';

/**
 * The Open break of one tournament, as buildCvData attaches it to a speaker
 * row. Computed from the tournament's team tab (TeamResult round 0) and its
 * Open break tab (EliminationResult rows with stage 'Open').
 */
export type CvOpenBreak = {
  /** Teams on the Open break tab. */
  teams: number;
  /** The user's team is on it. */
  userOnBreak: boolean;
  /** Lowest team points among breaking teams; null if any has none. */
  linePoints: number | null;
  /** Lowest wins among breaking teams; null if any has none. */
  lineWins: number | null;
};

export type StandingLike = { teamName: string; points: number | null; wins: number | null };

export function deriveOpenBreak(
  standings: StandingLike[],
  openBreakTeamNames: Iterable<string>,
  userTeamName: string | null,
): CvOpenBreak | null {
  const names = new Set(openBreakTeamNames);
  if (names.size === 0) return null;
  const byName = new Map(standings.map((s) => [s.teamName, s]));
  const line = (unit: 'points' | 'wins'): number | null => {
    let min = Infinity;
    for (const name of names) {
      const v = byName.get(name)?.[unit];
      if (v == null || !Number.isFinite(v)) return null;
      if (v < min) min = v;
    }
    return min;
  };
  return {
    teams: names.size,
    userOnBreak: userTeamName != null && names.has(userTeamName),
    linePoints: line('points'),
    lineWins: line('wins'),
  };
}

export type MarginUnit = 'points' | 'wins';

export type MarginOutcome =
  /** On the break, above the line. */
  | 'cleared'
  /** On the break, level with the line — through on the tiebreak. */
  | 'on-the-line'
  /** Off the break, level with the line — out on the tiebreak. */
  | 'missed-on-speaks'
  /** One point (BP) or one win short. */
  | 'missed-by-one'
  | 'missed';

export type MarginEntry = {
  tournamentId: bigint;
  tournamentName: string;
  year: number | null;
  value: number;
  line: number;
  /** value − line, in the format's unit. */
  margin: number;
  outcome: MarginOutcome;
  /** Size of the Open break. */
  breakTeams: number;
  /** Off the Open break but broke in another category (ESL, novice…). */
  brokeElsewhere: boolean;
};

export type FormatMargins = {
  format: string;
  unit: MarginUnit;
  tournaments: number;
  cleared: number;
  onTheLine: number;
  missedOnSpeaks: number;
  missedByOne: number;
  missed: number;
  medianMargin: number;
  /** Largest margin first. */
  entries: MarginEntry[];
};

export type ExclusionReason =
  | 'no-open-break'
  | 'unknown-format'
  | 'no-team-standing'
  | 'line-incomplete'
  | 'above-line-not-on-break';

export type BreakMargin = {
  formats: FormatMargins[];
  excluded: Array<{ tournamentId: bigint; tournamentName: string; reason: ExclusionReason }>;
  excludedByReason: Partial<Record<ExclusionReason, number>>;
};

export const unitForFormat = (format: string): MarginUnit =>
  format.trim().toLowerCase() === 'british parliamentary' ? 'points' : 'wins';

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export function breakMargin(rows: CvSpeakerRow[]): BreakMargin | null {
  if (rows.length === 0) return null;

  const excluded: BreakMargin['excluded'] = [];
  const exclude = (r: CvSpeakerRow, reason: ExclusionReason) =>
    excluded.push({ tournamentId: r.tournamentId, tournamentName: r.tournamentName, reason });
  const byFormat = new Map<string, MarginEntry[]>();

  for (const r of rows) {
    const b = r.openBreak;
    if (!b) { exclude(r, 'no-open-break'); continue; }
    if (!r.format) { exclude(r, 'unknown-format'); continue; }
    const unit = unitForFormat(r.format);
    const raw = unit === 'points' ? (r.teamPoints == null ? null : Number(r.teamPoints)) : r.teamWins;
    if (!r.teamName || raw == null || !Number.isFinite(raw)) { exclude(r, 'no-team-standing'); continue; }
    const line = unit === 'points' ? b.linePoints : b.lineWins;
    if (line == null) { exclude(r, 'line-incomplete'); continue; }
    const margin = raw - line;
    if (!b.userOnBreak && margin > 0) { exclude(r, 'above-line-not-on-break'); continue; }

    const outcome: MarginOutcome = b.userOnBreak
      ? margin === 0 ? 'on-the-line' : 'cleared'
      : margin === 0 ? 'missed-on-speaks' : margin === -1 ? 'missed-by-one' : 'missed';
    const list = byFormat.get(r.format) ?? [];
    list.push({
      tournamentId: r.tournamentId,
      tournamentName: r.tournamentName,
      year: r.year,
      value: raw,
      line,
      margin,
      outcome,
      breakTeams: b.teams,
      brokeElsewhere: !b.userOnBreak && r.broke,
    });
    byFormat.set(r.format, list);
  }

  const formats: FormatMargins[] = Array.from(byFormat, ([format, entries]) => {
    const count = (o: MarginOutcome) => entries.filter((e) => e.outcome === o).length;
    return {
      format,
      unit: unitForFormat(format),
      tournaments: entries.length,
      cleared: count('cleared'),
      onTheLine: count('on-the-line'),
      missedOnSpeaks: count('missed-on-speaks'),
      missedByOne: count('missed-by-one'),
      missed: count('missed'),
      medianMargin: median(entries.map((e) => e.margin)),
      entries: [...entries].sort((a, b) => b.margin - a.margin),
    };
  }).sort((a, b) => b.tournaments - a.tournaments || a.format.localeCompare(b.format));

  const excludedByReason: BreakMargin['excludedByReason'] = {};
  for (const e of excluded) excludedByReason[e.reason] = (excludedByReason[e.reason] ?? 0) + 1;

  return { formats, excluded, excludedByReason };
}
