/**
 * The round table the filterable statistics page runs on.
 *
 * A seat is a fact about a round; a partner and a pro-am label are facts
 * about a tournament; a motion type is a fact about a round's motion. To
 * filter statistics by any of them at once, every round the user debated
 * becomes one row carrying all of them, and every section recomputes from
 * whichever rows a filter leaves. Tournament-level sections (breaks, field
 * placement, seasons) get the companion `tournaments` table, which carries
 * the partner facts but no seat — nobody breaks "in OG".
 *
 * Pure and serialisable (no bigint, no Decimal) so the server can hand it to
 * the browser, where filtering runs without another round trip.
 */

import type { CvData, CvSpeakerRow, CvSpeakerRoundScore, CvTaggedMotion } from '@/lib/cv/buildCvData';
import { canonicalPosition } from '@/lib/cv/speakerStats';
import { formatAbbrev } from '@/lib/calicotab/format';
import { isFourTeam, roundHit } from '@/lib/cv/roundOutcome';
import { classifyMotion, type MotionClass } from '@/lib/motions/classify';

/**
 * A pairing is pro-am when your speaker average and your partners' differ by
 * MORE than this at the same tournament. Exactly 1.5 is peers.
 */
export const PRO_AM_GAP = 1.5;

export type ProAm = 'pro' | 'am' | 'peers';

export type RoundFact = {
  tournamentId: string;
  year: number | null;
  format: string | null;
  round: number;
  isOutround: boolean;
  /** 'BP:CG', 'AP:Gov', 'Aus:Neg', 'WSDC:Prop', '2v2:Aff' — null when no result was parsed. */
  seat: string | null;
  partners: string[];
  partnerGap: number | null;
  proAm: ProAm | null;
  motionType: MotionClass | null;
  /** Approved subject-area tag shared by every motion released for the round, or none. Optional so older fixtures still type. */
  motionTopic?: string | null;
  /**
   * The round released several motions that do not share one type and topic
   * (Asian Parliamentary's three-motion rounds). Without per-room draw data
   * the motion debated is unknown, so these rounds are clubbed into one bucket
   * rather than dropped or credited to each motion.
   */
  choiceRound?: boolean;
  /** Any motion is known for the round — the info-slide and framing flags mean nothing without one. */
  hasMotion: boolean;
  /** Every motion released for the round was context-led. Independent of whether they share a type. */
  contextLed: boolean;
  /** Every motion released for the round came with an info slide. Independent of type. */
  infoSlide: boolean;
  score: number | null;
  partnerScores: number[];
  points: number | null;
  /**
   * The format's "hit": won in a two-team room, finished 2nd or better (>= 2
   * points) in a BP room. Named `won` for the many readers; BP copy must say
   * "2nd or better", never "won" (see lib/cv/roundOutcome.ts).
   */
  won: boolean | null;
};

export type TournamentFact = {
  tournamentId: string;
  name: string;
  year: number | null;
  format: string | null;
  partners: string[];
  partnerGap: number | null;
  proAm: ProAm | null;
  broke: boolean;
  breakRank: number | null;
  deepestOutround: string | null;
  won: boolean | null;
  speakerRank: number | null;
};

export type StatsFacts = {
  rounds: RoundFact[];
  tournaments: TournamentFact[];
  /** Display name for each partner key in `partners`. Several keys may share a name. */
  partnerNames: Record<string, string>;
};

const BP_SEATS = new Set(['OG', 'OO', 'CG', 'CO']);

/**
 * Two-team side names as each format prints them. The first side is what
 * canonicalPosition calls 'Prop', the second 'Opp'.
 */
const SIDES: Record<string, [string, string]> = {
  'Asian Parliamentary': ['Gov', 'Opp'],
  Australs: ['Aff', 'Neg'],
  'World Schools': ['Prop', 'Opp'],
};

/**
 * A seat named within its format. Seats only compare inside a format — OG in
 * BP and Gov in Asian Parliamentary are different jobs — so the format is
 * part of the key. A four-seat position is BP whatever the format says,
 * because the room shape is the stronger evidence.
 */
export function seatKey(format: string | null, position: string | null): string | null {
  const raw = position?.trim();
  if (!raw) return null;
  const canonical = canonicalPosition(raw);
  if (BP_SEATS.has(canonical)) return `BP:${canonical}`;

  const prefix = formatAbbrev(format) ?? '?';
  if (canonical === 'Prop' || canonical === 'Opp') {
    // A format with its own side names prints them; any other two-team tab
    // (or an unknown format) gets one neutral pair, so "Government" and
    // "Proposition" at a Two-team Parliamentary tab are the same side.
    const sides = (format ? SIDES[format] : undefined) ?? ['Prop', 'Opp'];
    return `${prefix}:${canonical === 'Prop' ? sides[0] : sides[1]}`;
  }
  // Anything else is kept, case-folded so "Side A" and "side a" are one seat.
  const folded = raw.toLowerCase().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return `${prefix}:${folded}`;
}

/**
 * Your average against your partners' mean at one tournament. The gap is
 * returned to two decimals for display; the label is decided on the true gap.
 */
export function proAmFor(
  mine: number | null,
  partners: Array<number | null>,
): { gap: number | null; label: ProAm | null } {
  if (mine == null || partners.length === 0 || partners.some((p) => p == null)) {
    return { gap: null, label: null };
  }
  const mean = (partners as number[]).reduce((s, v) => s + v, 0) / partners.length;
  // Label from the true gap; round only what is shown. A gap of 1.504 is
  // pro, and rounding first would call it peers. The epsilon keeps a gap of
  // exactly 1.5, which floating point may store as 1.5000000001, as peers.
  const raw = mine - mean;
  const label: ProAm = raw - PRO_AM_GAP > 1e-9 ? 'pro' : -raw - PRO_AM_GAP > 1e-9 ? 'am' : 'peers';
  return { gap: Math.round(raw * 100) / 100, label };
}

function prelimScores(scores: CvSpeakerRoundScore[], prelims: number | null): Map<number, number> {
  const out = new Map<number, number>();
  for (const s of scores) {
    if (s.roundNumber <= 0 || s.positionLabel === 'average' || s.score == null) continue;
    if (prelims != null && s.roundNumber > prelims) continue;
    out.set(s.roundNumber, Number(s.score));
  }
  return out;
}

const meanOf = (m: Map<number, number>): number | null =>
  m.size === 0 ? null : [...m.values()].reduce((s, v) => s + v, 0) / m.size;

/**
 * Pairing for one tournament, from scored speeches only: the mean of each
 * person's own prelim speeches, over the rounds they actually spoke.
 *
 * Deliberately no fallback to tab totals. A total cannot become an average
 * without the number of rounds that person spoke, which the tab does not
 * state; dividing by the prelim count put a partner who sat out rounds 25
 * points below the user on a real WUDC record. Unlabelled beats wrong.
 */
function pairingFor(row: CvSpeakerRow) {
  const prelims = row.prelimRoundCount ?? null;
  const mineByRound = prelimScores(row.roundScores, prelims);
  const matesByRound = row.teammateDetails.map((t) => prelimScores(t.roundScores, prelims));
  // A squad member with no scored prelim speech (a reserve, a registered
  // swing who never spoke) is not a partner in any speech, so they don't
  // unlabel the pairing — as long as someone else on the team was scored.
  const spoke = matesByRound.filter((m) => m.size > 0);
  const compared = spoke.length > 0 ? spoke : matesByRound;
  return { ...proAmFor(meanOf(mineByRound), compared.map(meanOf)), mineByRound, matesByRound };
}

/** A round's motion type: shared by every motion released for it, or none. */
function motionFor(motions: CvTaggedMotion[]) {
  if (motions.length === 0) {
    return { motionType: null, motionTopic: null, choiceRound: false, hasMotion: false, contextLed: false, infoSlide: false };
  }
  const classified = motions.map((m) => classifyMotion(m.text, m.infoSlide));
  const type = classified[0].type;
  // The flags don't wait for a shared type: a choice round where every
  // option came with an info slide was an info-slide round whichever the
  // room picked. Only the type needs the options to agree.
  const shared = type !== 'Unclassified' && classified.every((c) => c.type === type);
  // The topic is the owner-approved tag, and only counts when every motion
  // released for the round carries the same one (a choice round whose options
  // disagree has no single topic).
  const topics = new Set(motions.map((m) => m.topic));
  const topic = topics.size === 1 ? [...topics][0] : null;
  return {
    motionType: shared ? type : null,
    motionTopic: topic ?? null,
    choiceRound: motions.length > 1 && !(shared && topic != null),
    hasMotion: true,
    contextLed: classified.every((c) => c.contextLed),
    infoSlide: classified.every((c) => c.infoSlide),
  };
}

export function buildStatsFacts(input: Pick<CvData, 'speakerRows' | 'taggedMotions'>): StatsFacts {
  const motionsByRound = new Map<string, CvTaggedMotion[]>();
  for (const m of input.taggedMotions) {
    if (m.roundNumber == null) continue;
    const key = `${m.tournamentId}:${m.roundNumber}`;
    motionsByRound.set(key, [...(motionsByRound.get(key) ?? []), m]);
  }

  const rounds: RoundFact[] = [];
  const tournaments: TournamentFact[] = [];
  const partnerNames: Record<string, string> = {};

  for (const row of input.speakerRows) {
    const tournamentId = row.tournamentId.toString();
    const pairing = pairingFor(row);
    const partners = row.teammateDetails.map((t) => t.key);
    for (const t of row.teammateDetails) partnerNames[t.key] = t.name;
    const resultByRound = new Map(row.teamRoundResults.map((r) => [r.roundNumber, r]));
    const roundNumbers = [...new Set([...pairing.mineByRound.keys(), ...resultByRound.keys()])].sort(
      (a, b) => a - b,
    );

    for (const round of roundNumbers) {
      const result = resultByRound.get(round);
      rounds.push({
        tournamentId,
        year: row.year,
        format: row.format,
        round,
        isOutround: row.prelimRoundCount != null && round > row.prelimRoundCount,
        seat: seatKey(row.format, result?.position ?? null),
        partners,
        partnerGap: pairing.gap,
        proAm: pairing.label,
        ...motionFor(motionsByRound.get(`${tournamentId}:${round}`) ?? []),
        score: pairing.mineByRound.get(round) ?? null,
        partnerScores: pairing.matesByRound
          .map((m) => m.get(round))
          .filter((s): s is number => s != null),
        points: result?.points ?? null,
        // The format's "hit": a win in a two-team room, 2nd or better in BP.
        // A BP round is never a "win" (lib/cv/roundOutcome.ts).
        won:
          result &&
          !(isFourTeam(row.format, result.position) && row.prelimRoundCount != null && round > row.prelimRoundCount)
            ? roundHit(row.format, result)
            : null,
      });
    }

    tournaments.push({
      tournamentId,
      name: row.tournamentName,
      year: row.year,
      format: row.format,
      partners,
      partnerGap: pairing.gap,
      proAm: pairing.label,
      broke: row.broke,
      breakRank: row.teamBreakRank,
      deepestOutround: row.eliminationReached,
      won: row.wonTournament,
      speakerRank: row.speakerRankOpen,
    });
  }

  return { rounds, tournaments, partnerNames };
}
