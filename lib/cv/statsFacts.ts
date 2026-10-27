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
import { isFinalStage, sameKnockoutStage } from '@/lib/cv/motionEntries';
import { canonicalPosition } from '@/lib/cv/speakerStats';
import { formatAbbrev } from '@/lib/calicotab/format';
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
  /**
   * The motion CLASS read from the wording by lib/motions/classify.ts
   * (Policy, Belief, Actor, ...), shared by every motion released for the
   * round. Not Motion.motionType, the moderator-approved stem tag
   * (THW/THBT/...): the field name predates that distinction.
   */
  motionType: MotionClass | null;
  /** Approved subject-area tag shared by every motion released for the round, or none. Optional so older fixtures still type. */
  motionTopic?: string | null;
  /**
   * The round released several motions that do not share one type and topic
   * (Asian Parliamentary's three-motion rounds). Without per-room draw data
   * the motion debated is unknown, so these rounds are clubbed into one bucket
   * rather than dropped or credited to each motion.
   *
   * Only a real disagreement counts: two options with different topics, or
   * different classes. An option that is merely untagged or unclassified
   * makes the round `untagged` / `unclassified` instead; calling it a choice
   * would claim the options differ when nothing says so.
   */
  choiceRound?: boolean;
  /** Some motion released for the round has no approved topic. */
  untagged?: boolean;
  /** Some motion released for the round has a wording the classifier cannot place. */
  unclassified?: boolean;
  /** Any motion is known for the round — the info-slide and framing flags mean nothing without one. */
  hasMotion: boolean;
  /** Every motion released for the round was context-led. Independent of whether they share a type. */
  contextLed: boolean;
  /** Every motion released for the round came with an info slide. Independent of type. */
  infoSlide: boolean;
  score: number | null;
  partnerScores: number[];
  points: number | null;
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

/**
 * One knockout round the user's team debated, with the result and the
 * motion's topic and class. Outround speaker scores are not published, so a
 * knockout carries a result and never a score; it is kept apart from
 * `rounds` so no score-based section counts it.
 */
export type KnockoutFact = {
  tournamentId: string;
  /** The stage as the result was stored ("Semifinals", "ESL Grand Final"). */
  stage: string;
  /** Advanced, or won the final. */
  won: boolean;
  final: boolean;
  motionType: MotionClass | null;
  motionTopic: string | null;
  choiceRound: boolean;
  untagged: boolean;
  unclassified: boolean;
  hasMotion: boolean;
};

export type StatsFacts = {
  rounds: RoundFact[];
  /** Knockout rounds with a result. Optional so older fixtures still type. */
  knockouts?: KnockoutFact[];
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

/**
 * A round's motion facts: the class and topic shared by every motion
 * released for it, or none.
 *
 * Untagged is not the same as different. A round whose options agree on
 * every topic they carry, with one option untagged, has an unknown topic
 * (the room may have debated the untagged one), so its topic stays null and
 * the round is flagged `untagged` for the coverage line rather than filed
 * under "Choice of motions", which is for options known to differ.
 */
function motionFor(motions: CvTaggedMotion[]) {
  if (motions.length === 0) {
    return {
      motionType: null,
      motionTopic: null,
      choiceRound: false,
      untagged: false,
      unclassified: false,
      hasMotion: false,
      contextLed: false,
      infoSlide: false,
    };
  }
  const classified = motions.map((m) => classifyMotion(m.text, m.infoSlide));
  const unclassified = classified.some((c) => c.type === 'Unclassified');
  const untagged = motions.some((m) => m.topic == null);
  const classes = new Set(classified.map((c) => c.type).filter((t) => t !== 'Unclassified'));
  const topics = new Set(motions.map((m) => m.topic).filter((t): t is string => t != null));
  // The flags don't wait for a shared type: a choice round where every
  // option came with an info slide was an info-slide round whichever the
  // room picked. Only the class and topic need the options to agree.
  return {
    motionType: !unclassified && classes.size === 1 ? [...classes][0] : null,
    motionTopic: !untagged && topics.size === 1 ? [...topics][0] : null,
    choiceRound: motions.length > 1 && (classes.size > 1 || topics.size > 1),
    untagged,
    unclassified,
    hasMotion: true,
    contextLed: classified.every((c) => c.contextLed),
    infoSlide: classified.every((c) => c.infoSlide),
  };
}

/**
 * The knockout rounds of one tournament the user's team has a result in,
 * each with the motions released for that stage.
 *
 * Results are grouped by stage first, because the round-results pages and
 * the private URL's Debates card each write one and may spell the stage
 * differently ("Final" / "Grand Final"); a group whose rows disagree on the
 * result is dropped rather than settled by a guess. A stage whose motions sit under more
 * than one label ("Semifinals" and "Open Semifinals") takes none, as on the
 * CV ledger, rather than pick one.
 */
function knockoutsFor(
  tournamentId: string,
  results: Array<{ stage: string; won: boolean }>,
  unnumbered: CvTaggedMotion[],
): KnockoutFact[] {
  const out: KnockoutFact[] = [];
  const seen: string[] = [];
  for (const r of results) {
    if (seen.some((s) => sameKnockoutStage(s, r.stage))) continue;
    seen.push(r.stage);
    const group = results.filter((x) => sameKnockoutStage(x.stage, r.stage));
    if (!group.every((x) => x.won === r.won)) continue;
    const won = r.won;
    const motions = unnumbered.filter((m) => sameKnockoutStage(m.roundLabel, r.stage));
    const labels = new Set(motions.map((m) => m.roundLabel.trim().toLowerCase()));
    const { motionType, motionTopic, choiceRound, untagged, unclassified, hasMotion } = motionFor(
      labels.size > 1 ? [] : motions,
    );
    out.push({
      tournamentId,
      stage: r.stage,
      won,
      final: isFinalStage(r.stage),
      motionType,
      motionTopic,
      choiceRound,
      untagged,
      unclassified,
      hasMotion,
    });
  }
  return out;
}

type FactsInput = Pick<CvData, 'speakerRows' | 'taggedMotions'> &
  Partial<Pick<CvData, 'teamOutroundResults'>>;

/** Motions by prelim round and, for knockouts, by tournament; team results by tournament. */
function indexInput(input: FactsInput) {
  const motionsByRound = new Map<string, CvTaggedMotion[]>();
  const unnumberedByTournament = new Map<string, CvTaggedMotion[]>();
  for (const m of input.taggedMotions) {
    const tid = m.tournamentId.toString();
    if (m.roundNumber == null) {
      unnumberedByTournament.set(tid, [...(unnumberedByTournament.get(tid) ?? []), m]);
      continue;
    }
    const key = `${tid}:${m.roundNumber}`;
    motionsByRound.set(key, [...(motionsByRound.get(key) ?? []), m]);
  }
  const resultsByTournament = new Map<string, Array<{ stage: string; won: boolean }>>();
  for (const r of input.teamOutroundResults ?? []) {
    const tid = r.tournamentId.toString();
    resultsByTournament.set(tid, [...(resultsByTournament.get(tid) ?? []), r]);
  }
  return { motionsByRound, unnumberedByTournament, resultsByTournament };
}

export function buildStatsFacts(input: FactsInput): StatsFacts {
  const { motionsByRound, unnumberedByTournament, resultsByTournament } = indexInput(input);

  const rounds: RoundFact[] = [];
  const knockouts: KnockoutFact[] = [];
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
        won: result?.won ?? null,
      });
    }

    knockouts.push(
      ...knockoutsFor(
        tournamentId,
        resultsByTournament.get(tournamentId) ?? [],
        unnumberedByTournament.get(tournamentId) ?? [],
      ),
    );

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

  return { rounds, knockouts, tournaments, partnerNames };
}
