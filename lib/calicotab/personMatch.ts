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

  // 1. Exact match — fast path, also covers single-token entries that the
  //    fuzzy predicate intentionally refuses to match.
  const exact = byNormalized.get(norm);
  if (exact != null) return exact;

  // 2/3. Delegate to the shared predicate for the substring + token-subset
  //      cascade. The predicate enforces the ≥2-token guard internally.
  const entries = index ?? buildPersonIndex(byNormalized);
  for (const entry of entries) {
    if (personNameMatches(candidateName, entry.normalizedName)) {
      return entry.personId;
    }
  }

  return null;
}

/**
 * Symmetric "are these two name strings the same person?" predicate.
 * Single source of truth for the fuzzy match that previously existed
 * inlined in `ingest.ts::recordJudgeRoundsFromRoundResults` and twice
 * in `parseNav.ts` (extractAdjudicatorRounds + extractOwnerRoleFromAdjHtml).
 * `findPersonId` calls this internally for non-exact matches.
 *
 * Cascade (in order, first hit wins):
 *   1. Exact normalized-string equality.
 *   2. Substring containment in either direction. Handles middle-name
 *      drops ("Abhishek K Acharya" vs "Abhishek Acharya") and trailing
 *      parentheticals ("Abhishek Acharya (IIT-B)" vs "Abhishek Acharya").
 *   3. Token-subset match in either direction. Catches surname-first
 *      comma reorders ("Acharya, Abhishek" vs "Abhishek Acharya").
 *
 * Both substring (#2) and token-subset (#3) require ≥2 tokens on BOTH
 * sides — a bare first name like "Abhishek" is too ambiguous to fuzzy-
 * match a full name. Exact single-token matches (#1) are still allowed
 * so historical "Plato" entries keep working.
 *
 * Returns false when either input is empty or whitespace after
 * normalization, mirroring the explicit empty-input guard the previous
 * ingest.ts inlined matcher carried.
 */
export function personNameMatches(a: string, b: string): boolean {
  const normA = normalizePersonName(a);
  const normB = normalizePersonName(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  const tokensA = normA.split(/\s+/).filter(Boolean);
  const tokensB = normB.split(/\s+/).filter(Boolean);
  if (tokensA.length < 2 || tokensB.length < 2) return false;

  if (normA.includes(normB) || normB.includes(normA)) return true;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  return (
    tokensB.every((t) => setA.has(t)) ||
    tokensA.every((t) => setB.has(t))
  );
}
