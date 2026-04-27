import { outroundRank } from '@/lib/calicotab/judgeStats';

export type SpeakerCvSignal = {
  eliminationReached: string | null | undefined;
  teamBreakRank: number | null | undefined;
};

export type MergedSpeakerCvSignals = {
  eliminationReached: string | null;
  teamBreakRank: number | null;
  broke: boolean;
};

export function deepestOutroundLabel(labels: Array<string | null | undefined>): string | null {
  let best: { label: string; rank: number } | null = null;
  for (const label of labels) {
    if (!label) continue;
    const rank = outroundRank({ roundLabel: label, roundNumber: null, isOutround: true });
    if (rank < 0) continue;
    if (!best || rank > best.rank) best = { label, rank };
  }
  return best?.label ?? null;
}

export function mergeSpeakerCvSignals(rows: SpeakerCvSignal[]): MergedSpeakerCvSignals {
  const eliminationReached = deepestOutroundLabel(rows.map((row) => row.eliminationReached));
  const teamBreakRank =
    rows
      .map((row) => row.teamBreakRank)
      .filter((rank): rank is number => rank != null)
      .sort((a, b) => a - b)[0] ?? null;

  return {
    eliminationReached,
    teamBreakRank,
    broke: eliminationReached != null || teamBreakRank != null,
  };
}
