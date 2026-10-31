import { prisma } from '@/lib/db';

/**
 * The names the home page's Tournament Staff block lists as adjudication
 * core, for the admin tournament page, each with how far it was matched to a
 * person in the tournament's participant list:
 *   linked    exact full-name match: this is what puts the role on the CV;
 *   possible  a looser match kept for the admin to confirm: no CV effect;
 *   none      no match, or an ambiguous one.
 * Names only: a person's display name is public tab text, and nothing here
 * carries a URL.
 */

export type StaffMatchState = 'linked' | 'possible' | 'none';
export type StaffNameRow = { name: string; state: StaffMatchState; person: string | null };

export async function getTournamentStaff(tournamentId: bigint): Promise<StaffNameRow[]> {
  const rows = await prisma.tournamentStaff.findMany({
    where: { tournamentId, role: 'core' },
    orderBy: { id: 'asc' },
    select: {
      name: true,
      person: { select: { displayName: true } },
      candidate: { select: { displayName: true } },
    },
  });
  return rows.map((r) => {
    if (r.person) return { name: r.name, state: 'linked', person: r.person.displayName };
    if (r.candidate) return { name: r.name, state: 'possible', person: r.candidate.displayName };
    return { name: r.name, state: 'none', person: null };
  });
}
