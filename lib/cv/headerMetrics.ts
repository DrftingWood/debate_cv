import { formatTopPercent } from '@/lib/cv/teamPlacement';
import { rankOfField } from '@/lib/cv/rankDisplay';

/**
 * Which summary tiles the /cv account header shows.
 *
 * Pure and separately testable because the selection rules are role-
 * dependent and easy to regress: a pure speaker must never be shown
 * "Prelims chaired: 0", and a pure judge must never be shown "Breaks: 0".
 * Tiles that resolve to zero or null are dropped entirely rather than
 * rendered as a zero, and the strongest survivors fill the strip.
 */
/**
 * Breaks split by role (owner decision, assumptions C25/C26). A speaking
 * break is a team break at a tournament the user spoke at; a judging break is
 * a judged outround or adjudicator-break-list entry at a tournament the user
 * judged. Judged outrounds are never folded into the speaking count, and each
 * side is a count of distinct tournaments.
 */
export type BreakSummary = {
  speaking: number;
  judging: number;
  /** Distinct tournaments the user spoke at: the speaking rate's denominator. */
  tournamentsSpoken: number;
  /** Distinct tournaments the user judged at: the judging rate's denominator. */
  tournamentsJudged: number;
};

type RoleRow = { tournamentId: bigint; broke: boolean };

export function summarizeBreaks(
  speakerRows: readonly RoleRow[],
  judgeRows: readonly RoleRow[],
): BreakSummary {
  const tally = (rows: readonly RoleRow[]) => {
    const all = new Set<string>();
    const broke = new Set<string>();
    for (const r of rows) {
      const id = r.tournamentId.toString();
      all.add(id);
      if (r.broke) broke.add(id);
    }
    return { all: all.size, broke: broke.size };
  };
  const s = tally(speakerRows);
  const j = tally(judgeRows);
  return {
    speaking: s.broke,
    judging: j.broke,
    tournamentsSpoken: s.all,
    tournamentsJudged: j.all,
  };
}

/** "12 speaking, 8 judging"; a side with no breaks is left out. Null when neither side broke. */
export function formatBreaks(b: Pick<BreakSummary, 'speaking' | 'judging'>): string | null {
  const parts = [
    b.speaking > 0 ? `${b.speaking} speaking` : null,
    b.judging > 0 ? `${b.judging} judging` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/**
 * Break rates, reported separately and never combined (C26): speaking breaks
 * over tournaments spoken, judging breaks over tournaments judged. Null when
 * the user has no tournaments in that role.
 */
export function breakRates(b: BreakSummary): { speaking: number | null; judging: number | null } {
  return {
    speaking: b.tournamentsSpoken > 0 ? b.speaking / b.tournamentsSpoken : null,
    judging: b.tournamentsJudged > 0 ? b.judging / b.tournamentsJudged : null,
  };
}

/**
 * "50% of 12 spoken · 25% of 8 judged": one rate per role the user has
 * tournaments in, never a combined one. A role with tournaments but no breaks
 * reads "0% of 8 judged"; a role with no tournaments is left out (no rate
 * exists). Null when neither role broke, as the tile is not shown then.
 */
export function formatBreakRates(b: BreakSummary): string | null {
  if (b.speaking + b.judging === 0) return null;
  const rates = breakRates(b);
  const parts = [
    rates.speaking != null
      ? `${Math.round(rates.speaking * 100)}% of ${b.tournamentsSpoken} spoken`
      : null,
    rates.judging != null
      ? `${Math.round(rates.judging * 100)}% of ${b.tournamentsJudged} judged`
      : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

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
  breaks: BreakSummary;
  totalRoundsChaired: number;
  outroundsChaired: number;
  /** Raw best speaker-tab rank with its field (null fields when unknown). */
  bestSpeakerRank: {
    rank: number;
    totalSpeakers: number | null;
    topPercent: number | null;
    tied?: boolean;
  } | null;
  bestSpeakerAverage: number | null;
  speakerCount: number;
  judgeCount: number;
  activeYears: { from: number; to: number } | null;
  /**
   * Furthest outround reached, as a display label ("Semifinals"). Break
   * depth is judged by the outround, never by speaker rank.
   */
  deepestBreak?: string | null;
  /** Best TEAM-tab finish (prelim team rank against teams on the tab). */
  bestTeamFinish?: {
    rank: number;
    totalTeams: number;
    topPercent: number;
    tied?: boolean;
  } | null;
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
    deepestBreak = null,
    bestTeamFinish = null,
  } = input;

  const breakValue = formatBreaks(breaks);

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

  // Both sides of the break record, with each side's own rate and how deep
  // the best run went (a team fact: the outround reached).
  const breaksTile = (value: string): HeaderMetric => {
    const hint = [
      formatBreakRates(breaks),
      breaks.speaking > 0 && deepestBreak ? `deepest team break ${deepestBreak}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return { label: 'Breaks', value, accent: 'gold', hint: hint || undefined };
  };

  if (speakerLeaning) {
    if (breakValue) {
      candidates.push(breaksTile(breakValue));
    }
    // How high the user placed is a TEAM-tab question; it outranks the
    // speaker-tab figures below, which are individual statistics and are
    // labelled as such.
    if (bestTeamFinish) {
      candidates.push({
        label: 'Best team finish',
        value: rankOfField(bestTeamFinish.rank, bestTeamFinish.totalTeams, bestTeamFinish.tied),
        hint: `top ${formatTopPercent(bestTeamFinish.topPercent)}`,
      });
    }
    if (bestSpeakerAverage != null) {
      candidates.push({ label: 'Best speaker avg', value: bestSpeakerAverage.toFixed(1) });
    }
    if (bestSpeakerRank != null) {
      candidates.push({
        label: 'Best speaker-tab rank',
        value: rankOfField(
          bestSpeakerRank.rank,
          bestSpeakerRank.totalSpeakers,
          bestSpeakerRank.tied,
        ),
        hint:
          bestSpeakerRank.topPercent != null
            ? `top ${formatTopPercent(bestSpeakerRank.topPercent)}`
            : undefined,
      });
    }
  } else if (judgeLeaning) {
    if (breakValue) candidates.push(breaksTile(breakValue));
    if (totalRoundsChaired > 0) {
      candidates.push({ label: 'Prelims chaired', value: totalRoundsChaired });
    }
    if (outroundsChaired > 0) {
      candidates.push({ label: 'Outrounds chaired', value: outroundsChaired, accent: 'gold' });
    }
  } else {
    if (breakValue) candidates.push(breaksTile(breakValue));
    if (totalRoundsChaired > 0) {
      candidates.push({ label: 'Prelims chaired', value: totalRoundsChaired });
    }
    if (outroundsChaired > 0) {
      candidates.push({ label: 'Outrounds chaired', value: outroundsChaired });
    }
  }

  return candidates.slice(0, 4);
}
