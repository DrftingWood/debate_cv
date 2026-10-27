import type { CvSpeakerRow, CvJudgeRow, CvTaggedMotion } from '@/lib/cv/buildCvData';
import { categoryKey, stageKey } from '@/lib/cv/roundLedger';
import { isFourTeam, roundHit } from '@/lib/cv/roundOutcome';

/**
 * One released motion, joined to whatever the user's record says about the
 * round it was debated in.
 */
export type MotionEntry = {
  /** Tournament id as a string — bigints don't survive a Map key cleanly. */
  tournamentKey: string;
  tournamentName: string;
  year: number | null;
  motion: CvTaggedMotion;
  /** True when the user has a score or a result for this round. */
  debated: boolean;
  /** The user judged this tournament rather than speaking at it. */
  judgedOnly: boolean;
  /** How many OTHER motions were released for the same round. */
  siblings: number;
  score: number | null;
  position: string | null;
  /** The format's "hit": a win in a two-team room, 2nd or better in a BP room. */
  won: boolean | null;
  /** The round was in a four-team (BP) room, where `won` means 2nd or better. */
  fourTeam: boolean;
  points: number | null;
  /**
   * A knockout motion joined to the user's team's result in that stage:
   * `won` is true when the team advanced (or, in a final, won it). Null for
   * prelim motions and for a stage the team has no recorded result in.
   * Outround speaker scores are not published, so this is the whole record.
   */
  knockout: { won: boolean; final: boolean } | null;
};

/**
 * Do two labels name the same knockout round? The stage is read by the
 * stage lexicon ("Final" = "Grand Final") and the break category must agree
 * ("ESL Semifinals" is not "Semifinals", "Novice Final" is not "Grand
 * Final") — the same keys the judge join below and the CV ledger use, since
 * the motions tab and the round-results nav spell a stage independently.
 */
export function sameKnockoutStage(a: string | null | undefined, b: string | null | undefined): boolean {
  const stage = stageKey(a);
  return stage != null && stage === stageKey(b) && categoryKey(a) === categoryKey(b);
}

const normLabel = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The user's team's result in the knockout round a label names, or null.
 *
 * Results come from two writers (the round-results pages and the private
 * URL's Debates card) that may spell one stage differently, so several rows
 * can name it. Every matching row must agree; rows that disagree give null
 * rather than a guess (the stats page drops the same stage the same way).
 */
export function knockoutResultFor(
  label: string,
  results: ReadonlyArray<{ stage: string; won: boolean }>,
): boolean | null {
  const matches = results.filter((r) => sameKnockoutStage(r.stage, label));
  if (matches.length === 0) return null;
  const won = matches[0].won;
  return matches.every((r) => r.won === won) ? won : null;
}

/** A knockout label names the tournament's last round. */
export const isFinalStage = (label: string | null | undefined) => stageKey(label) === 'final';

/**
 * Join motions to the user's rounds for the motion archive.
 *
 * Lives here rather than inside the page so it can be unit-tested: the
 * join has four rules that are each easy to get wrong, and one of them
 * (judging) was wrong in the first cut.
 *
 *  1. **Judged rounds count, and only those.** A judge sat in the room for
 *     the rounds they were on a panel for, not the whole tournament. The
 *     first version joined through speaker rows only, which dropped every
 *     motion from a tournament the user judged; the second over-corrected
 *     and listed every round of it. Now a judged-only tournament lists the
 *     prelim rounds in `judgedRoundNumbers` and the outround stages in
 *     `judgedOutroundStages` (same bracket, "Final" = "Grand Final"), and
 *     nothing else. When the rounds are not recorded it lists none rather
 *     than guess (see judgedWithoutKnownRounds). Entries carry no score or
 *     result and are marked `judgedOnly` so summary figures don't count
 *     them as debated.
 *  2. **Outround motions have no round number** and therefore never join
 *     to round data. They join instead, by stage and break category, to the
 *     user's team's outround result (`knockout`: advanced, won or
 *     eliminated) in attachKnockoutResults below; a stage the team has
 *     no result in still appears, with nothing attached.
 *  3. **A round can release several motions.** Every one of them gets the
 *     same round data and a `siblings` count, because without per-room
 *     draw data there is no way to know which was in the user's room.
 *     Crediting none would hide the round entirely.
 *  4. **A tournament on neither list isn't on the record**, so its motions
 *     are dropped.
 *
 * Output is sorted for display: tournaments newest first, then by name,
 * then in the order the tab released the motions (round order for prelims).
 */
export function buildMotionEntries(
  speakerRows: CvSpeakerRow[],
  judgeRows: CvJudgeRow[],
  motions: CvTaggedMotion[],
): MotionEntry[] {
  const speakerByTournament = new Map(speakerRows.map((r) => [r.tournamentId.toString(), r]));
  const judgeByTournament = new Map(judgeRows.map((r) => [r.tournamentId.toString(), r]));

  // A round is its number for prelims and its label for knockouts, which is
  // all an outround motion carries; AP's three-motion outrounds share one.
  const roundOf = (m: CvTaggedMotion) =>
    m.roundNumber != null ? `${m.tournamentId}:#${m.roundNumber}` : `${m.tournamentId}:${normLabel(m.roundLabel)}`;
  const siblingCount = new Map<string, number>();
  for (const m of motions) siblingCount.set(roundOf(m), (siblingCount.get(roundOf(m)) ?? 0) + 1);

  const entries: MotionEntry[] = [];
  for (const motion of motions) {
    const tid = motion.tournamentId.toString();
    const row = speakerByTournament.get(tid);
    const judgeRow = judgeByTournament.get(tid);
    const source = row ?? judgeRow;
    if (!source) continue;
    if (!row && judgeRow && !sat(judgeRow, motion)) continue;

    const score =
      row && motion.roundNumber != null
        ? (row.roundScores.find((s) => s.roundNumber === motion.roundNumber)?.score ?? null)
        : null;
    const result =
      row && motion.roundNumber != null
        ? (row.teamRoundResults.find((t) => t.roundNumber === motion.roundNumber) ?? null)
        : null;

    const isOutroundFourTeam =
      row != null &&
      result != null &&
      motion.roundNumber != null &&
      row.prelimRoundCount != null &&
      motion.roundNumber > row.prelimRoundCount &&
      isFourTeam(row.format, result.position);

    entries.push({
      tournamentKey: tid,
      tournamentName: source.tournamentName,
      year: source.year,
      motion,
      debated: score != null || result != null,
      judgedOnly: !row,
      siblings: (siblingCount.get(roundOf(motion)) ?? 1) - 1,
      score,
      position: result?.position ?? null,
      // The format's "hit" (a win; in BP, 2nd or better), never a BP "win".
      // An outround result is advancing, not a 2nd-or-better room.
      won:
        result && row && !isOutroundFourTeam ? roundHit(row.format, result) : null,
      fourTeam: result && row ? isFourTeam(row.format, result.position) : false,
      points: result?.points ?? null,
      knockout: null,
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

/**
 * Join each knockout motion the user SPOKE at to their team's result in that
 * stage (rule 2 above). A separate step so the archive join keeps its three
 * inputs; the page passes `CvData.teamOutroundResults`.
 *
 * Judged-only entries never take a result: the user was on the panel, not
 * on a team. An entry with a result counts as debated — the team was in the
 * room — but carries no score, because outround ballots are not published.
 */
export function attachKnockoutResults(
  entries: MotionEntry[],
  results: ReadonlyArray<{ tournamentId: bigint; stage: string; won: boolean }>,
): MotionEntry[] {
  const byTournament = new Map<string, Array<{ stage: string; won: boolean }>>();
  for (const r of results) {
    const key = r.tournamentId.toString();
    byTournament.set(key, [...(byTournament.get(key) ?? []), r]);
  }
  return entries.map((e) => {
    if (e.judgedOnly || e.motion.roundNumber != null) return e;
    const won = knockoutResultFor(e.motion.roundLabel, byTournament.get(e.tournamentKey) ?? []);
    if (won == null) return e;
    return { ...e, debated: true, knockout: { won, final: isFinalStage(e.motion.roundLabel) } };
  });
}

/** Did this judge sit on a panel for the round this motion was released for? */
function sat(judge: CvJudgeRow, motion: CvTaggedMotion): boolean {
  if (motion.roundNumber != null) return judge.judgedRoundNumbers.includes(motion.roundNumber);
  // Outround motions carry only a label: match the stage, within the same bracket.
  return judge.judgedOutroundStages.some((s) => sameKnockoutStage(s, motion.roundLabel));
}

/**
 * How many tournaments the user judged, did not speak at, and has released
 * motions for, but whose judged rounds are not recorded. Their motions are not
 * listed (we will not claim rounds we cannot show the user sat on), so the
 * page says how many were left out instead of hiding them silently.
 */
export function judgedWithoutKnownRounds(
  speakerRows: CvSpeakerRow[],
  judgeRows: CvJudgeRow[],
  motions: CvTaggedMotion[],
): number {
  const spoke = new Set(speakerRows.map((r) => r.tournamentId.toString()));
  const hasMotions = new Set(motions.map((m) => m.tournamentId.toString()));
  return judgeRows.filter((r) => {
    const tid = r.tournamentId.toString();
    return (
      !spoke.has(tid) &&
      hasMotions.has(tid) &&
      r.judgedRoundNumbers.length === 0 &&
      r.judgedOutroundStages.length === 0
    );
  }).length;
}
