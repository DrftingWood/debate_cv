import type { CvJudgeRow, CvTaggedMotion } from '@/lib/cv/buildCvData';
import { formatAbbrev } from '@/lib/calicotab/format';
import { isMeasurable } from '@/lib/cv/judgingLens';

/**
 * Judging → Conditions on /cv/stats (redesign owner decision 19,
 * 2026-10-29): how judging went by format and by motion topic. The third
 * slot, by stage, is the outround-depth distribution judgingLens already
 * computes. Pure; every figure carries the tournaments or rounds behind it.
 *
 * As everywhere on the judging side, a figure the rows cannot back is left
 * out and counted rather than estimated: a tournament with no count of
 * prelims judged gives no chair rate, and a judged round with no motion
 * stored, or one whose motions disagree on a topic, has no topic.
 */

export type JudgingFormatRow = {
  /** The format's short name ("BP", "AP"); "Format not stated" when absent. */
  format: string;
  tournaments: number;
  /** Tournaments with a judging break (C25: a judged outround or the adjudicator break). */
  broke: number;
  roundsJudged: number;
  roundsChaired: number;
  /** roundsChaired / roundsJudged over tournaments that record both; null when none do. */
  chairRate: number | null;
};

type FormatInput = Pick<CvJudgeRow, 'format' | 'broke' | 'inroundsJudged' | 'inroundsChaired'>;

export function judgingByFormat(rows: readonly FormatInput[]): JudgingFormatRow[] {
  const by = new Map<string, JudgingFormatRow>();
  for (const r of rows) {
    const format = formatAbbrev(r.format) ?? 'Format not stated';
    const row = by.get(format) ?? {
      format,
      tournaments: 0,
      broke: 0,
      roundsJudged: 0,
      roundsChaired: 0,
      chairRate: null,
    };
    row.tournaments += 1;
    if (r.broke) row.broke += 1;
    // judgingLens's own rule: a judged count to divide by, and no more
    // chairs than rounds judged.
    if (isMeasurable(r)) {
      row.roundsJudged += r.inroundsJudged ?? 0;
      row.roundsChaired += r.inroundsChaired ?? 0;
    }
    by.set(format, row);
  }
  return [...by.values()]
    .map((r) => ({ ...r, chairRate: r.roundsJudged > 0 ? r.roundsChaired / r.roundsJudged : null }))
    .sort((a, b) => b.tournaments - a.tournaments || a.format.localeCompare(b.format));
}

export type JudgingTopicRow = { topic: string; rounds: number; tournaments: number };

/**
 * Prelim rounds judged, by the topic of the motion released for them. A
 * round counts under a topic only when every motion stored for it shares
 * that topic (a choice round with mixed topics has none), the same rule the
 * speaking side's facts use. Outrounds are left out: a judge row says which
 * outround stages were judged, not which numbered round.
 */
export function judgingByTopic(
  rows: readonly Pick<CvJudgeRow, 'tournamentId' | 'judgedRoundNumbers'>[],
  motions: readonly Pick<CvTaggedMotion, 'tournamentId' | 'roundNumber' | 'topic'>[],
): { topics: JudgingTopicRow[]; roundsJudged: number; withTopic: number } {
  const topicsByRound = new Map<string, Set<string | null>>();
  for (const m of motions) {
    if (m.roundNumber == null) continue;
    const key = `${m.tournamentId}:${m.roundNumber}`;
    const set = topicsByRound.get(key) ?? new Set<string | null>();
    set.add(m.topic);
    topicsByRound.set(key, set);
  }
  const by = new Map<string, { rounds: number; tournaments: Set<string> }>();
  let roundsJudged = 0;
  let withTopic = 0;
  for (const r of rows) {
    for (const n of r.judgedRoundNumbers) {
      roundsJudged += 1;
      const set = topicsByRound.get(`${r.tournamentId}:${n}`);
      if (!set || set.size !== 1) continue;
      const topic = [...set][0];
      if (!topic) continue;
      withTopic += 1;
      const t = by.get(topic) ?? { rounds: 0, tournaments: new Set<string>() };
      t.rounds += 1;
      t.tournaments.add(r.tournamentId.toString());
      by.set(topic, t);
    }
  }
  const topics = [...by.entries()]
    .map(([topic, t]) => ({ topic, rounds: t.rounds, tournaments: t.tournaments.size }))
    .sort((a, b) => b.rounds - a.rounds || a.topic.localeCompare(b.topic));
  return { topics, roundsJudged, withTopic };
}
