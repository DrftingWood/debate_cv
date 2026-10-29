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
  return (
    name
      .toLowerCase()
      // Treat hyphens, underscores, periods, and slashes as word separators
      // before stripping the remaining punctuation. Otherwise
      // "Abhishek-Acharya" / "abhishek_acharya" / "Abhishek.Acharya" all
      // collapse to "abhishekacharya" and stop matching the canonical
      // "abhishek acharya" form (audit follow-up to PR #93's fuzzy matcher).
      .replace(/[-_./\\]+/g, ' ')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Name key v2 (identity option B, phase 1;
 * docs/superpowers/specs/2026-10-27-person-identity-option-b-design.md 3.5).
 *
 * v1 above keeps only `a-z0-9`, so it deletes every other letter instead of
 * folding it: "José" keys as "jos", "Łukasz" as "ukasz", and a name written
 * wholly in Cyrillic, Devanagari or CJK keys as the empty string, which is
 * why such a debater cannot have a Person today. v2:
 *   - folds accents by decomposing (NFKD, which also unpacks ligatures and
 *     full-width forms) and dropping every combining mark: "José" → "jose";
 *   - keeps letters and digits of every script (`\p{L}`, `\p{N}`);
 *   - keeps v1's separators: hyphen, underscore, period and slash become
 *     spaces, so "Abhishek-Acharya" still keys as "abhishek acharya";
 *   - spells out the Latin letters that carry no combining mark to drop
 *     (`UNDECOMPOSED`), so "Đức" keys as "duc" and "Łukasz" as "lukasz".
 *
 * The last rule goes beyond the spec's sketch. Measured on the 2026-10 export
 * (68,681 distinct names), 409 keys differ between v1 and v2: 44 non-Latin
 * names v1 emptied, and 365 Latin names holding đ (117), ı (57), ł (53), ø,
 * ð or æ. Without the table those stayed "đuc" and never met the "Duc" a
 * profile or a forwarded tab spells, so a Vietnamese or Turkish debater's
 * own name read as `different`.
 *
 * v1 stays the bucket key (`Person.normalizedName`) until phase 7, because
 * every ingest upserts on it; v2 is for aliases and identity matching.
 */
const UNDECOMPOSED: Readonly<Record<string, string>> = {
  đ: 'd',
  ð: 'd',
  ı: 'i',
  ł: 'l',
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  þ: 'th',
};

export function normalizePersonNameV2(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[đðıłøæœßþ]/g, (ch) => UNDECOMPOSED[ch] ?? ch)
    .replace(/[-_./\\]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
