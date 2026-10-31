import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { normalizePersonNameV2 } from '@/lib/calicotab/fingerprint';
import { matchStaffName } from '@/lib/calicotab/staffMatch';
import { parseStaffBlock } from '@/lib/calicotab/staffBlock';

/**
 * Stores the adjudication core named on a tab's home page (the `home` scrape
 * piece). The page is the tournament's PUBLIC landing page, already fetched
 * by the partial re-scrape, so this reads no page of its own and a private
 * URL never reaches it.
 *
 * Nothing here touches TournamentParticipant. The CV reads a staff row at
 * display time (lib/cv/staffCore.ts), so a participants re-read cannot undo
 * it and deleting the row takes the role off the CV at once.
 */

export type HomeRead = {
  /** The home page has a Tournament Staff block. */
  found: boolean;
  /** Core names stored. */
  named: number;
  /** Of those, how many were linked to a person by an exact name. */
  linked: number;
};

/**
 * Replaces the tournament's staff-block core names with those on `html`.
 * The replace is whole: a name the page no longer lists goes, so a corrected
 * page corrects the data. Each name is matched against the tournament's
 * participant list by matchStaffName: an exact match links, a near match is
 * kept as a candidate only.
 */
export async function recordStaffFromHome(tournamentId: bigint, html: string): Promise<HomeRead> {
  const block = parseStaffBlock(html);
  const participants = await prisma.tournamentParticipant.findMany({
    where: { tournamentId },
    select: { personId: true, person: { select: { displayName: true } } },
  });
  const people = participants.map((p) => ({
    personId: p.personId,
    displayName: p.person.displayName,
  }));
  const rows = block.core.map((name) => {
    const match = matchStaffName(name, people);
    return {
      tournamentId,
      name,
      nameKey: normalizePersonNameV2(name),
      role: 'core',
      source: 'staff_block',
      personId: match.exact,
      candidatePersonId: match.candidate,
    };
  });
  await prisma.$transaction([
    prisma.tournamentStaff.deleteMany({
      where: { tournamentId, role: 'core', source: 'staff_block' },
    }),
    prisma.tournamentStaff.createMany({ data: rows, skipDuplicates: true }),
  ]);
  return {
    found: block.found,
    named: rows.length,
    linked: rows.filter((r) => r.personId != null).length,
  };
}

/**
 * Re-runs the name match for the tournament's stored staff rows against its
 * participant list as it stands now, with no fetch. A link made when the home
 * page was read can go stale: a later participants write may add a second
 * person with the same name (the link must go: it is no longer unique) or
 * the exact name that a candidate was waiting for. Each row follows the same
 * rules as at the first read; only rows whose answer changed are written.
 * Returns how many changed. Called inside the ingest write after the
 * participants are stored, so the CV never shows a role on a link that no
 * longer holds.
 */
export async function rematchStaffNames(
  db: Prisma.TransactionClient,
  tournamentId: bigint,
): Promise<number> {
  const staff = await db.tournamentStaff.findMany({
    where: { tournamentId, role: 'core' },
    select: { id: true, name: true, personId: true, candidatePersonId: true },
  });
  if (staff.length === 0) return 0;
  const participants = await db.tournamentParticipant.findMany({
    where: { tournamentId },
    select: { personId: true, person: { select: { displayName: true } } },
  });
  const people = participants.map((p) => ({
    personId: p.personId,
    displayName: p.person.displayName,
  }));
  let changed = 0;
  for (const row of staff) {
    const match = matchStaffName(row.name, people);
    if (match.exact === row.personId && match.candidate === row.candidatePersonId) continue;
    await db.tournamentStaff.update({
      where: { id: row.id },
      data: { personId: match.exact, candidatePersonId: match.candidate },
    });
    changed += 1;
  }
  return changed;
}
