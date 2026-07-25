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
  bestSpeakerRank: number | null;
  bestSpeakerAverage: number | null;
  speakerCount: number;
  judgeCount: number;
  activeYears: { from: number; to: number } | null;
}): HeaderMetric[] {
  const {
    totalTournaments,
    breaks,
    totalRoundsChaired,
    outroundsChaired,
    bestSpeakerRank,
    bestSpeakerAverage,
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
    if (bestSpeakerAverage != null) {
      candidates.push({ label: 'Best speaker avg', value: bestSpeakerAverage.toFixed(1) });
    }
    if (bestSpeakerRank != null) {
      candidates.push({ label: 'Best speaker rank', value: `#${bestSpeakerRank}` });
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

