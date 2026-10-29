import { normalizePersonNameV2 } from '@/lib/calicotab/fingerprint';
import type { CvSpeakerRow } from '@/lib/cv/buildCvData';

/**
 * Pro-am marks (redesign owner decision 17, 2026-10-29). The owner's rule
 * (2026-10-27) is that the product never classifies a pairing as pro-am;
 * the user marks it, per partner per tournament, on the Record's Partners
 * tab. Marks are private: the public CV shows them only when the user turns
 * on "Show pro-am marks on my public CV" (Settings → Sharing).
 *
 * Stored on `User.proAmMarks` as "<tournamentId>|<partner name key>", the
 * key being name key v2, so a partner's name printed with different
 * capitals or accents on two tabs is still one mark per tournament.
 */

/** A user has a few dozen tournaments, so this bounds a runaway client, not a real record. */
export const MAX_PRO_AM_MARKS = 1000;

export function proAmKey(tournamentId: bigint | string, partner: string): string {
  return `${tournamentId.toString()}|${normalizePersonNameV2(partner)}`;
}

export type PartnerTournament = {
  tournamentId: string;
  tournamentName: string;
  year: number | null;
  partner: string;
  marked: boolean;
};

export type PartnerSummary = {
  /** The name as the latest tab printed it. */
  name: string;
  tournaments: number;
  proAm: number;
};

export type PartnerYear = { year: number | null; partners: PartnerSummary[] };

/**
 * The Partners tab: a year overview (who you debated with each year, how
 * often, how many of those you marked pro-am), then every pairing by
 * tournament for the marks. Rows arrive newest first (buildCvData), and the
 * output keeps that order; within a year, the most frequent partner first.
 */
export function partnerOverview(
  rows: readonly Pick<CvSpeakerRow, 'tournamentId' | 'tournamentName' | 'year' | 'teammates'>[],
  marks: ReadonlySet<string>,
): { years: PartnerYear[]; pairings: PartnerTournament[] } {
  const pairings: PartnerTournament[] = rows.flatMap((r) =>
    r.teammates
      .filter((p) => normalizePersonNameV2(p) !== '')
      .map((partner) => ({
        tournamentId: r.tournamentId.toString(),
        tournamentName: r.tournamentName,
        year: r.year,
        partner,
        marked: marks.has(proAmKey(r.tournamentId, partner)),
      })),
  );
  const byYear = new Map<number | null, Map<string, PartnerSummary>>();
  for (const p of pairings) {
    const year = byYear.get(p.year) ?? new Map<string, PartnerSummary>();
    byYear.set(p.year, year);
    const key = normalizePersonNameV2(p.partner);
    const s = year.get(key) ?? { name: p.partner, tournaments: 0, proAm: 0 };
    s.tournaments += 1;
    if (p.marked) s.proAm += 1;
    year.set(key, s);
  }
  const years = [...byYear.entries()]
    .sort(([a], [b]) => (a == null ? 1 : b == null ? -1 : b - a))
    .map(([year, partners]) => ({
      year,
      partners: [...partners.values()].sort(
        (a, b) => b.tournaments - a.tournaments || a.name.localeCompare(b.name),
      ),
    }));
  return { years, pairings };
}
