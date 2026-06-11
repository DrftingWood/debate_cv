import { createHash } from 'node:crypto';

export function computeFingerprint(parts: {
  host: string;
  tournamentSlug: string | null;
  tournamentName: string | null;
  year: number | null;
}): string {
  const norm = [
    parts.host.toLowerCase(),
    (parts.tournamentSlug ?? '').toLowerCase(),
    (parts.tournamentName ?? '').toLowerCase().replace(/\s+/g, ' ').trim(),
    String(parts.year ?? ''),
  ].join('|');
  return createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

export function extractYearFromName(name: string | null): number | null {
  if (!name) return null;
  const m = name.match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

/**
 * Prefer an explicit year in the tournament name; when absent, fall back to
 * the year of the private-URL email message date. This handles tournaments
 * named like "Novice Open" where the season isn't in the title.
 */
export function inferTournamentYear(
  tournamentName: string | null,
  messageDate: Date | null,
): number | null {
  const explicit = extractYearFromName(tournamentName);
  if (explicit != null) return explicit;
  return messageDate ? messageDate.getUTCFullYear() : null;
}

/**
 * All fingerprints under which an existing Tournament row for this event
 * might be stored, most-likely first. One real tournament can be keyed
 * under different fingerprints when its year had to be INFERRED from the
 * private-URL email date rather than read from the name: a tournament
 * named "Autumn Novice" whose emails straddle a year boundary gives one
 * user year=2024 and the next year=2025, and very old rows predate year
 * inference entirely (year=null). Ingest tries each candidate in order
 * and adopts the first existing row's stored fingerprint, so a lookup
 * via any candidate still converges on one Tournament row.
 *
 * When the year is explicit in the name there is exactly one candidate —
 * "Oxford IV 2024" and "Oxford IV 2025" are genuinely different events
 * and must never merge.
 */
export function candidateFingerprints(parts: {
  host: string;
  tournamentSlug: string | null;
  tournamentName: string | null;
  explicitYear: number | null;
  inferredYear: number | null;
}): string[] {
  const fp = (year: number | null) =>
    computeFingerprint({
      host: parts.host,
      tournamentSlug: parts.tournamentSlug,
      tournamentName: parts.tournamentName,
      year,
    });
  if (parts.explicitYear != null) return [fp(parts.explicitYear)];
  const year = parts.inferredYear;
  if (year == null) return [fp(null)];
  return [fp(year), fp(null), fp(year - 1), fp(year + 1)];
}

export function normalizePersonName(name: string): string {
  return name
    .toLowerCase()
    // Treat hyphens, underscores, periods, and slashes as word separators
    // before stripping the remaining punctuation. Otherwise
    // "Abhishek-Acharya" / "abhishek_acharya" / "Abhishek.Acharya" all
    // collapse to "abhishekacharya" and stop matching the canonical
    // "abhishek acharya" form (audit follow-up to PR #93's fuzzy matcher).
    .replace(/[-_./\\]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
