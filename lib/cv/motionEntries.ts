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
};

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
 *     to round data — they still appear, with nothing attached.
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

  const siblingCount = new Map<string, number>();
  for (const m of motions) {
    if (m.roundNumber == null) continue;
    const key = `${m.tournamentId}:${m.roundNumber}`;
    siblingCount.set(key, (siblingCount.get(key) ?? 0) + 1);
  }

  const entries: MotionEntry[] = [];
  for (const motion of motions) {
    const tid = motion.tournamentId.toString();
    const row = speakerByTournament.get(tid);
    const judgeRow = judgeByTournament.get(tid);
    if (!row && !judgeRow) continue;
    if (!row && judgeRow && !sat(judgeRow, motion)) continue;

    const score =
      row && motion.roundNumber != null
        ? (row.roundScores.find((s) => s.roundNumber === motion.roundNumber)?.score ?? null)
        : null;
    const result =
      row && motion.roundNumber != null
        ? (row.teamRoundResults.find((t) => t.roundNumber === motion.roundNumber) ?? null)
        : null;

    entries.push({
      tournamentKey: tid,
      tournamentName: (row ?? judgeRow)!.tournamentName,
      year: (row ?? judgeRow)!.year,
      motion,
      debated: score != null || result != null,
      judgedOnly: !row,
      siblings:
        motion.roundNumber == null ? 0 : (siblingCount.get(`${tid}:${motion.roundNumber}`) ?? 1) - 1,
      score,
      position: result?.position ?? null,
      // The format's "hit" (a win; in BP, 2nd or better), never a BP "win".
      won: result ? roundHit(row!.format, result) : null,
      fourTeam: result ? isFourTeam(row!.format, result.position) : false,
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

/** Did this judge sit on a panel for the round this motion was released for? */
function sat(judge: CvJudgeRow, motion: CvTaggedMotion): boolean {
  if (motion.roundNumber != null) return judge.judgedRoundNumbers.includes(motion.roundNumber);
  // Outround motions carry only a label: match the stage, within the same bracket.
  const stage = stageKey(motion.roundLabel);
  if (!stage) return false;
  const bracket = categoryKey(motion.roundLabel);
  return judge.judgedOutroundStages.some((s) => stageKey(s) === stage && categoryKey(s) === bracket);
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
