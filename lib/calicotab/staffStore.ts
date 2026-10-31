import { prisma } from '@/lib/db';
import { normalizePersonName } from '@/lib/calicotab/fingerprint';
import { personNameMatches } from '@/lib/calicotab/personMatch';
import { parseStaffBlock } from '@/lib/calicotab/staffBlock';

/**
 * Stores the adjudication core named on a tab's home page (the `home` scrape
 * piece). The page is the tournament's PUBLIC landing page, already fetched
 * by the partial re-scrape, so this reads no page of its own and a private
 * URL never reaches it.
 */

export type StaffPerson = { personId: bigint; displayName: string };

/**
 * The one person in the tournament's participant list a staff name stands
 * for, or null when it is unknown or ambiguous. An exact name (after
 * normalising) wins when exactly one person has it; otherwise the same fuzzy
 * rule the judge lists use (middle names, reordered tokens) must find exactly
 * one. Two candidates mean nobody is credited: crediting the wrong
 * "Rahul Sharma" with a CA role would put it on a stranger's CV.
 */
export function linkStaffName(name: string, people: readonly StaffPerson[]): bigint | null {
  const key = normalizePersonName(name);
  const exact = people.filter((p) => normalizePersonName(p.displayName) === key);
  if (exact.length > 0) return exact.length === 1 ? exact[0].personId : null;
  const fuzzy = people.filter((p) => personNameMatches(name, p.displayName));
  const ids = new Set(fuzzy.map((p) => p.personId));
  return ids.size === 1 ? [...ids][0] : null;
}

export type HomeRead = {
  /** The home page has a Tournament Staff block. */
  found: boolean;
  /** Core names stored. */
  named: number;
  /** Of those, how many were linked to a person. */
  linked: number;
};

/**
 * Replaces the tournament's staff-block core names with those on `html`, and
 * marks each linked person who is on the judge list as core
 * (judgeTypeTag 'core'), as an Adj Core tick would. The replace is whole: a
 * name the page no longer lists goes, so a corrected page corrects the data.
 * Someone already marked core stays core; the list's tick is never undone by
 * a staff block that omits the name.
 */
export async function recordStaffFromHome(tournamentId: bigint, html: string): Promise<HomeRead> {
  const block = parseStaffBlock(html);
  const participants = await prisma.tournamentParticipant.findMany({
    where: { tournamentId },
    select: {
      personId: true,
      judgeTypeTag: true,
      person: { select: { displayName: true } },
      roles: { select: { role: true } },
    },
  });
  const people = participants.map((p) => ({
    personId: p.personId,
    displayName: p.person.displayName,
  }));
  const rows = block.core.map((name) => ({
    tournamentId,
    name,
    nameKey: normalizePersonName(name),
    role: 'core',
    source: 'staff_block',
    personId: linkStaffName(name, people),
  }));
  const judgeTags = new Map(
    participants
      .filter((p) => p.roles.some((r) => r.role === 'judge'))
      .map((p) => [p.personId, p.judgeTypeTag] as const),
  );
  const promote = rows
    .map((r) => r.personId)
    .filter((id): id is bigint => id != null && judgeTags.has(id))
    .filter((id) => judgeTags.get(id)?.toLowerCase() !== 'core');
  await prisma.$transaction([
    prisma.tournamentStaff.deleteMany({
      where: { tournamentId, role: 'core', source: 'staff_block' },
    }),
    prisma.tournamentStaff.createMany({ data: rows, skipDuplicates: true }),
    ...(promote.length > 0
      ? [
          prisma.tournamentParticipant.updateMany({
            where: { tournamentId, personId: { in: promote } },
            data: { judgeTypeTag: 'core' },
          }),
        ]
      : []),
  ]);
  return {
    found: block.found,
    named: rows.length,
    linked: rows.filter((r) => r.personId != null).length,
  };
}
