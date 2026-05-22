# Canonical Mappings Consolidation — Design Spec

**Date:** 2026-05-22
**Status:** Approved, ready for plan-writing
**Type:** Pure refactor (no behavior change, no schema change, no PARSER_VERSION bump)
**Subsystem:** `lib/calicotab/` + `lib/cv/`

## Goal

Consolidate four inlined logic duplicates in the calicotab/CV layer into single canonical helpers, with behavior-preservation tests landing before any deletion. Net delta ≈ +50 LOC of helpers/tests, −120 LOC of inlined copies.

## Motivation

An architecture diagnosis of `debate_cv` (2026-05-22) surfaced that the calicotab subsystem has the same logic written in 2–4 places that disagree by small amounts. Three sources of truth for the outround-rank scale, three implementations of the fuzzy name matcher, a 5-signal `isJudge` OR cargo-culted into the read path, and a `prelimRoundCount` resolution split across the write and read paths. These have not yet caused a production bug, but they will the next time one copy is updated and the others aren't. This refactor removes the class of problem.

## In scope

1. **Unify outround-rank scale** — delete `INGEST_STAGE_RANK` (50–110) in `lib/calicotab/ingest.ts`; standardize on `outroundRank` (50–100) in `lib/calicotab/judgeStats.ts`. Rewrite `buildCvData.ts:507`'s `>= 95` champion threshold as `>= outroundRank({ roundLabel: 'Final', roundNumber: null, isOutround: true })` — same semantics (matches both "Grand Final" and plain "Final" as a tournament's final round) but the threshold is no longer a magic literal.
2. **Extract `personNameMatches(a, b): boolean`** to `lib/calicotab/personMatch.ts`. Refactor `findPersonId` to call it internally. Delete the three inlined fuzzy matchers (`ingest.ts::matchesName`, `parseNav.ts::extractOwnerRoleFromAdjHtml`'s inline cascade, `parseNav.ts::extractAdjudicatorRounds`'s inline cascade).
3. **Extract `isJudgeParticipant(p): boolean`** to a new file `lib/cv/roleClassification.ts`. Behavior unchanged — same 5-signal OR. Document inline that making the `roles` table authoritative is the proper long-term fix and is deferred to the ingest decomposition sub-project.
4. **Extract `pickPrelimRoundCount({ stored, maxTeamRoundNumber }): number | null`** to a new file `lib/calicotab/prelimRoundCount.ts`. Pure function. Used from `buildCvData.ts:229–250` so the rule lives in one place.
5. **Co-locate the round-label pipeline** — move `normalizeStageLabel` from `parseNav.ts` to `judgeStats.ts` so the 3-stage pipeline (normalize → `classifyRoundLabel` → `classifyOutroundStage`) lives in one file.
6. **Audit `outroundRank` caller input shape** — if all callers pass a literal label string, simplify the signature to `(label: string) => number`. Conditional: skip the simplification commit if any caller materially depends on the structured `{ roundLabel, roundNumber, isOutround }` shape.

## Explicitly out of scope

These are tempting to touch while in the area. They are not part of this refactor and are deferred to future sub-projects identified in the diagnosis.

- **`roles`-table-authoritative `isJudge`** — touches three judge writers in `ingest.ts`, needs backfill SQL, needs `PARSER_VERSION` bump. Deferred to the ingest decomposition sub-project.
- **Removing the read-time `derivedRankByTournament` speaker-rank fallback** at `buildCvData.ts:259–282`. Deferred to the "persist what buildCvData derives" sub-project.
- **Restructuring the three near-identical judge writers** in `ingest.ts` (`recordJudgeRoundsFromLanding`, `recordJudgeRoundsFromRoundResults`, `recordAllJudgeAssignmentsFromRoundResults`). Deferred to ingest decomposition.
- **Parser Vue/cheerio collapse** in `parseTabs.ts` and `parseNav.ts` beyond the inlined fuzzy matcher swap. Deferred to the parser-collapse sub-project.
- **Replacing `new Function` server-side eval** at `parseTabs.ts:33`. Its own one-file sub-project.
- **Bumping `PARSER_VERSION`** — not needed; no parser logic changes, only call-site indirection. CLAUDE.md's "don't bump casually" rule honored.

## File layout

| File | What changes |
|---|---|
| `lib/calicotab/judgeStats.ts` | **+** `normalizeStageLabel` moves here from `parseNav.ts`. `outroundRank` signature optionally simplified to take a string (conditional on audit). |
| `lib/calicotab/personMatch.ts` | **+** `personNameMatches(a, b): boolean`. `findPersonId` refactored to call it. |
| `lib/calicotab/prelimRoundCount.ts` | **+ NEW FILE.** Exports `pickPrelimRoundCount`. |
| `lib/cv/roleClassification.ts` | **+ NEW FILE.** Exports `isJudgeParticipant`. |
| `lib/calicotab/parseNav.ts` | **−** `normalizeStageLabel` export (moved out; re-exported via `judgeStats` if any external caller exists). **−** Inlined fuzzy matcher in `extractAdjudicatorRounds` (L649). **−** Inlined fuzzy matcher in `extractOwnerRoleFromAdjHtml` (L504). Both replaced with `personNameMatches` calls. |
| `lib/calicotab/ingest.ts` | **−** `INGEST_STAGE_RANK` table + `outroundStageRank` wrapper (L1189–1206). 4 call sites at L1260/L1345/L1521/L1656 updated to use canonical `outroundRank`. **−** `matchesName` closure in `recordJudgeRoundsFromRoundResults` (L1434), replaced with `personNameMatches`. |
| `lib/cv/buildCvData.ts` | `>= 95` champion threshold at L507 → `>= outroundRank({ roundLabel: 'Final', ... })`. Same semantics (both "Grand Final" and plain "Final" qualify), no magic literal. 5-signal `isJudge` OR at L579–584 → `isJudgeParticipant(p)`. `prelimRoundCount` resolution at L229–250 uses `pickPrelimRoundCount`. |

## Canonical helper API

```typescript
// lib/calicotab/judgeStats.ts (addition)
export function normalizeStageLabel(raw: string): string;
// Converts abbreviations and colloquial forms to canonical strings:
// "GF" → "Grand Final", "R1" → "Round 1", "semis" → "Semifinals", etc.
// Pass-through for inputs that already match canonical form.

// lib/calicotab/personMatch.ts (addition)
export function personNameMatches(a: string, b: string): boolean;
// Returns false when either side is empty/whitespace after normalization.
// Otherwise runs: exact match → substring containment (either direction)
// → token-subset match (either direction). Token-subset requires both sides
// to have ≥2 tokens after normalization to avoid single-name false positives.

// lib/calicotab/prelimRoundCount.ts (new)
export function pickPrelimRoundCount(args: {
  stored: number | null;
  maxTeamRoundNumber: number | null;
}): number | null;
// Returns `stored` when it is positive (> 0). Otherwise returns
// `maxTeamRoundNumber` when positive. Otherwise null.
// Pure function — no DB access.

// lib/cv/roleClassification.ts (new)
export function isJudgeParticipant(p: {
  roles: ReadonlyArray<{ role: string }>;
  judgeTypeTag: string | null;
  chairedPrelimRounds: number | null;
  lastOutroundChaired: string | null;
  lastOutroundPaneled: string | null;
}): boolean;
// True if any of: roles contains 'judge'; judgeTypeTag set;
// chairedPrelimRounds > 0; lastOutroundChaired set; lastOutroundPaneled set.
// Mirrors the OR at buildCvData.ts:579–584. Behavior preserved.
```

## Commit sequence (single branch, ~7 commits)

| # | Commit message | Behavior change? | Tests added/extended |
|---|---|---|---|
| 1 | `test: lock down behavior of inlined matchers and INGEST_STAGE_RANK before refactor` | None | `personNameMatches.test.ts` (new), `outroundRank.unification.test.ts` (new), `isJudgeParticipant.test.ts` (new), `pickPrelimRoundCount.test.ts` (new), `judgeStats.classify.test.ts` (extended for `normalizeStageLabel`) |
| 2 | `refactor: co-locate normalizeStageLabel with classifyRoundLabel in judgeStats` | None — code move | New tests from #1 still pass |
| 3 | `refactor: unify outround rank scale; delete INGEST_STAGE_RANK` | None — ordering preserved; champion check rewritten with no magic literal | `outroundRank.unification.test.ts` (added #1) is the gate |
| 4 | `refactor: extract personNameMatches; delete 3 inlined fuzzy matchers` | None — predicate matches inlined copies' contract | `personNameMatches.test.ts` + existing `personMatch.test.ts` + `parseNav.adjudicator.test.ts` + `parseNav.won.test.ts` |
| 5 | `refactor: extract isJudgeParticipant to lib/cv/roleClassification` | None — same OR, one name | `isJudgeParticipant.test.ts` + `cv.test.ts` |
| 6 | `refactor: extract pickPrelimRoundCount helper` | None | `pickPrelimRoundCount.test.ts` |
| 7 | `refactor: simplify outroundRank signature to accept string` *(conditional)* | None — backwards-compatible overload if needed | Existing `outroundStageRank.test.ts` + `judgeStats.test.ts` |

Every commit must leave `npm test`, `npm run lint`, and `npm run typecheck` green. Commit 7 is dropped if the audit at its start shows any caller depending on the structured input shape.

## Test strategy

**Behavior-preservation first.** Tests in commit 1 pin the *current* behavior of every inlined site before any deletion. The tests target observable contract (input → output) not implementation, so they survive the refactor by design.

### New test files (commit 1)

**`tests/calicotab.personNameMatches.test.ts`** — pins the predicate contract:
- Exact normalized match: `"Abhishek Acharya"` ↔ `"abhishek acharya"` → true.
- Substring containment: `"Abhishek K Acharya"` vs `"Abhishek Acharya"` → true.
- Parenthetical suffix: `"Abhishek Acharya (IIT-B)"` vs `"Abhishek Acharya"` → true.
- Reorder: `"Acharya, Abhishek"` vs `"Abhishek Acharya"` → true (via token-subset).
- Single-token guard: `"Smith"` vs `"Smith Johnson"` → false (token-subset requires ≥2 on both sides).
- Empty-side guard: `""` vs `"Abhishek Acharya"` → false; both empty → false.
- Whitespace-only guard: `"   "` vs `"Abhishek Acharya"` → false.
- Disjoint: `"Alice Smith"` vs `"Bob Jones"` → false.

**`tests/calicotab.outroundRank.unification.test.ts`** — pins the unification. Tests use the current structured signature (`outroundRank({ roundLabel, roundNumber, isOutround })`); commit 7 introduces its own tests if it lands and simplifies the signature.
- Ordering preserved: `outroundRank({roundLabel:'Grand Final', roundNumber:null, isOutround:true}) > outroundRank({roundLabel:'Final', ...}) > outroundRank({roundLabel:'Semifinal', ...}) > outroundRank({roundLabel:'Quarterfinal', ...}) > outroundRank({roundLabel:'Octofinal', ...}) > outroundRank({roundLabel:'Double Octofinals', ...}) > outroundRank({roundLabel:'Triple Octofinals', ...})`.
- Canonical anchor values (load-bearing for the champion-check rewrite): `outroundRank({roundLabel:'Grand Final', ..., isOutround:true}) === 100`; `outroundRank({roundLabel:'Final', ..., isOutround:true}) === 95`.
- Category-prefixed labels still classify per `classifyOutroundStage` (`'ESL Final'` → `final` rank 95; `'Open Grand Final'` → `grand_final` rank 100). This is the case the original `INGEST_STAGE_RANK` 110-vs-100 "headroom" comment was reacting to — confirm it still works under the unified scale.
- Inround labels (passed with `isOutround:false`) return `-1`.
- Numeric outround fallback: a round with no recognizable stage but `roundNumber:9, isOutround:true` ranks at 9 (per current `outroundRank`).
- Champion-check semantics: a participant with `eliminationReached='Final'` and rank `>= outroundRank({roundLabel:'Final', ...})` is still champion-eligible (regression test for the rewrite).

**`tests/cv.isJudgeParticipant.test.ts`** — pins the 5-signal OR:
- Each individual signal alone → true (one test per signal).
- All-null → false.
- `chairedPrelimRounds: 0` alone → false (the `> 0` guard).
- Empty `roles` array → falls through to other signals.

**`tests/calicotab.pickPrelimRoundCount.test.ts`** — pins the resolution rule:
- `stored=5, max=4` → 5 (stored wins when positive).
- `stored=null, max=4` → 4 (fallback).
- `stored=null, max=null` → null.
- `stored=0, max=4` → 4 (zero is not positive, falls back — matches current `> 0` guard at `buildCvData.ts:236`).
- Both null → null.

### Extended test files

- `tests/calicotab.personMatch.test.ts` — add a case proving `findPersonId` still returns the correct id when called against an index where one entry matches via the new `personNameMatches` predicate. This is the integration check for the `findPersonId` internal refactor in commit 4.
- `tests/judgeStats.classify.test.ts` — add `normalizeStageLabel` tests after the function moves into `judgeStats.ts` (commit 2). Existing `parseNav` tests that exercise the function via re-export should continue to pass.
- `tests/cv.test.ts` — verify there is a case covering a participant who is *only* a judge (has `lastOutroundChaired` set, no `roles=['judge']` row). If absent, add one. This is the integration regression check for commit 5.

### Watch-items

The inlined `matchesName` in `ingest.ts:1434` has an explicit early return when either `knownPersonName` or `wantedNorm` is empty (cited at L1428–1430). The new `personNameMatches` contract makes this behavior explicit (returns `false` on empty either side). The empty-side test in `personNameMatches.test.ts` must exist in commit 1 *before* the inlined matcher is deleted in commit 4.

The category-prefixed final case is the only one where the deleted 110-vs-100 "headroom" gap could materially matter. The `outroundRank.unification.test.ts` case for `'ESL Final'` vs `'Open Grand Final'` is the proof that this still works under the unified scale (because `classifyOutroundStage` correctly buckets them into `final` vs `grand_final` *before* the rank lookup, so the rank-table gap was never the load-bearing mechanism).

## Rollback

Each commit is independently revertable. If a commit subtly changes behavior despite passing the test gate, `git revert <sha>` restores the inlined copy and the commit-1 test will catch the regression on the next CI run. Branch-level rollback is `git reset --hard` to before commit 1 — no schema changes to undo, no migrations to reverse.

## Risk

**Low.** Pure refactor backed by behavior-preservation tests written before any deletion. The largest theoretical risk is a subtle behavioral quirk in an inlined copy that the canonical doesn't replicate; the commit-1 test suite is designed to catch exactly this. No DB schema change, no PARSER_VERSION bump, no user-visible behavior change intended.

## Verification

- `npm test` green after every commit.
- `npm run lint` green after every commit.
- `npm run typecheck` green after every commit.
- Manual: trigger a re-ingest of a known tournament in a dev environment after the branch lands, confirm the rendered CV is unchanged.

## Cross-references

- Diagnosis: in-conversation review (2026-05-22), no committed artifact.
- Next sub-projects (deferred): ingest pipeline decomposition; parser Vue/cheerio collapse; persist what buildCvData derives; replace `new Function` server-side eval.
- CLAUDE.md rules honored: no `PARSER_VERSION` bump, no queue lock-order changes, no new state-management/ORM/test-framework introductions, no retroactive TDD of already-stable components beyond the targeted behavior-preservation tests this refactor requires.
