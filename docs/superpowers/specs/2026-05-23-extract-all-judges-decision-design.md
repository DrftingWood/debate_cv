# Delete Dormant `EXTRACT_ALL_JUDGES` Code — Design Spec

**Date:** 2026-05-23
**Status:** Approved, ready for plan-writing
**Type:** Code removal (no behavior change in production; no schema change; no PARSER_VERSION bump)
**Subsystem:** `lib/calicotab/ingest.ts`

## Goal

Remove the dormant `EXTRACT_ALL_JUDGES` env-flag-gated code path and its associated 119-LOC writer function in `lib/calicotab/ingest.ts`. Resolves the "feature I might want" smell flagged by the original session diagnosis.

## Motivation

`lib/calicotab/ingest.ts:815` reads `process.env.EXTRACT_ALL_JUDGES === 'true'` to conditionally invoke `recordAllJudgeAssignmentsFromRoundResults` (defined at L1543-1661, ~119 LOC). The flag has been off in deployed Vercel env since the function was introduced; the gated path has never been verified against real Tabbycat data; no unit tests exercise it. The comment at L810-814 acknowledges this and asks readers to "gate until verified on real data."

This is the same "feature flag for hypothetical future" smell the diagnosis called out across the codebase. Sub-project 2 (`replace-new-function-eval`) explicitly rejected a similar feature-flag kill-switch by the same reasoning. Symmetric resolution: ship-or-delete; here we choose delete because the gated code has never demonstrably worked end-to-end and rebuilding from scratch with verification baked in from day one is cleaner than promoting unverified code.

## In scope

1. **Delete the `if (process.env.EXTRACT_ALL_JUDGES === 'true')` gate** at `lib/calicotab/ingest.ts:815-821` along with the 5-line explanatory comment block above it at L810-814. ~14 LOC removed.
2. **Delete the `recordAllJudgeAssignmentsFromRoundResults` function** at `lib/calicotab/ingest.ts:1543-1661`. ~119 LOC removed.
3. **Grep-sweep** for any residual references to `EXTRACT_ALL_JUDGES` or the deleted function name in `CLAUDE.md`, `.env.example`, `docs/`, `scripts/`, etc. Remove any that turn up.

Net `ingest.ts` delta: ~−133 LOC. Net branch delta excluding spec/plan docs: ~−133 LOC.

## Explicitly out of scope

- **`JudgeAssignment.source` schema field stays.** Still written by `recordJudgeRoundsFromLanding` (with `'landing'`) and by `recordJudgeRoundsFromRoundResults` (with `'round_results'` for the URL owner's own panels parsed from per-round results pages). The field actively distinguishes leaf data the cache-bust logic needs to selectively clear.
- **`prepareTournamentWideRefresh`'s `where: { source: 'round_results' }` cleanup** at `lib/calicotab/ingest.ts:1089` stays. Still load-bearing for the URL-owner round-results path.
- **`recordJudgeRoundsFromRoundResults`** (the URL-owner path at L1392) is untouched. It writes `round_results` source for the URL owner's panels detected via round-results pages, and it's called unconditionally on every ingest. Different concern.
- **No PARSER_VERSION bump.** Parser output cardinality is unchanged in production because the gated code has been inert in deployed env. Re-parsing a cached snapshot produces identical output before and after. CLAUDE.md's "don't bump casually" rule honored.
- **No schema migration.** Schema fields and indexes used by other writers stay in place.
- **No tests to update.** Grep confirms no test file references `recordAllJudgeAssignmentsFromRoundResults` or `EXTRACT_ALL_JUDGES`.

## File layout

| File | Change |
|---|---|
| `lib/calicotab/ingest.ts` | **−** `EXTRACT_ALL_JUDGES` gate + comment block (L808-821, ~14 LOC). **−** `recordAllJudgeAssignmentsFromRoundResults` function (L1543-1661, ~119 LOC). |
| Anywhere else in the repo with `EXTRACT_ALL_JUDGES` or the deleted function name | Remove residual references if any (grep-sweep before commit). |

## Code change

**Block 1 — at `ingest.ts:808-821` (the gate):**

Current text:
```typescript
  // appeared on a panel, not just the URL owner. Lets users who never had a
  // private URL for a tournament still get their judging history populated
  // when a teammate's URL is ingested. Off by default — enabling at scale
  // means many more JudgeAssignment rows per tournament; gate until verified
  // on real data.
  if (process.env.EXTRACT_ALL_JUDGES === 'true') {
    await recordAllJudgeAssignmentsFromRoundResults(
      rounds,
      tournamentId,
      personIdByNormalized,
    );
  }
```

Delete in full. Adjacent blank lines collapse cleanly.

**Block 2 — at `ingest.ts:1543-1661` (the function body):**

The entire `async function recordAllJudgeAssignmentsFromRoundResults(rounds, tournamentId, personIdByNormalized): Promise<void> { … }` block. Delete in full.

**Sweep:**

Run `grep -rn "EXTRACT_ALL_JUDGES\|recordAllJudgeAssignmentsFromRoundResults" --include="*.ts" --include="*.mjs" --include="*.md" --include="*.env*"` and remove any other hits. Spot-check `.env.example`, `CLAUDE.md`, `vercel.json`.

## Risk

**Effectively zero.** Deleting code that has never run in production. All other writers (`recordJudgeRoundsFromLanding`, `recordJudgeRoundsFromRoundResults`) stay intact and continue to populate `JudgeAssignment` rows for the URL owner's own panels — the 95% case. The deleted function would have credited judges named on other people's panels (the X-ingests-URL-where-Y-judged case), which is a feature we explicitly choose not to ship now.

**Failure mode if I'm wrong about "never ran in production":** if a deployed env var actually was setting `EXTRACT_ALL_JUDGES=true` somewhere (e.g. a forgotten Vercel preview env), then future ingests would stop crediting non-URL-owner judges. Mitigation: deploy → check Vercel env vars panel after the merge → if it was set, decide whether to ship a rebuilt version. Reversible by `git revert`.

## Commit sequence

**Single commit:** `refactor: delete dormant EXTRACT_ALL_JUDGES flag and recordAllJudgeAssignmentsFromRoundResults`.

Atomic — one logical decision. Commit message captures the rationale (dormant since introduction, no test coverage, no real-world verification, infrastructure preserved for a future rebuild) and references this spec.

## Verification

- `npm test`: 466 tests pass (unchanged — no test references the deleted code).
- `npm run lint`: 2 warnings, 0 errors (unchanged — deleting code shouldn't introduce new lint warnings).
- `npm run typecheck`: clean.
- `grep -rn "EXTRACT_ALL_JUDGES\|recordAllJudgeAssignmentsFromRoundResults"` returns zero matches after the commit.

## Rollback

Single commit; `git revert <sha>` restores the gated code. No schema changes to undo, no DB rows to backfill, no migration to reverse.

## Cross-references

- Previous sub-projects: `docs/superpowers/specs/2026-05-22-{canonical-mappings,replace-new-function-eval,dedupe-brace-counters}-design.md`, `docs/superpowers/specs/2026-05-23-proto-key-rejection-design.md`.
- Original session diagnosis flagged `EXTRACT_ALL_JUDGES` as a "ship or delete" item under the "feature I might want" smell.
- The diagnosis ALSO flagged `ParserRun` as a candidate for deletion ("write-only telemetry"). On verification today, that part of the diagnosis was WRONG — `ParserRun` is load-bearing for cache invalidation (`isLatestParserRun`), the admin parser-health dashboard, and the user-facing `/cv/verify` page. It stays.
- CLAUDE.md rules honored: no `PARSER_VERSION` bump, no schema change, no new dependencies, no introduction of state-management / ORM / test framework, no queue lock-order changes.
