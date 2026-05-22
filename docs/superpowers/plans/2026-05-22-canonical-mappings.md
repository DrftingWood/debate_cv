# Canonical Mappings Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate inlined logic duplicates in `lib/calicotab/` and `lib/cv/` into single canonical helpers, behavior-preserving, with tests pinning the contract before any deletion.

**Architecture:** Single branch, seven commits (commit 7 conditional). Commit 1 adds canonical helpers as pure additions and tests them. Commits 2–6 each replace one inlined site with a call to the canonical. Each commit independently verifiable; `npm test`, `npm run lint`, `npm run typecheck` must all be green after every commit. No schema changes, no `PARSER_VERSION` bump.

**Tech Stack:** TypeScript 5.7 strict, Vitest 2 (Node env), Prisma 6, npm canonical (not pnpm). Path alias `@/*` → repo root. Tests live flat at `tests/*.test.ts`.

**Spec:** `docs/superpowers/specs/2026-05-22-canonical-mappings-design.md`

---

## Pre-flight: branch setup

- [ ] **Step 1: Create feature branch**

```bash
git checkout main
git pull --ff-only
git checkout -b refactor/canonical-mappings
git status
```

Expected: clean working tree on `refactor/canonical-mappings`.

- [ ] **Step 2: Confirm baseline is green**

```bash
npm test
npm run lint
npm run typecheck
```

Expected: all three commands exit 0. If any fail on main, stop and flag — this plan assumes a green baseline.

---

## Task 1: Add canonical helpers + behavior-preservation tests

**Files:**
- Modify: `lib/calicotab/personMatch.ts` (add `personNameMatches`; refactor `findPersonId` internals — same external behavior)
- Modify: `lib/calicotab/judgeStats.ts` (add `outroundRankStrict`)
- Create: `lib/calicotab/prelimRoundCount.ts`
- Create: `lib/cv/roleClassification.ts`
- Create: `tests/calicotab.personNameMatches.test.ts`
- Create: `tests/calicotab.outroundRank.unification.test.ts`
- Create: `tests/calicotab.pickPrelimRoundCount.test.ts`
- Create: `tests/cv.isJudgeParticipant.test.ts`

This commit only **adds** code. No inlined copy is deleted yet. Net behavior change at runtime: zero (no call site changes). The point is to land the canonical helpers and prove their contract before any swap.

- [ ] **Step 1: Write `personNameMatches` failing test**

Create `tests/calicotab.personNameMatches.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { personNameMatches } from '@/lib/calicotab/personMatch';

describe('personNameMatches', () => {
  it('returns true for exact normalized match', () => {
    expect(personNameMatches('Abhishek Acharya', 'abhishek acharya')).toBe(true);
    expect(personNameMatches('  ABHISHEK   ACHARYA  ', 'Abhishek Acharya')).toBe(true);
  });

  it('returns true for substring containment in either direction', () => {
    // Middle name dropped on one side: "Abhishek K Acharya" vs "Abhishek Acharya"
    expect(personNameMatches('Abhishek K Acharya', 'Abhishek Acharya')).toBe(true);
    expect(personNameMatches('Abhishek Acharya', 'Abhishek K Acharya')).toBe(true);
  });

  it('returns true when speaker tab adds a parenthetical', () => {
    expect(personNameMatches('Abhishek Acharya (IIT-B)', 'Abhishek Acharya')).toBe(true);
  });

  it('returns true for surname-first comma reorder via token-subset', () => {
    expect(personNameMatches('Acharya, Abhishek', 'Abhishek Acharya')).toBe(true);
  });

  it('returns false on empty either side', () => {
    expect(personNameMatches('', 'Abhishek Acharya')).toBe(false);
    expect(personNameMatches('Abhishek Acharya', '')).toBe(false);
    expect(personNameMatches('', '')).toBe(false);
    expect(personNameMatches('   ', 'Abhishek Acharya')).toBe(false);
    expect(personNameMatches('Abhishek Acharya', '   ')).toBe(false);
  });

  it('refuses single-token fuzzy match against multi-token side', () => {
    // "Abhishek" alone is too ambiguous to fuzzy-match "Abhishek Acharya".
    expect(personNameMatches('Abhishek', 'Abhishek Acharya')).toBe(false);
    expect(personNameMatches('Abhishek Acharya', 'Abhishek')).toBe(false);
  });

  it('exact-matches single-token names on both sides', () => {
    expect(personNameMatches('Plato', 'plato')).toBe(true);
    expect(personNameMatches('plato', 'PLATO')).toBe(true);
  });

  it('refuses to collapse two multi-token people sharing one token', () => {
    expect(personNameMatches('Shaurya Acharya', 'Abhishek Acharya')).toBe(false);
    expect(personNameMatches('Shaurya Acharya', 'Shaurya Chandravanshi')).toBe(false);
  });

  it('is symmetric', () => {
    expect(personNameMatches('A B', 'B A')).toBe(personNameMatches('B A', 'A B'));
    expect(personNameMatches('Abhishek K Acharya', 'Abhishek Acharya'))
      .toBe(personNameMatches('Abhishek Acharya', 'Abhishek K Acharya'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/calicotab.personNameMatches.test.ts
```

Expected: FAIL with "Failed to resolve import 'personNameMatches' from `@/lib/calicotab/personMatch`" or "personNameMatches is not exported".

- [ ] **Step 3: Implement `personNameMatches` in `lib/calicotab/personMatch.ts`**

Add this export to `lib/calicotab/personMatch.ts`, alongside the existing exports:

```typescript
/**
 * Symmetric "are these two name strings the same person?" predicate.
 * Single source of truth for the fuzzy match that previously existed
 * inlined in `ingest.ts::recordJudgeRoundsFromRoundResults` and twice
 * in `parseNav.ts` (extractAdjudicatorRounds + extractOwnerRoleFromAdjHtml).
 * `findPersonId` now calls this internally.
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
```

- [ ] **Step 4: Refactor `findPersonId` to call `personNameMatches` internally**

Replace the body of `findPersonId` in `lib/calicotab/personMatch.ts` with the version below. Same external signature, same return values, internals now delegate to the predicate.

```typescript
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
```

- [ ] **Step 5: Run personNameMatches + existing personMatch tests**

```bash
npm test -- tests/calicotab.personNameMatches.test.ts tests/calicotab.personMatch.test.ts
```

Expected: both files PASS. The existing `findPersonId` tests must still pass — that's the integration check that the refactor preserved behavior.

- [ ] **Step 6: Write `outroundRankStrict` failing test**

Create `tests/calicotab.outroundRank.unification.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { outroundRank, outroundRankStrict } from '@/lib/calicotab/judgeStats';

// These tests pin the unification of the previous INGEST_STAGE_RANK
// (50-110 scale) and outroundRank (50-100 scale) onto a single scale
// (50-100). Ordering must be preserved; specific values are load-bearing
// for the champion-check rewrite in buildCvData.ts.

describe('outroundRankStrict — canonical "label → rank or null" helper', () => {
  test('returns null for missing or non-outround labels', () => {
    expect(outroundRankStrict(null)).toBeNull();
    expect(outroundRankStrict(undefined)).toBeNull();
    expect(outroundRankStrict('')).toBeNull();
    expect(outroundRankStrict('Round 4')).toBeNull();
    expect(outroundRankStrict('1')).toBeNull();
  });

  test('canonical stage values (champion-check anchors)', () => {
    expect(outroundRankStrict('Grand Final')).toBe(100);
    expect(outroundRankStrict('Final')).toBe(95);
    expect(outroundRankStrict('Semifinal')).toBe(90);
    expect(outroundRankStrict('Quarterfinal')).toBe(80);
    expect(outroundRankStrict('Octofinal')).toBe(70);
    expect(outroundRankStrict('Double Octofinals')).toBe(60);
    expect(outroundRankStrict('Triple Octofinals')).toBe(50);
  });

  test('category-prefixed Final equals plain Final under the unified scale', () => {
    // Previously INGEST_STAGE_RANK gave Grand Final a 110-vs-100 gap to
    // distinguish "Open Final" from a tournament's actual GF. classifyOutroundStage
    // already buckets them correctly into final vs grand_final, so the
    // headroom gap isn't load-bearing.
    expect(outroundRankStrict('Novice Final')).toBe(95);
    expect(outroundRankStrict('ESL Final')).toBe(95);
    expect(outroundRankStrict('Open Final')).toBe(95);
    expect(outroundRankStrict('Open Grand Final')).toBe(100);
    // Stage-specific patterns still beat the bare-final fallthrough.
    expect(outroundRankStrict('Novice Quarterfinals')).toBe(80);
    expect(outroundRankStrict('ESL Semifinals')).toBe(90);
  });

  test('agrees with outroundRank when label classifies', () => {
    // Sanity check: the strict variant returns the same value as the
    // structured outroundRank for any classifiable label.
    const labels = ['Grand Final', 'Final', 'Semifinal', 'Quarterfinal', 'Octofinal'];
    for (const label of labels) {
      const strict = outroundRankStrict(label);
      const structured = outroundRank({ roundLabel: label, roundNumber: null, isOutround: true });
      expect(strict).toBe(structured);
    }
  });
});

describe('outroundRank — champion-check semantics (load-bearing for buildCvData.ts:507 rewrite)', () => {
  const finalRank = outroundRank({ roundLabel: 'Final', roundNumber: null, isOutround: true });

  test('a participant whose deepest outround is "Final" is at the champion threshold', () => {
    const deepest = outroundRank({ roundLabel: 'Final', roundNumber: null, isOutround: true });
    expect(deepest >= finalRank).toBe(true);
  });

  test('a participant whose deepest outround is "Grand Final" is also at the champion threshold', () => {
    const deepest = outroundRank({ roundLabel: 'Grand Final', roundNumber: null, isOutround: true });
    expect(deepest >= finalRank).toBe(true);
  });

  test('a participant whose deepest outround is "Semifinal" is NOT at the champion threshold', () => {
    const deepest = outroundRank({ roundLabel: 'Semifinal', roundNumber: null, isOutround: true });
    expect(deepest >= finalRank).toBe(false);
  });

  test('category-prefixed Final is also at the threshold', () => {
    const deepest = outroundRank({ roundLabel: 'ESL Final', roundNumber: null, isOutround: true });
    expect(deepest >= finalRank).toBe(true);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

```bash
npm test -- tests/calicotab.outroundRank.unification.test.ts
```

Expected: FAIL — `outroundRankStrict` is not exported from `@/lib/calicotab/judgeStats`.

- [ ] **Step 8: Implement `outroundRankStrict` in `lib/calicotab/judgeStats.ts`**

Add this export to `lib/calicotab/judgeStats.ts`, just below the `JUDGE_STATS_RANK` constant (around line 154):

```typescript
/**
 * Strict variant of {@link outroundRank} for callers that only have a
 * stage label (no structured roundNumber/isOutround context) and want
 * `null` returned when the label doesn't classify as a canonical outround.
 *
 * Used by ingest.ts's "deepest reached" computation, replacing the
 * previously-duplicated `INGEST_STAGE_RANK` table. Both helpers now share
 * the canonical 50-100 scale defined in `JUDGE_STATS_RANK`.
 */
export function outroundRankStrict(label: string | null | undefined): number | null {
  const stage = classifyOutroundStage(label);
  return stage ? JUDGE_STATS_RANK[stage] : null;
}
```

- [ ] **Step 9: Run tests to verify they pass**

```bash
npm test -- tests/calicotab.outroundRank.unification.test.ts tests/judgeStats.test.ts
```

Expected: both files PASS. The existing `judgeStats.test.ts` `outroundRank` ordering tests must still pass — that's the integration check.

- [ ] **Step 10: Write `pickPrelimRoundCount` failing test**

Create `tests/calicotab.pickPrelimRoundCount.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { pickPrelimRoundCount } from '@/lib/calicotab/prelimRoundCount';

describe('pickPrelimRoundCount', () => {
  test('returns stored when positive', () => {
    expect(pickPrelimRoundCount({ stored: 5, maxTeamRoundNumber: 4 })).toBe(5);
    expect(pickPrelimRoundCount({ stored: 8, maxTeamRoundNumber: null })).toBe(8);
    expect(pickPrelimRoundCount({ stored: 8, maxTeamRoundNumber: 0 })).toBe(8);
  });

  test('falls back to maxTeamRoundNumber when stored is null', () => {
    expect(pickPrelimRoundCount({ stored: null, maxTeamRoundNumber: 5 })).toBe(5);
  });

  test('falls back to maxTeamRoundNumber when stored is zero', () => {
    // The current buildCvData.ts:236 guard is `> 0` — zero stored is
    // treated the same as missing.
    expect(pickPrelimRoundCount({ stored: 0, maxTeamRoundNumber: 4 })).toBe(4);
  });

  test('returns null when both are missing or non-positive', () => {
    expect(pickPrelimRoundCount({ stored: null, maxTeamRoundNumber: null })).toBeNull();
    expect(pickPrelimRoundCount({ stored: 0, maxTeamRoundNumber: 0 })).toBeNull();
    expect(pickPrelimRoundCount({ stored: 0, maxTeamRoundNumber: null })).toBeNull();
    expect(pickPrelimRoundCount({ stored: null, maxTeamRoundNumber: 0 })).toBeNull();
  });

  test('negative values are treated as missing', () => {
    // Defensive: schema is Int? so the DB shouldn't produce these,
    // but the helper is pure and shouldn't assume.
    expect(pickPrelimRoundCount({ stored: -1, maxTeamRoundNumber: 5 })).toBe(5);
    expect(pickPrelimRoundCount({ stored: 3, maxTeamRoundNumber: -1 })).toBe(3);
  });
});
```

- [ ] **Step 11: Run test to verify it fails**

```bash
npm test -- tests/calicotab.pickPrelimRoundCount.test.ts
```

Expected: FAIL — file `@/lib/calicotab/prelimRoundCount` does not exist.

- [ ] **Step 12: Create `lib/calicotab/prelimRoundCount.ts`**

```typescript
/**
 * Resolve the prelim-round count for a tournament from the two known
 * sources, applied in priority order:
 *
 *   1. `Tournament.prelimRoundCount` — set at ingest time from the
 *      authoritative landing-nav round list. Most reliable.
 *   2. `MAX(TeamResult.roundNumber)` for prelim rounds — fallback for
 *      tournaments ingested before #1 was added to the schema.
 *
 * The rule is "first positive wins". Zero, null, and negative are all
 * treated as "missing", matching the `> 0` guard the buildCvData.ts
 * read path carried before extraction.
 *
 * Pure function — no DB access. The caller is responsible for sourcing
 * both inputs.
 */
export function pickPrelimRoundCount(args: {
  stored: number | null;
  maxTeamRoundNumber: number | null;
}): number | null {
  if (args.stored != null && args.stored > 0) return args.stored;
  if (args.maxTeamRoundNumber != null && args.maxTeamRoundNumber > 0) {
    return args.maxTeamRoundNumber;
  }
  return null;
}
```

- [ ] **Step 13: Run test to verify it passes**

```bash
npm test -- tests/calicotab.pickPrelimRoundCount.test.ts
```

Expected: PASS.

- [ ] **Step 14: Write `isJudgeParticipant` failing test**

Create `tests/cv.isJudgeParticipant.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { isJudgeParticipant } from '@/lib/cv/roleClassification';

const empty = {
  roles: [] as ReadonlyArray<{ role: string }>,
  judgeTypeTag: null as string | null,
  chairedPrelimRounds: null as number | null,
  lastOutroundChaired: null as string | null,
  lastOutroundPaneled: null as string | null,
};

describe('isJudgeParticipant', () => {
  test('false when all signals are null/empty', () => {
    expect(isJudgeParticipant(empty)).toBe(false);
  });

  test("true when roles contains 'judge'", () => {
    expect(isJudgeParticipant({ ...empty, roles: [{ role: 'judge' }] })).toBe(true);
  });

  test('true when judgeTypeTag is set', () => {
    expect(isJudgeParticipant({ ...empty, judgeTypeTag: 'adj-core' })).toBe(true);
    expect(isJudgeParticipant({ ...empty, judgeTypeTag: 'CA' })).toBe(true);
  });

  test('true when chairedPrelimRounds > 0', () => {
    expect(isJudgeParticipant({ ...empty, chairedPrelimRounds: 3 })).toBe(true);
    expect(isJudgeParticipant({ ...empty, chairedPrelimRounds: 1 })).toBe(true);
  });

  test('false when chairedPrelimRounds is exactly 0 (guards against parsed-as-zero)', () => {
    expect(isJudgeParticipant({ ...empty, chairedPrelimRounds: 0 })).toBe(false);
  });

  test('true when lastOutroundChaired is set', () => {
    expect(isJudgeParticipant({ ...empty, lastOutroundChaired: 'Quarterfinals' })).toBe(true);
  });

  test('true when lastOutroundPaneled is set', () => {
    expect(isJudgeParticipant({ ...empty, lastOutroundPaneled: 'Semifinals' })).toBe(true);
  });

  test('roles array containing only non-judge roles does not count', () => {
    expect(isJudgeParticipant({ ...empty, roles: [{ role: 'speaker' }] })).toBe(false);
    expect(isJudgeParticipant({ ...empty, roles: [{ role: 'speaker' }, { role: 'adj-core' }] })).toBe(false);
  });

  test('judge role mixed with other roles still counts', () => {
    expect(
      isJudgeParticipant({ ...empty, roles: [{ role: 'speaker' }, { role: 'judge' }] }),
    ).toBe(true);
  });
});
```

- [ ] **Step 15: Run test to verify it fails**

```bash
npm test -- tests/cv.isJudgeParticipant.test.ts
```

Expected: FAIL — file `@/lib/cv/roleClassification` does not exist.

- [ ] **Step 16: Create `lib/cv/roleClassification.ts`**

```typescript
/**
 * Decide whether a `TournamentParticipant` row represents the user
 * playing the judge role in that tournament. Mirrors the 5-signal OR
 * that previously sat inlined in `buildCvData.ts`.
 *
 * The signals are OR'd because the `ParticipantRole` table is incomplete
 * by design today: only `classifyParticipantRole` (the participants-tab
 * parser) populates a 'judge' role row, while the landing-derived judge
 * writers in ingest.ts populate `judgeTypeTag` / `chairedPrelimRounds` /
 * `lastOutroundChaired` / `lastOutroundPaneled` without upserting a
 * roles row. Until the ingest decomposition sub-project makes `roles`
 * authoritative (and a backfill SQL fills in historical rows), the OR is
 * the load-bearing classifier — we just want it to live in one place.
 */
export function isJudgeParticipant(p: {
  roles: ReadonlyArray<{ role: string }>;
  judgeTypeTag: string | null;
  chairedPrelimRounds: number | null;
  lastOutroundChaired: string | null;
  lastOutroundPaneled: string | null;
}): boolean {
  return (
    p.roles.some((r) => r.role === 'judge') ||
    !!p.judgeTypeTag ||
    (p.chairedPrelimRounds ?? 0) > 0 ||
    !!p.lastOutroundChaired ||
    !!p.lastOutroundPaneled
  );
}
```

- [ ] **Step 17: Run test to verify it passes**

```bash
npm test -- tests/cv.isJudgeParticipant.test.ts
```

Expected: PASS.

- [ ] **Step 18: Run the full test suite + lint + typecheck**

```bash
npm test
npm run lint
npm run typecheck
```

Expected: all three green. New helpers are pure additions; no call site has changed.

- [ ] **Step 19: Commit**

```bash
git add tests/calicotab.personNameMatches.test.ts tests/calicotab.outroundRank.unification.test.ts tests/calicotab.pickPrelimRoundCount.test.ts tests/cv.isJudgeParticipant.test.ts lib/calicotab/personMatch.ts lib/calicotab/judgeStats.ts lib/calicotab/prelimRoundCount.ts lib/cv/roleClassification.ts
git commit -m "$(cat <<'EOF'
refactor: add canonical helpers with behavior-preservation tests

Adds personNameMatches, outroundRankStrict, pickPrelimRoundCount, and
isJudgeParticipant as pure additions. Tests pin the contract these helpers
must hold before the inlined copies are swapped over in subsequent commits.
findPersonId now delegates to personNameMatches internally; existing
personMatch tests are the integration check that behavior is preserved.

No call site changes outside personMatch.ts; runtime behavior unchanged.
EOF
)"
```

---

## Task 2: Co-locate `normalizeStageLabel` with `classifyRoundLabel` in `judgeStats.ts`

**Files:**
- Modify: `lib/calicotab/parseNav.ts:309-324` (remove function body, replace with re-export)
- Modify: `lib/calicotab/judgeStats.ts` (add `normalizeStageLabel` near top)
- Modify: `tests/judgeStats.classify.test.ts` (extend with `normalizeStageLabel` cases)

Pure code move. The round-label pipeline (normalize → classify → stage) lives in one file after this.

- [ ] **Step 1: Add `normalizeStageLabel` tests to `tests/judgeStats.classify.test.ts`**

Add this `describe` block at the bottom of `tests/judgeStats.classify.test.ts` (before the final closing of the file):

```typescript
import { normalizeStageLabel } from '@/lib/calicotab/judgeStats';

describe('normalizeStageLabel', () => {
  test('"R\\d+" → "Round N" canonical form', () => {
    expect(normalizeStageLabel('R1')).toBe('Round 1');
    expect(normalizeStageLabel('R12')).toBe('Round 12');
    expect(normalizeStageLabel('r5')).toBe('Round 5');
  });

  test('abbreviation → canonical name', () => {
    expect(normalizeStageLabel('GF')).toBe('Grand Final');
    expect(normalizeStageLabel('SF')).toBe('Semifinals');
    expect(normalizeStageLabel('QF')).toBe('Quarterfinals');
    expect(normalizeStageLabel('DOF')).toBe('Double Octofinals');
    expect(normalizeStageLabel('TOF')).toBe('Triple Octofinals');
    expect(normalizeStageLabel('OF')).toBe('Octofinals');
    expect(normalizeStageLabel('F')).toBe('Final');
  });

  test('lowercase colloquial → canonical name', () => {
    expect(normalizeStageLabel('semis')).toBe('Semifinals');
    expect(normalizeStageLabel('quarters')).toBe('Quarterfinals');
    expect(normalizeStageLabel('doubles')).toBe('Double Octofinals');
    expect(normalizeStageLabel('triples')).toBe('Triple Octofinals');
    expect(normalizeStageLabel('octos')).toBe('Octofinals');
  });

  test('canonical form passes through unchanged', () => {
    expect(normalizeStageLabel('Grand Final')).toBe('Grand Final');
    expect(normalizeStageLabel('Round 5')).toBe('Round 5');
    expect(normalizeStageLabel('Semifinals')).toBe('Semifinals');
  });

  test('empty/whitespace returns empty/whitespace unchanged after trim', () => {
    expect(normalizeStageLabel('')).toBe('');
    expect(normalizeStageLabel('   ')).toBe('');
  });

  test('order: longer prefixes win — "DOF" does not match "F"', () => {
    expect(normalizeStageLabel('DOF')).toBe('Double Octofinals');
    expect(normalizeStageLabel('TOF')).toBe('Triple Octofinals');
    expect(normalizeStageLabel('OF')).toBe('Octofinals');
    // "F" alone is the bare-final case.
    expect(normalizeStageLabel('F')).toBe('Final');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/judgeStats.classify.test.ts
```

Expected: FAIL — `normalizeStageLabel` is not exported from `@/lib/calicotab/judgeStats`.

- [ ] **Step 3: Add `normalizeStageLabel` to `lib/calicotab/judgeStats.ts`**

Insert this near the top of `lib/calicotab/judgeStats.ts`, immediately after the imports / before `classifyRoundLabel`:

```typescript
/**
 * Convert a raw Tabbycat round label into the canonical string form.
 *
 * Tabbycat themes sometimes render abbreviated stage labels in
 * `.tooltip-trigger` spans without the enclosing `<div data-original-title="…">`
 * that carries the full name. Without normalization "R1" reads as a
 * non-numeric label so `classifyRoundLabel` returns 'unknown' and the
 * downstream judge stats undercount chairs.
 *
 * Stage 1 of the 3-stage round-label pipeline:
 *   normalize → {@link classifyRoundLabel} → {@link classifyOutroundStage}
 *
 * Inputs that already match the canonical form pass through unchanged.
 */
export function normalizeStageLabel(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  const rMatch = t.match(/^R(\d+)$/i);
  if (rMatch) return `Round ${Number(rMatch[1])}`;
  const lower = t.toLowerCase();
  // Order matters: longer prefixes first so "DOF" doesn't match "F" first.
  if (/^gf$/i.test(t)) return 'Grand Final';
  if (/^sf$/i.test(t) || lower === 'semis') return 'Semifinals';
  if (/^qf$/i.test(t) || lower === 'quarters') return 'Quarterfinals';
  if (/^dof$/i.test(t) || lower === 'doubles') return 'Double Octofinals';
  if (/^tof$/i.test(t) || lower === 'triples') return 'Triple Octofinals';
  if (/^of$/i.test(t) || lower === 'octos') return 'Octofinals';
  if (/^f$/i.test(t)) return 'Final';
  return t;
}
```

- [ ] **Step 4: Replace the body in `lib/calicotab/parseNav.ts` with a re-export**

Replace lines 286–324 of `lib/calicotab/parseNav.ts` (the entire `normalizeStageLabel` function and its preceding comment block) with:

```typescript
/**
 * Re-exported from judgeStats so the round-label pipeline (normalize →
 * classifyRoundLabel → classifyOutroundStage) lives in one file. The
 * function originally lived here because the private-URL "Debates" card
 * parsing first encountered raw "R1"/"GF" labels; the function itself
 * is generic and now belongs alongside the rest of the round-label
 * pipeline.
 */
export { normalizeStageLabel } from './judgeStats';
```

The original `normalizeStageLabel` function body in parseNav.ts (lines 309–324) is now deleted.

- [ ] **Step 5: Run full test suite + lint + typecheck**

```bash
npm test
npm run lint
npm run typecheck
```

Expected: all green. The new `normalizeStageLabel` tests in `judgeStats.classify.test.ts` pass, and any existing test (e.g. `parseNav.realMarkup.test.ts`) that uses the function via parseNav.ts continues to work because of the re-export.

- [ ] **Step 6: Commit**

```bash
git add lib/calicotab/judgeStats.ts lib/calicotab/parseNav.ts tests/judgeStats.classify.test.ts
git commit -m "$(cat <<'EOF'
refactor: co-locate normalizeStageLabel with classifyRoundLabel in judgeStats

Round-label pipeline (normalize → classifyRoundLabel → classifyOutroundStage)
now lives in one file. parseNav.ts re-exports for backward compatibility
with any external caller; the implementation moved verbatim, no behavior
change.
EOF
)"
```

---

## Task 3: Unify outround rank scale — delete `INGEST_STAGE_RANK`, rewrite champion check

**Files:**
- Modify: `lib/calicotab/ingest.ts:1186-1207` (delete `INGEST_STAGE_RANK` and local `outroundStageRank` function; update 4 call sites at lines 1260, 1345, 1521, 1656 to use `outroundRankStrict`)
- Modify: `lib/calicotab/ingest.ts:955` (the `__test_outroundStageRank` export — repoint or delete)
- Modify: `tests/calicotab.outroundStageRank.test.ts` (update import to point at canonical helper)
- Modify: `lib/cv/buildCvData.ts:498-513` (rewrite champion-threshold magic literal)

- [ ] **Step 1: Confirm the existing `outroundStageRank` test will still pass under the new scale**

The existing tests in `tests/calicotab.outroundStageRank.test.ts` only assert ordering and equivalence of category-prefixed forms — they do NOT pin specific numeric values (no `toBe(110)` calls). Inspect the file to confirm:

```bash
grep -E "toBe\(" tests/calicotab.outroundStageRank.test.ts
```

Expected: no `toBe(\d+)` matches (only `toBe(rank('X'))` relative equalities, plus `toBeNull()` and `toBeGreaterThan(...)`).

If the grep returns numeric `toBe` calls, those need updating. Per current spec read of the file (lines 12–26), there are none.

- [ ] **Step 2: Update the test import to point at the canonical helper**

In `tests/calicotab.outroundStageRank.test.ts`, change line 2:

From:
```typescript
import { __test_outroundStageRank as rank } from '@/lib/calicotab/ingest';
```

To:
```typescript
import { outroundRankStrict as rank } from '@/lib/calicotab/judgeStats';
```

- [ ] **Step 3: Delete `INGEST_STAGE_RANK` and the local `outroundStageRank` function from `lib/calicotab/ingest.ts`**

In `lib/calicotab/ingest.ts`, delete lines 1186–1207 inclusive (the comment block, the `INGEST_STAGE_RANK` table, and the local `outroundStageRank` function).

Also delete the `__test_outroundStageRank` export at line 955:

```typescript
export { outroundStageRank as __test_outroundStageRank };
```

Delete that line and the preceding 3-line comment block at lines 952–955.

- [ ] **Step 4: Add `outroundRankStrict` to the existing judgeStats import in `lib/calicotab/ingest.ts`**

Find the existing `import { ... } from '@/lib/calicotab/judgeStats'` in `lib/calicotab/ingest.ts` (it imports `classifyOutroundStage`, `getInroundsChairedCount`, `OutroundStage`, etc.). Add `outroundRankStrict` to the import list:

```typescript
import {
  classifyOutroundStage,
  getInroundsChairedCount,
  outroundRankStrict,
  // …existing imports kept as they are
} from '@/lib/calicotab/judgeStats';
```

- [ ] **Step 5: Update the 4 call sites in `lib/calicotab/ingest.ts` from `outroundStageRank` to `outroundRankStrict`**

Each of these lines uses the now-deleted local `outroundStageRank`. They are at approximately lines 1260, 1345, 1521, 1656 (line numbers will shift slightly after the deletion in Step 3). Use ripgrep to find them and replace verbatim:

```bash
grep -n "outroundStageRank" lib/calicotab/ingest.ts
```

Expected: 4 hits, all of the form `outroundStageRank(r.stage)` or `outroundStageRank(h.stage)`. Replace each occurrence:

From:
```typescript
.map((r) => ({ r, rank: outroundStageRank(r.stage) }))
```

To:
```typescript
.map((r) => ({ r, rank: outroundRankStrict(r.stage) }))
```

(And the equivalent for the `(h)` variants — same one-word replacement.)

- [ ] **Step 6: Rewrite the champion threshold in `lib/cv/buildCvData.ts`**

Find the champion-check block at `lib/cv/buildCvData.ts:498-513`. Replace:

```typescript
    let wonTournament: boolean | null = null;
    if (p.teamName && speakerSignals.eliminationReached) {
      const deepest = speakerSignals.eliminationReached;
      const stageRank = outroundRank({ roundLabel: deepest, roundNumber: null, isOutround: true });
      const isFinalStage = stageRank >= 95; // GF=100, plain Final=95
      if (isFinalStage) {
        const result = teamOutroundResultByKey.get(`${tid}:${p.teamName}:${deepest}`);
        if (result === 'won') wonTournament = true;
        else if (result === 'lost') wonTournament = false;
      }
    }
```

With:

```typescript
    let wonTournament: boolean | null = null;
    if (p.teamName && speakerSignals.eliminationReached) {
      const deepest = speakerSignals.eliminationReached;
      const stageRank = outroundRank({ roundLabel: deepest, roundNumber: null, isOutround: true });
      // Anchor against the canonical "Final" rank instead of the magic literal 95.
      // Both "Final" (= finalRank) and "Grand Final" (> finalRank) qualify — a
      // tournament's last round can be labeled either way depending on the
      // Tabbycat install. Anchoring to outroundRank('Final') means any future
      // scale change is picked up automatically.
      const finalRank = outroundRank({ roundLabel: 'Final', roundNumber: null, isOutround: true });
      const isFinalStage = stageRank >= finalRank;
      if (isFinalStage) {
        const result = teamOutroundResultByKey.get(`${tid}:${p.teamName}:${deepest}`);
        if (result === 'won') wonTournament = true;
        else if (result === 'lost') wonTournament = false;
      }
    }
```

- [ ] **Step 7: Run full test suite + lint + typecheck**

```bash
npm test
npm run lint
npm run typecheck
```

Expected: all green. Specific files to watch:
- `tests/calicotab.outroundStageRank.test.ts` (now importing `outroundRankStrict`) — passes under the unified 50-100 scale because tests assert only ordering and category-prefix equivalence.
- `tests/calicotab.outroundRank.unification.test.ts` — passes (added in Task 1).
- `tests/cv.test.ts` — passes (champion-check rewrite is semantically equivalent).
- `tests/judgeStats.test.ts` — passes (no changes to `outroundRank` itself).

- [ ] **Step 8: Commit**

```bash
git add lib/calicotab/ingest.ts lib/cv/buildCvData.ts tests/calicotab.outroundStageRank.test.ts
git commit -m "$(cat <<'EOF'
refactor: unify outround rank scale; delete INGEST_STAGE_RANK

Drops the duplicate 50-110 INGEST_STAGE_RANK table in ingest.ts in favor
of the canonical 50-100 outroundRankStrict helper in judgeStats. The four
internal call sites (deepest-outround computation) and the test file now
import from one location. Champion check in buildCvData.ts:507 is rewritten
to anchor against outroundRank('Final') instead of the magic literal 95 —
same semantics, no magic numbers.
EOF
)"
```

---

## Task 4: Replace 3 inlined fuzzy matchers with `personNameMatches`

**Files:**
- Modify: `lib/calicotab/ingest.ts:1429-1449` (delete `wantedNorm` / `wantedTokens` setup + `matchesName` closure; use `personNameMatches` directly)
- Modify: `lib/calicotab/parseNav.ts:472-533` (delete inlined matcher in `extractOwnerRoleFromAdjHtml`)
- Modify: `lib/calicotab/parseNav.ts:579-680` (delete inlined matcher in `extractAdjudicatorRounds`)

Each inlined site was a near-verbatim copy of the same exact-then-substring-then-token-subset cascade with the same ≥2-token guard. `personNameMatches` (from Task 1) is symmetric, so it slots into both predicate sites.

- [ ] **Step 1: Replace `matchesName` closure in `lib/calicotab/ingest.ts`**

Find `recordJudgeRoundsFromRoundResults` (around line 1420). Replace lines 1426–1449 (the early-return guard, the `wantedNorm`/`wantedTokens`/`wantedTokenSet` setup, and the `matchesName` closure) with this simpler version:

```typescript
  if (!knownPersonName) {
    return { written: 0, matched: 0, diagnostic: null };
  }
```

Then update the call site at line 1458 (inside the round-iteration loop):

From:
```typescript
      if (!matchesName(j.personName)) continue;
```

To:
```typescript
      if (!personNameMatches(j.personName, knownPersonName)) continue;
```

Add `personNameMatches` to the existing import from `@/lib/calicotab/personMatch` at the top of `ingest.ts`. If no such import exists yet, add it:

```typescript
import { personNameMatches } from '@/lib/calicotab/personMatch';
```

(Check first with `grep -n "from '@/lib/calicotab/personMatch'" lib/calicotab/ingest.ts` — if a `findPersonId` import already exists, just add `personNameMatches` to the same line.)

The `normalizePersonName` import at the top of ingest.ts may no longer be needed if `matchesName` was its only user. Verify:

```bash
grep -n "normalizePersonName" lib/calicotab/ingest.ts
```

If the only remaining hit is the import line, remove the import. Otherwise leave it.

- [ ] **Step 2: Replace the inlined matcher in `parseNav.ts::extractOwnerRoleFromAdjHtml`**

In `lib/calicotab/parseNav.ts`, find `extractOwnerRoleFromAdjHtml` (around line 472). The block at lines 477–516 contains the inlined matcher logic. Replace it with this version:

```typescript
function extractOwnerRoleFromAdjHtml(
  adjHtml: string,
  knownPersonName?: string | null,
): 'chair' | 'panellist' | 'trainee' | null {
  const $ = cheerio.load(`<div>${adjHtml}</div>`);

  let ownerEl = $('strong').first();
  let ownerSymbolText = '';
  if (ownerEl.length > 0) {
    ownerSymbolText = cleanWhitespace(ownerEl.find('.adj-symbol').text());
  } else if (knownPersonName) {
    const candidates = $('span.d-inline').toArray();
    const fallbackCandidates = candidates.length > 0 ? candidates : $('span').toArray();
    for (const el of fallbackCandidates) {
      const $el = $(el);
      const symbol = $el.find('.adj-symbol');
      const symbolText = cleanWhitespace(symbol.text());
      const plainText = cleanWhitespace(
        $el
          .clone()
          .find('.adj-symbol')
          .remove()
          .end()
          .text(),
      );
      if (!plainText) continue;

      if (personNameMatches(plainText, knownPersonName)) {
        ownerEl = $el;
        ownerSymbolText = symbolText;
        break;
      }
    }
  }
  if (ownerEl.length === 0) return null;

  if (ownerSymbolText.includes('Ⓒ') || ownerSymbolText.includes('â’¸') || /chair/i.test(ownerSymbolText)) {
    return 'chair';
  }
  if (ownerSymbolText.includes('Ⓣ') || ownerSymbolText.includes('â“‰') || /trainee/i.test(ownerSymbolText)) {
    return 'trainee';
  }
  return 'panellist';
}
```

Note that `plainText` is no longer `.toLowerCase()`'d here — `personNameMatches` handles normalization internally via `normalizePersonName`.

Add `personNameMatches` to the imports at the top of `parseNav.ts`:

```typescript
import { personNameMatches } from '@/lib/calicotab/personMatch';
```

- [ ] **Step 3: Replace the inlined matcher in `parseNav.ts::extractAdjudicatorRounds`**

Still in `parseNav.ts`, find `extractAdjudicatorRounds` (around line 579). The cheerio path contains the second inlined matcher at lines 590–668. Replace that whole section with a `personNameMatches`-based version. The full function (cheerio path only — the Vue path call at line 583–584 stays) becomes:

```typescript
export function extractAdjudicatorRounds(
  html: string,
  knownPersonName?: string | null,
): AdjudicatorRound[] {
  const vueRows = extractAdjudicatorRoundsFromVue(html, knownPersonName);
  if (vueRows) return vueRows;

  const $ = cheerio.load(html);
  const table = findDebatesTable($);
  if (!table) return [];

  const rows: AdjudicatorRound[] = [];
  table.find('tbody > tr').each((idx, tr) => {
    const $tr = $(tr);
    const stageInfo = extractRowStage($, $tr);
    if (!stageInfo) return;

    const adjCell = $tr.find('td.adjudicator-name').first();
    if (adjCell.length === 0) return;

    // Path 1: Tabbycat's <strong> marker around the URL owner's name.
    // Path 2: name match against the registration name via the canonical
    // personNameMatches predicate.
    let ownerEl = adjCell.find('strong').first();
    let ownerSymbolText = '';
    if (ownerEl.length > 0) {
      ownerSymbolText = cleanWhitespace(ownerEl.find('.adj-symbol').text());
    } else if (knownPersonName) {
      const candidates = adjCell.find('span.d-inline').toArray();
      const fallbackCandidates = candidates.length > 0
        ? candidates
        : adjCell.find('span').toArray();
      for (const el of fallbackCandidates) {
        const $el = $(el);
        const symbol = $el.find('.adj-symbol');
        const symbolText = cleanWhitespace(symbol.text());
        const plainText = cleanWhitespace(
          $el
            .clone()
            .find('.adj-symbol')
            .remove()
            .end()
            .text(),
        );
        if (!plainText) continue;

        if (personNameMatches(plainText, knownPersonName)) {
          ownerEl = $el;
          ownerSymbolText = symbolText;
          break;
        }
      }
    }
    // …keep the rest of the original function body below this point unchanged
    // (role classification + push to rows array). The lines after the existing
    // matcher block — currently starting around line 670 — are not touched.
```

**Important:** only the matcher-cascade block is replaced. The lines after it (role classification from `ownerSymbolText`, the push into `rows`, the closing `each(...)` and `return rows`) are untouched. Inspect lines 670–745 of the current `parseNav.ts` for the tail of the function and keep it intact.

- [ ] **Step 4: Run full test suite + lint + typecheck**

```bash
npm test
npm run lint
npm run typecheck
```

Expected: all green. Specific files to watch:
- `tests/calicotab.parseNav.adjudicator.test.ts` — exercises `extractAdjudicatorRounds` over real markup; this is the integration test that the matcher swap preserved behavior.
- `tests/calicotab.parseNav.won.test.ts` — also exercises adjudicator extraction in the won-detection path.
- `tests/parseNav.realMarkup.test.ts` — broad-coverage parser regression test.

If any of these fail, the inlined-matcher behavior diverged from `personNameMatches` somewhere. Roll back the call-site change and investigate before proceeding.

- [ ] **Step 5: Commit**

```bash
git add lib/calicotab/ingest.ts lib/calicotab/parseNav.ts
git commit -m "$(cat <<'EOF'
refactor: replace 3 inlined fuzzy matchers with personNameMatches

ingest.ts::recordJudgeRoundsFromRoundResults' matchesName closure,
parseNav.ts::extractOwnerRoleFromAdjHtml's inline cascade, and
parseNav.ts::extractAdjudicatorRounds' inline cascade all used the same
exact → substring → token-subset cascade with a ≥2-token guard. Now they
all call the canonical personNameMatches predicate from personMatch.ts.

No external behavior change — verified by existing parseNav adjudicator,
parseNav won-detection, and parseNav realMarkup integration tests.
EOF
)"
```

---

## Task 5: Replace `isJudge` OR with `isJudgeParticipant` in `buildCvData.ts`

**Files:**
- Modify: `lib/cv/buildCvData.ts:578-585` (replace the 5-signal OR with the canonical helper)

- [ ] **Step 1: Replace the inlined OR in `lib/cv/buildCvData.ts`**

Find the judge-rows section at `lib/cv/buildCvData.ts:576-595`. Replace lines 578–585:

From:
```typescript
  for (const p of myParticipations) {
    const isJudge =
      p.roles.some((r) => r.role === 'judge') ||
      !!p.judgeTypeTag ||
      (p.chairedPrelimRounds ?? 0) > 0 ||
      !!p.lastOutroundChaired ||
      !!p.lastOutroundPaneled;
    if (!isJudge) continue;
```

To:
```typescript
  for (const p of myParticipations) {
    if (!isJudgeParticipant(p)) continue;
```

Add the import at the top of `buildCvData.ts`:

```typescript
import { isJudgeParticipant } from '@/lib/cv/roleClassification';
```

- [ ] **Step 2: Run full test suite + lint + typecheck**

```bash
npm test
npm run lint
npm run typecheck
```

Expected: all green. `tests/cv.test.ts` is the integration check — if it covers a participant who is *only* a judge (has `lastOutroundChaired` set, no `roles=['judge']` row), the OR-replacement is exercised. If `cv.test.ts` lacks that case, the failure mode would be a participant erroneously dropped from judge rows. The `isJudgeParticipant` unit test from Task 1 covers this path in isolation.

- [ ] **Step 3: Commit**

```bash
git add lib/cv/buildCvData.ts
git commit -m "$(cat <<'EOF'
refactor: extract isJudgeParticipant to lib/cv/roleClassification

The 5-signal OR that decided whether a TournamentParticipant row
represents the user playing a judge role now lives behind one named
helper. Behavior unchanged. The OR persists because the ParticipantRole
table isn't authoritative — making it so is the ingest decomposition
sub-project's territory.
EOF
)"
```

---

## Task 6: Replace `prelimRoundCount` resolution with `pickPrelimRoundCount`

**Files:**
- Modify: `lib/cv/buildCvData.ts:229-251` (replace the two-pass resolution loop)

- [ ] **Step 1: Replace the resolution block in `lib/cv/buildCvData.ts`**

Find the `prelimRoundCountByTournament` block at lines 229–251. Replace it with this version:

```typescript
  // Resolve the prelim-round count per tournament from the two known
  // sources (stored value first, MAX(TeamResult.roundNumber) fallback).
  // The rule itself lives in `pickPrelimRoundCount` so the read path
  // and any future call site share one definition.
  const prelimRoundCountByTournament = new Map<bigint, number>();
  if (tournamentIds.length > 0) {
    const [tournamentRows, maxRoundRows] = await Promise.all([
      prisma.tournament.findMany({
        where: { id: { in: tournamentIds } },
        select: { id: true, prelimRoundCount: true },
      }),
      prisma.teamResult.groupBy({
        by: ['tournamentId'],
        where: { tournamentId: { in: tournamentIds }, roundNumber: { gt: 0 } },
        _max: { roundNumber: true },
      }),
    ]);
    const maxByTournament = new Map<bigint, number | null>();
    for (const r of maxRoundRows) {
      maxByTournament.set(r.tournamentId, r._max.roundNumber);
    }
    for (const t of tournamentRows) {
      const picked = pickPrelimRoundCount({
        stored: t.prelimRoundCount,
        maxTeamRoundNumber: maxByTournament.get(t.id) ?? null,
      });
      if (picked != null) prelimRoundCountByTournament.set(t.id, picked);
    }
  }
```

Note the change from two sequential queries to one `Promise.all` — minor perf improvement, the original pattern serialised them. This is in-scope because it falls out naturally from extracting the resolution rule.

Add the import at the top of `buildCvData.ts`:

```typescript
import { pickPrelimRoundCount } from '@/lib/calicotab/prelimRoundCount';
```

- [ ] **Step 2: Run full test suite + lint + typecheck**

```bash
npm test
npm run lint
npm run typecheck
```

Expected: all green. `tests/cv.test.ts` exercises the CV builder end-to-end; a regression in prelim-count resolution would show up in `speakerAvgScore` calculations for tournaments where the fallback path matters.

- [ ] **Step 3: Commit**

```bash
git add lib/cv/buildCvData.ts
git commit -m "$(cat <<'EOF'
refactor: extract pickPrelimRoundCount helper

The two-source resolution (stored Tournament.prelimRoundCount, fallback
MAX(TeamResult.roundNumber)) now lives in one pure helper. Read path
runs the two queries in parallel rather than serialised — small perf
improvement that falls out of the extraction.
EOF
)"
```

---

## Task 7 (CONDITIONAL): Simplify `outroundRank` signature to accept a string

This commit only lands if the audit at its start shows all `outroundRank` callers either (a) pass a literal label string, or (b) pass `roundNumber: null, isOutround: true`. If any caller materially depends on the structured shape (e.g. uses the `roundNumber` numeric-outround fallback), **drop this task entirely** — the current signature is already optimal.

- [ ] **Step 1: Audit `outroundRank` call sites**

```bash
grep -rn "outroundRank(" lib/ tests/ app/ components/ 2>/dev/null
```

Inspect each hit. Classify:
- **Type A:** Callers passing `{ roundLabel: 'X', roundNumber: null, isOutround: true }` (a literal label, no roundNumber fallback). These can use a string-only signature.
- **Type B:** Callers passing actual round data with `roundNumber` set and `isOutround: true`. These rely on the numeric-outround fallback at `outroundRank` line 167 (`if (round.roundNumber != null) return round.roundNumber`).

Expected from current code: `buildCvData.ts:506` and `buildCvData.ts:523` and `buildCvData.ts:531` (the champion check + EUDC by-category block) are Type A. The `judgeStats.test.ts` cases at lines 14–17 are Type A. `aggregateJudgeStats` inside `judgeStats.ts:213` calls `outroundRank(round)` passing a full `JudgeRoundInput` shape — this is Type B (relies on `roundNumber` fallback for numeric-only outround labels).

**If any Type B caller exists, STOP this task here.** Do not commit. The conditional has resolved to "skip" — proceed straight to PR creation. Per the audit above, `aggregateJudgeStats` IS Type B, so this task is expected to skip in practice.

- [ ] **Step 2 (only if all callers are Type A): Add a string-accepting overload**

If, contrary to the audit, all callers turn out to be Type A, add a string-overload to `outroundRank` rather than breaking the existing signature. Update `lib/calicotab/judgeStats.ts:163-169`:

```typescript
export function outroundRank(label: string | null | undefined): number;
export function outroundRank(round: { roundLabel: string | null; roundNumber: number | null; isOutround: boolean }): number;
export function outroundRank(input: string | { roundLabel: string | null; roundNumber: number | null; isOutround: boolean } | null | undefined): number {
  if (typeof input === 'string' || input == null) {
    const strict = outroundRankStrict(input);
    return strict ?? -1;
  }
  if (!input.isOutround) return -1;
  const stage = classifyOutroundStage(input.roundLabel);
  if (stage) return JUDGE_STATS_RANK[stage];
  if (input.roundNumber != null) return input.roundNumber;
  return 0;
}
```

Then simplify each Type-A call site to pass a string literal.

- [ ] **Step 3 (only if Step 2 ran): Run full test suite + lint + typecheck**

```bash
npm test
npm run lint
npm run typecheck
```

Expected: all green.

- [ ] **Step 4 (only if Step 2 ran): Commit**

```bash
git add lib/calicotab/judgeStats.ts lib/cv/buildCvData.ts
git commit -m "$(cat <<'EOF'
refactor: add string-accepting overload to outroundRank

Type-A callers (pass a literal label, no roundNumber fallback used) now
call outroundRank('Final') directly instead of constructing a structured
input. Structured signature preserved for aggregateJudgeStats which uses
the numeric-outround fallback.
EOF
)"
```

---

## Post-flight: PR & manual verification

- [ ] **Step 1: Push the branch**

```bash
git push -u origin refactor/canonical-mappings
```

- [ ] **Step 2: Open a PR**

```bash
gh pr create --title "refactor: consolidate canonical mappings in lib/calicotab + lib/cv" --body "$(cat <<'EOF'
## Summary
- Unifies the outround-rank scale (50-100 in judgeStats; previously 50-110 in ingest's INGEST_STAGE_RANK).
- Extracts `personNameMatches`, `isJudgeParticipant`, `pickPrelimRoundCount` as canonical helpers; deletes 3 inlined fuzzy matchers and the 5-signal `isJudge` OR.
- Co-locates `normalizeStageLabel` with the rest of the round-label pipeline in `judgeStats.ts`.
- Rewrites buildCvData's champion threshold to anchor against `outroundRank('Final')` instead of the magic literal 95.

Pure refactor. No schema change, no PARSER_VERSION bump, no user-visible behavior intended.

Spec: `docs/superpowers/specs/2026-05-22-canonical-mappings-design.md`
Plan: `docs/superpowers/plans/2026-05-22-canonical-mappings.md`

## Test plan
- [ ] CI: `npm test`, `npm run lint`, `npm run typecheck` all green
- [ ] Local: re-ingest a known tournament in a dev environment after merge; rendered `/cv` is unchanged
- [ ] Spot-check a tournament where the user's deepest outround is plain "Final" (not "Grand Final"); confirm `wonTournament` still resolves correctly

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Manual verification in dev**

Run a re-ingest of a previously-ingested tournament URL via `/api/ingest/url` and confirm the rendered `/cv` is unchanged from before the branch. Pay particular attention to:

- A tournament where the user judged (verifies `isJudgeParticipant` swap).
- A tournament where the user reached "Final" or "Grand Final" (verifies champion-check rewrite).
- A tournament with a category-prefixed final like "Novice Final" (verifies the outround-rank unification preserves category-prefix behavior).

If any rendered field changes between before and after, the refactor has a behavioral diff that the unit tests didn't catch — investigate before merging.

---

## Self-review

**1. Spec coverage.** Walking through each section of the spec:

- ✅ "Unify outround-rank scale" — Task 3.
- ✅ "Extract `personNameMatches`" — Task 1 (helper + test) and Task 4 (call-site swap).
- ✅ "Extract `isJudgeParticipant`" — Task 1 (helper + test) and Task 5 (call-site swap).
- ✅ "Extract `pickPrelimRoundCount`" — Task 1 (helper + test) and Task 6 (call-site swap).
- ✅ "Co-locate the round-label pipeline" — Task 2.
- ✅ "Audit `outroundRank` caller input shape" — Task 7 (conditional, expected to skip per the audit because `aggregateJudgeStats` is Type B).
- ✅ "Behavior-preservation tests written before any deletion" — Task 1 lands the tests; Tasks 4–6 do the deletions.

No spec section is missing a task.

**2. Placeholder scan.** Searched the plan for TBD / TODO / "fill in" / "add appropriate" / "similar to". No matches. Every code step has a complete code block.

**3. Type consistency.** Cross-checked names and signatures:

- `personNameMatches(a: string, b: string): boolean` — used identically in Task 1 (impl), Task 4 (3 call sites), and `findPersonId` refactor.
- `outroundRankStrict(label: string | null | undefined): number | null` — Task 1 impl, Task 3 import, test file rename.
- `pickPrelimRoundCount({ stored, maxTeamRoundNumber })` — Task 1 impl, Task 6 call site.
- `isJudgeParticipant(p)` — Task 1 impl + test (with the full participant shape), Task 5 call site (called on `p` which has the matching shape per `myParticipations` select).
- `normalizeStageLabel(raw: string): string` — Task 2 move, re-exported from parseNav for backward compat.

No drift.
