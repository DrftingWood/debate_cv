import type { SpeakerTabRow } from '@/lib/calicotab/parseTabs';

/**
 * Identify the URL owner's row in a speaker tab when their name has been
 * redacted from public-facing tabs. Tabbycat lets speakers opt out of
 * having their name shown in `/tab/speaker`; the row stays in the table
 * but with a coded / anonymous label, so the regular name-based upsert
 * inside ingest silently skips it and the user's CV ends up with no
 * rank, average, or per-round scores for the tournament.
 *
 * Returns the unique unmatched row in the URL owner's team, or null when
 * the inputs aren't sufficient to make an unambiguous attribution.
 *
 * Conditions for a non-null result, ALL required:
 *   1. Registration declared both an owner name AND an owner team.
 *   2. The owner's Person ID exists in `lookupPersonId`.
 *   3. No row on the owner's team already resolves to the owner Person
 *      via `lookupPersonId` (i.e. the speaker tab doesn't list them by
 *      a recognisable spelling).
 *   4. Exactly one row on the owner's team is unresolvable by
 *      `lookupPersonId`. Two+ unresolvable rows is ambiguous (we can't
 *      tell which is the owner without more signal); zero means there's
 *      nothing to attribute.
 *
 * The fallback is intentionally narrow — attributing a teammate's stats
 * to the user is a bigger error than just leaving the row off the CV.
 */
export function findRedactedOwnerRow(
  speakerRows: SpeakerTabRow[],
  ownerName: string | null | undefined,
  ownerTeam: string | null | undefined,
  lookupPersonId: (name: string) => bigint | null,
): SpeakerTabRow | null {
  if (!ownerName || !ownerTeam) return null;
  const ownerPersonId = lookupPersonId(ownerName);
  if (ownerPersonId == null) return null;

  const teamRows = speakerRows.filter((s) => s.teamName === ownerTeam);
  if (teamRows.length === 0) return null;

  const ownerAlreadyMatched = teamRows.some(
    (s) => lookupPersonId(s.speakerName) === ownerPersonId,
  );
  if (ownerAlreadyMatched) return null;

  const unmatched = teamRows.filter((s) => lookupPersonId(s.speakerName) == null);
  return unmatched.length === 1 ? unmatched[0]! : null;
}
