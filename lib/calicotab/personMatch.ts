import { normalizePersonName } from '@/lib/calicotab/fingerprint';

/**
 * Fuzzy person-name matcher. Returns a personId for a candidate name if it
 * resolves to a Person we already know about, or null if no match. Tries
 * (in order):
 *
 *  1. Exact normalized-string match — covers the 95% case ("Abhishek
 *     Acharya" → "abhishek acharya").
 *  2. Substring containment — handles names that drop a middle name
 *     ("Abhishek K Acharya" vs "Abhishek Acharya") or add a parenthetical
 *     ("Abhishek Acharya (IIT-B)" vs "Abhishek Acharya").
 *  3. Token-subset match — every token of one name is a token of the
 *     other. Covers minor reorders or one-side abbreviations
 *     ("Acharya, Abhishek" vs "Abhishek Acharya"); requires both sides
 *     to have ≥2 tokens to avoid false positives on single-name speakers.
 *
 * The same logic is used inside `recordJudgeRoundsFromRoundResults` for
 * matching judges from round-results pages. Now extracted here so the
 * speaker upsert loop in `ingest.ts` can fall back to fuzzy matching when
 * an exact lookup misses — without it, a slight name-spelling difference
 * between the user's claim and the speaker tab silently drops the row's
 * rank/avg/total fields. The most user-visible audit gap.
 */
export type PersonIndexEntry = {
  personId: bigint;
  normalizedName: string;
  tokens: string[];
};

export function buildPersonIndex(byNormalized: Map<string, bigint>): PersonIndexEntry[] {
  const out: PersonIndexEntry[] = [];
  for (const [normalizedName, personId] of byNormalized) {
    out.push({
      personId,
      normalizedName,
      tokens: normalizedName.split(/\s+/).filter(Boolean),
    });
  }
  return out;
}

export function findPersonId(
  candidateName: string,
  byNormalized: Map<string, bigint>,
  index?: PersonIndexEntry[],
): bigint | null {
  const norm = normalizePersonName(candidateName);
  if (!norm) return null;

  // 1. Exact match — fast path.
  const exact = byNormalized.get(norm);
  if (exact != null) return exact;

  const candidateTokens = norm.split(/\s+/).filter(Boolean);
  // Single-token candidates are too ambiguous for fuzzy matching ("Smith"
  // could be many people) — bail rather than risk a false positive.
  if (candidateTokens.length < 2) return null;
  const candidateSet = new Set(candidateTokens);

  const entries = index ?? buildPersonIndex(byNormalized);

  // 2. Substring containment in either direction.
  for (const entry of entries) {
    if (entry.tokens.length < 2) continue;
    if (norm.includes(entry.normalizedName) || entry.normalizedName.includes(norm)) {
      return entry.personId;
    }
  }

  // 3. Token-subset match — every wanted token in the candidate set, OR
  // every candidate token in the wanted set.
  for (const entry of entries) {
    if (entry.tokens.length < 2) continue;
    const wantedSet = new Set(entry.tokens);
    if (
      entry.tokens.every((t) => candidateSet.has(t)) ||
      candidateTokens.every((t) => wantedSet.has(t))
    ) {
      return entry.personId;
    }
  }

  return null;
}
