import type { Prisma, PrismaClient } from '@prisma/client';
import { getInroundsChairedCount, outroundRankStrict } from './judgeStats';

/**
 * Input shape for the judge aggregate computation. Both Tabbycat data
 * sources (landing-page Debates card via extractAdjudicatorRounds and
 * round-results panel scrape via parseRoundResults) normalize to this
 * shape before calling computeJudgeAggregates, so the aggregate semantics
 * live in one place instead of being re-implemented at each site.
 *
 * roundNumber === null indicates an outround (named stage); != null is an
 * in-round (numeric or per-tournament-classified prelim).
 */
export type JudgeRound = {
  stage: string;
  role: 'chair' | 'panellist' | 'trainee';
  roundNumber: number | null;
};

export type JudgeAggregates = {
  chairedPrelims: number;
  deepestChaired: string | null;
  deepestPaneled: string | null;
};

/**
 * Pure aggregate computation. Counts how many prelims the judge chaired
 * (via getInroundsChairedCount, which classifies each round's stage label
 * to handle non-numeric prelim labels some installs use). Finds the
 * deepest chaired outround and the deepest non-chair outround (panellist
 * or trainee — they're grouped because the Debates-card-derived "trainee"
 * role still represents a real outround appearance for CV purposes).
 *
 * Outrounds are ranked via outroundRankStrict — anything that doesn't
 * rank (unknown stage label) is dropped from the deepest-of computation.
 */
export function computeJudgeAggregates(rounds: JudgeRound[]): JudgeAggregates {
  const chairedPrelims = getInroundsChairedCount(
    rounds.map((r) => ({ stage: r.stage, panelRole: r.role })),
  );
  const outrounds = rounds.filter((r) => r.roundNumber == null);
  const ranked = outrounds
    .map((r) => ({ r, rank: outroundRankStrict(r.stage) }))
    .filter((x): x is { r: typeof x.r; rank: number } => x.rank != null)
    .sort((a, b) => b.rank - a.rank);
  return {
    chairedPrelims,
    deepestChaired: ranked.find((x) => x.r.role === 'chair')?.r.stage ?? null,
    deepestPaneled:
      ranked.find((x) => x.r.role === 'panellist' || x.r.role === 'trainee')?.r.stage ?? null,
  };
}

/**
 * Merge mode for writeJudgeParticipantRole:
 *   - 'overwrite': always set chairedPrelimRounds / lastOutroundChaired /
 *     lastOutroundPaneled to the values in `aggregates`. Used by the
 *     landing-page Debates card path (authoritative when present).
 *   - 'fillNullsOnly': read the existing row first; only set a field if
 *     the existing value is null. Used by the round-results panel path
 *     (which runs after landing and shouldn't overwrite the more
 *     authoritative landing-derived values).
 *
 * Both modes upsert the ParticipantRole 'judge' row so the participant is
 * counted as a judge regardless of which path populated the aggregates.
 */
export type JudgeWriteMode = 'overwrite' | 'fillNullsOnly';

/**
 * Type alias for the Prisma transaction client (the value passed to a
 * $transaction callback). We accept either the transaction client or the
 * top-level prisma instance — the round-results path runs OUTSIDE the
 * main transaction, so it passes the global prisma; the landing path
 * runs INSIDE its own short transaction and passes tx.
 */
type PrismaTxOrClient = Prisma.TransactionClient | PrismaClient;

export async function writeJudgeParticipantRole(
  client: PrismaTxOrClient,
  tournamentId: bigint,
  personId: bigint,
  aggregates: JudgeAggregates,
  mode: JudgeWriteMode,
): Promise<void> {
  const { chairedPrelims, deepestChaired, deepestPaneled } = aggregates;

  type UpdateShape = {
    judgeTypeTag: 'Adjudicator';
    chairedPrelimRounds?: number | null;
    lastOutroundChaired?: string | null;
    lastOutroundPaneled?: string | null;
  };

  let update: UpdateShape;
  if (mode === 'overwrite') {
    update = {
      judgeTypeTag: 'Adjudicator',
      chairedPrelimRounds: chairedPrelims || null,
      lastOutroundChaired: deepestChaired,
      lastOutroundPaneled: deepestPaneled,
    };
  } else {
    // fillNullsOnly: read existing and only set fields where existing is null.
    const existing = await client.tournamentParticipant.findUnique({
      where: { tournamentId_personId: { tournamentId, personId } },
      select: {
        chairedPrelimRounds: true,
        lastOutroundChaired: true,
        lastOutroundPaneled: true,
      },
    });
    update = { judgeTypeTag: 'Adjudicator' };
    if (chairedPrelims > 0 && (existing?.chairedPrelimRounds ?? null) == null) {
      update.chairedPrelimRounds = chairedPrelims;
    }
    if (deepestChaired && !existing?.lastOutroundChaired) {
      update.lastOutroundChaired = deepestChaired;
    }
    if (deepestPaneled && !existing?.lastOutroundPaneled) {
      update.lastOutroundPaneled = deepestPaneled;
    }
  }

  const tp = await client.tournamentParticipant.upsert({
    where: { tournamentId_personId: { tournamentId, personId } },
    update,
    create: {
      tournamentId,
      personId,
      judgeTypeTag: 'Adjudicator',
      chairedPrelimRounds: chairedPrelims || null,
      lastOutroundChaired: deepestChaired,
      lastOutroundPaneled: deepestPaneled,
    },
  });
  await client.participantRole.upsert({
    where: {
      tournamentParticipantId_role: {
        tournamentParticipantId: tp.id,
        role: 'judge',
      },
    },
    update: {},
    create: { tournamentParticipantId: tp.id, role: 'judge' },
  });
}
