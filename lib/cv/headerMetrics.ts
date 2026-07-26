/**
 * Which summary tiles the /cv account header shows.
 *
 * Pure and separately testable because the selection rules are role-
 * dependent and easy to regress: a pure speaker must never be shown
 * "Prelims chaired: 0", and a pure judge must never be shown "Breaks: 0".
 * Tiles that resolve to zero or null are dropped entirely rather than
 * rendered as a zero, and the strongest survivors fill the strip.
 */
export type HeaderMetric = {
  label: string;
  value: number | string;
  hint?: string;
  accent?: 'gold' | 'blue' | 'pos' | 'neg';
};

/**
 * Choose the 3–5 summary tiles based on the user's role mix. A pure speaker
 * shouldn't stare at "Prelims chaired: 0"; a pure judge shouldn't see
 * "Breaks: 0" front and centre. Tiles that resolve to zero/null are
 * skipped, then the strongest leftovers fill the strip.
 */
export function pickHeaderMetrics(input: {
  totalTournaments: number;
  breaks: number;
  totalRoundsChaired: number;
  outroundsChaired: number;
  /** Speeches-weighted mean across the whole record; null when unscored. */
  careerSpeakerAverage: number | null;
  /** How many scored speeches that average was computed from. */
  scoredSpeeches: number;
  speakerCount: number;
  judgeCount: number;
  activeYears: { from: number; to: number } | null;
}): HeaderMetric[] {
  const {
    totalTournaments,
    breaks,
    totalRoundsChaired,
    outroundsChaired,
    careerSpeakerAverage,
    scoredSpeeches,
    speakerCount,
    judgeCount,
  } = input;

  const speakerLeaning = judgeCount === 0 || speakerCount >= judgeCount * 3;
  const judgeLeaning = speakerCount === 0 || judgeCount >= speakerCount * 3;

  const candidates: HeaderMetric[] = [];

  if (totalTournaments > 0) {
    candidates.push({
      label: 'Tournaments',
      value: totalTournaments,
      hint:
        speakerCount > 0 && judgeCount > 0
          ? `${speakerCount} speaking · ${judgeCount} judging`
          : undefined,
    });
  }

  if (speakerLeaning) {
    if (breaks > 0) {
      candidates.push({
        label: 'Breaks',
        value: breaks,
        accent: 'gold',
        hint: totalTournaments > 0 ? `${Math.round((breaks / totalTournaments) * 100)}% of entries` : undefined,
      });
    }
    /*
     * The CAREER average, not the best tournament's.
     *
     * This strip used to carry "Best speaker avg" and "Best speaker rank",
     * both of which the Highlights grid renders again — with the tournament
     * that earned them — about 200px further down the same screen. Two
     * copies of one fact, side by side, and the copy up here was the one
     * without its attribution.
     *
     * Picking the career figure also settles a contradiction: /u and
     * /cv/stats both headline the career average, so the owner's own page
     * was the only surface reporting a different, flattering number under
     * the words "speaker avg". Peak figures still belong on this page —
     * they belong in Highlights, where the tournament name travels with
     * them.
     */
    if (careerSpeakerAverage != null) {
      candidates.push({
        label: 'Career speaker avg',
        value: careerSpeakerAverage.toFixed(1),
        hint: scoredSpeeches > 0 ? `${scoredSpeeches} scored speeches` : undefined,
      });
    }
  } else if (judgeLeaning) {
    if (totalRoundsChaired > 0) {
      candidates.push({ label: 'Prelims chaired', value: totalRoundsChaired });
    }
    if (outroundsChaired > 0) {
      candidates.push({ label: 'Outrounds chaired', value: outroundsChaired, accent: 'gold' });
    }
  } else {
    if (breaks > 0) candidates.push({ label: 'Breaks', value: breaks, accent: 'gold' });
    if (totalRoundsChaired > 0) {
      candidates.push({ label: 'Prelims chaired', value: totalRoundsChaired });
    }
    if (outroundsChaired > 0) {
      candidates.push({ label: 'Outrounds chaired', value: outroundsChaired });
    }
  }

  return candidates.slice(0, 4);
}

