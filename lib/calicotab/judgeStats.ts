export type JudgeRoundInput = {
  roundNumber: number | null;
  roundLabel: string | null;
  isOutround: boolean;
  judgeAssignments: { personKey: string; panelRole: 'chair' | 'panel' | null }[];
};

export type JudgeStats = {
  chairedPrelimRounds: number;
  lastOutroundChaired: string | null;
  lastOutroundPaneled: string | null;
};

/**
 * Ordinal rank for an out-round stage. Higher = later. We read the round label
 * OR the round number to pick a rank; "final" / "grand" beats "semi" beats
 * "quarter" beats "octo". Plain numeric round labels for outrounds also rank
 * in numeric order so R9 > R8 > … even when we don't know the stage name.
 *
 * Returns -1 when the round isn't an outround (callers should skip it).
 */
export function outroundRank(round: { roundLabel: string | null; roundNumber: number | null; isOutround: boolean }): number {
  if (!round.isOutround) return -1;
  const label = (round.roundLabel ?? '').toLowerCase();
  // Order matters: "Semifinal" and "Quarterfinal" both contain the substring
  // "final", so the stage-specific checks must run before the plain-final
  // branch. We use substring matches (no word boundaries) because Tabbycat
  // labels concatenate like "Semifinal 2" / "Quarterfinals".
  if (/grand\s*final/.test(label)) return 100;
  if (/semi/.test(label)) return 90;
  if (/quarter/.test(label)) return 80;
  if (/octo|round of 16/.test(label)) return 70;
  if (/partial|double[- ]?octo|round of 32/.test(label)) return 60;
  if (/final/.test(label)) return 95; // plain "Final" — between grand (100) and semi (90)
  if (round.roundNumber != null) return round.roundNumber;
  return 0;
}

/**
 * Aggregate per-judge statistics across a tournament's rounds.
 *
 * Dedup rule for chairedPrelimRounds: a judge who chaired two rooms in the
 * same round still only counts once. Keyed by (personKey, roundNumber).
 *
 * Last-outround fields are written once and replaced only when we see a
 * strictly-later outround (per `outroundRank`). That way the order we iterate
 * `rounds` is irrelevant.
 */
export function aggregateJudgeStats(rounds: JudgeRoundInput[]): Map<string, JudgeStats> {
  const stats = new Map<string, JudgeStats>();
  const chairedSeen = new Set<string>(); // personKey|roundNumber
  const bestChair = new Map<string, number>(); // personKey -> outroundRank
  const bestPanel = new Map<string, number>();

  for (const round of rounds) {
    const stageRank = outroundRank(round);
    const isPrelim = !round.isOutround && round.roundNumber != null && round.roundNumber <= 5;

    for (const j of round.judgeAssignments) {
      const key = j.personKey;
      const stat =
        stats.get(key) ??
        ({ chairedPrelimRounds: 0, lastOutroundChaired: null, lastOutroundPaneled: null } satisfies JudgeStats);

      if (isPrelim && j.panelRole === 'chair') {
        const dedupKey = `${key}|${round.roundNumber}`;
        if (!chairedSeen.has(dedupKey)) {
          chairedSeen.add(dedupKey);
          stat.chairedPrelimRounds += 1;
        }
      }

      if (round.isOutround) {
        const label = round.roundLabel ?? `Round ${round.roundNumber ?? '?'}`;
        if (j.panelRole === 'chair' && stageRank > (bestChair.get(key) ?? -Infinity)) {
          bestChair.set(key, stageRank);
          stat.lastOutroundChaired = label;
        }
        if (j.panelRole === 'panel' && stageRank > (bestPanel.get(key) ?? -Infinity)) {
          bestPanel.set(key, stageRank);
          stat.lastOutroundPaneled = label;
        }
      }

      stats.set(key, stat);
    }
  }

  return stats;
}
