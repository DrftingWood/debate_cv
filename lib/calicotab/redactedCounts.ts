import type { Prisma } from '@prisma/client';
import type { ParticipantsRow } from '@/lib/calicotab/parseTabs';
import { isRedactedName } from '@/lib/calicotab/names';

/**
 * How many speakers of each team are redacted, from the participants list.
 *
 * A speaker who opts out of the public tabs is still listed, as "Redacted",
 * and ingest stores no person for the row on purpose (names.ts). The
 * data-accuracy audit counts a team's speakers from the stored people, so
 * without this count a team with a redacted speaker looks a partner short.
 *
 * The participants list, not the speaker tab, because only the list keeps
 * the redacted speaker under their team: the speaker tab's redacted row has
 * no team, since that link is what the speaker opted out of
 * (tabbycatApi.mapSpeakerStandings). And the raw list, before ingest merges
 * rows by name, which folds every "Redacted" into one row.
 */
export function redactedSpeakersByTeam(rows: readonly ParticipantsRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.role !== 'speaker' || r.teamName == null || !isRedactedName(r.name)) continue;
    out.set(r.teamName, (out.get(r.teamName) ?? 0) + 1);
  }
  return out;
}

/**
 * Writes the counts onto the team-tab rows (roundNumber 0). Only when the
 * participants list was read (`counts` not null): otherwise the count is
 * unknown and whatever is stored stays. When it was read, every team-tab row
 * gets a count, zero included, so "known to have no redacted speakers"
 * differs from "never counted" (null, which is every row written before the
 * column existed).
 *
 * Raw SQL rather than the generated client, so the write does not depend on
 * a client generated after the column was added.
 */
export async function recordRedactedSpeakers(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  tournamentId: bigint,
  counts: ReadonlyMap<string, number> | null,
): Promise<void> {
  if (counts == null) return;
  await tx.$executeRaw`
    UPDATE "TeamResult" SET "redactedSpeakers" = 0
    WHERE "tournamentId" = ${tournamentId} AND "roundNumber" = 0`;
  for (const [team, n] of counts) {
    await tx.$executeRaw`
      UPDATE "TeamResult" SET "redactedSpeakers" = ${n}
      WHERE "tournamentId" = ${tournamentId} AND "roundNumber" = 0 AND "teamName" = ${team}`;
  }
}
