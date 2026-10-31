import { prisma } from '@/lib/db';

/**
 * A person's "core" role at a tournament comes from two places: the
 * participants list's Adj Core tick (TournamentParticipant.judgeTypeTag
 * 'core', written by the scrape) and a name under the home page's Tournament
 * Staff block that was linked to them by an exact full-name match
 * (TournamentStaff.personId, role 'core').
 *
 * The second is read here, at display time, and never copied onto the
 * participant row. So a participants re-read cannot lose it, deleting the
 * staff row takes the role off the CV at once, and an Adj Core tick is
 * untouched either way. A candidate match (TournamentStaff.candidatePersonId)
 * is not read: it is a guess waiting for an admin, and a guess must not put a
 * role on somebody's CV.
 */

/** The tournaments where any of these people is named core by the staff block. */
export async function loadStaffCoreTournaments(
  personIds: Iterable<bigint>,
  tournamentIds?: readonly bigint[],
): Promise<Set<bigint>> {
  const ids = [...personIds];
  if (ids.length === 0) return new Set();
  const rows = await prisma.tournamentStaff.findMany({
    where: {
      personId: { in: ids },
      role: 'core',
      ...(tournamentIds ? { tournamentId: { in: [...tournamentIds] } } : {}),
    },
    select: { tournamentId: true },
  });
  return new Set(rows.map((r) => r.tournamentId));
}

/** The judge tag a CV shows: 'core' when either source says so, else the stored tag. */
export function effectiveJudgeTag(stored: string | null, staffCore: boolean): string | null {
  // Lower-cased once here, so every later `=== 'core'` on the CV path agrees
  // however the list spelled the tag.
  if (staffCore || stored?.toLowerCase() === 'core') return 'core';
  return stored;
}
