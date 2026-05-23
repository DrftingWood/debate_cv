# `ingest.ts` Pipeline Decomposition — Design Spec

**Date:** 2026-05-23
**Status:** Approved, ready for plan-writing
**Type:** Refactor (no behavior change, no schema, no `PARSER_VERSION` bump)
**Subsystem:** `lib/calicotab/ingest.ts` + new `lib/calicotab/judgeAggregates.ts`

## Goal

Two behavior-preserving refactors in one spec:

1. **Decompose `ingestPrivateUrl`** — the 820-LOC orchestrator at `lib/calicotab/ingest.ts:50-873` — into a slim top-level function (~30 lines) plus 6 named, typed phase functions defined below it. Same control flow, same error surface, same data written — just named seams instead of one monolithic function.
2. **Dedupe the 2 judge writers** — `recordJudgeRoundsFromLanding` and `recordJudgeRoundsFromRoundResults` — by extracting a shared `computeJudgeAggregates(rounds)` helper plus a `writeJudgeParticipantRole(tx, ...)` writer. Single source of truth for the chairedPrelims / deepestChaired / deepestPaneled semantics.

## Motivation

`ingest.ts` is 1551 LOC. The single biggest readability problem is `ingestPrivateUrl`, which crams six distinct phases (landing fetch + cache check + tab fetches + parsing + the big write transaction + post-tx writes) into one function. Reading the file means tracking ~6 different concerns interleaved across hundreds of lines. The 820-LOC function is a pain to navigate, modify carefully, or hand to a reviewer.

The two judge writers (`recordJudgeRoundsFromLanding` at L1212, `recordJudgeRoundsFromRoundResults` at L1412) each independently compute the same three aggregates (`chairedPrelims`, `deepestChaired`, `deepestPaneled`) over a list of judge rounds, with slight signature differences that have nothing to do with the aggregate logic. Bug fixes to either path have had to land in both places; existing tests cover them only indirectly through full ingest fixtures.

The canonical-mappings spec (`docs/superpowers/specs/2026-05-22-canonical-mappings-design.md`) explicitly deferred *"Restructuring the three near-identical judge writers in ingest.ts. Deferred to ingest decomposition."* (The third writer, `recordAllJudgeAssignmentsFromRoundResults`, was deleted as part of sub-project 5; the duplication-of-two remains.)

This is sub-project 9. Scope was narrowed during brainstorming to these two behavior-preserving refactors; the roles-table-authoritative `isJudge` work (which would need backfill SQL + a `PARSER_VERSION` bump) is deferred to a hypothetical sub-project 9b.

## Design choice: structural clarity over file shrinkage

`ingest.ts` will stay roughly the same size after the decomposition (~1500 LOC, give or take). The win is not byte deletion — it's that the file's outer shape becomes legible:

```
ingestPrivateUrl  (top, ~30 lines)
  ├─ loadLandingAndFingerprint
  ├─ checkCacheFreshness
  ├─ fetchAndParseTabs
  ├─ recordPipelineParserRun
  ├─ checkRegressionGuard
  ├─ preCommitPeopleAndBuildIndex
  ├─ writeIngestTransaction
  └─ finalizePostTransaction
```

…instead of one 820-LOC blob. Each phase function is in scope ~100–360 LOC, large enough that further extraction is overkill but small enough that a reader can hold one in their head.

Two alternative approaches were considered and rejected during brainstorming:

- **Extract each phase into its own file under `lib/calicotab/ingest/`.** Would fragment the workflow across 7 files; the cross-phase types would need to be hoisted to a shared module. The codebase uses flat `lib/calicotab/` layout (per CLAUDE.md), so single-file with clear seams matches the project's style.
- **Pass a single mutable `IngestContext` object between phases.** More JavaScript-idiomatic but obscures the data flow — TypeScript can't easily catch "phase 3 forgot to set field X that phase 5 needs." Explicit returns with named types make the contracts checkable.

## In scope

### Part 1 — Orchestrator decomposition

1. **Top-level `ingestPrivateUrl`** becomes ~30 lines:

   ```typescript
   export async function ingestPrivateUrl(
     url: string,
     userId: string,
     options: { force?: boolean } = {},
   ): Promise<IngestResult> {
     const loaded = await loadLandingAndFingerprint(url, userId);
     const cacheCheck = await checkCacheFreshness(loaded, userId, options);
     if (cacheCheck.kind === 'cache-hit') return cacheCheck.result;

     const fetched = await fetchAndParseTabs(loaded);
     await recordPipelineParserRun(loaded, fetched);
     if (fetched.fetchLevelFailures.length > 0) {
       throw new Error(
         `Aborting ingest: ${fetched.fetchLevelFailures.length} tab fetch(es) failed — ` +
           fetched.fetchLevelFailures.map((w) => w.slice(0, 120)).join('; '),
       );
     }

     const guarded = await checkRegressionGuard(loaded, fetched, userId, options);
     if (guarded.kind === 'regression-blocked') return guarded.result;

     const persons = await preCommitPeopleAndBuildIndex(loaded, fetched);
     const txResult = await writeIngestTransaction(loaded, fetched, persons);
     return finalizePostTransaction(loaded, fetched, persons, txResult, userId);
   }
   ```

2. **Phase 1 — `loadLandingAndFingerprint(url, userId)`** (~120 LOC). Inputs: url, userId. Performs URL normalization, `urlVariants`, `DiscoveredUrl.findFirst` for `privateUrlSentAt`, FetchSession creation, landing fetch via `fetchHtmlWithProvenance`, snapshot parse via `parsePrivateUrlPage`, landing-warnings collection, fingerprint computation (with legacy fallback), existing-tournament lookup. Throws on landing fetch HTTP failure. Returns a typed object containing every value the later phases need: `normalized`, `urlVariants`, `parsedUrl`, `tournamentSlug`, `fetchSession`, `landingDoc`, `landingHtml`, `snapshot`, `fetchWarnings` (mutable buffer), `landingWarnings`, `privateUrlSentAt`, `tournamentFingerprint`, `existing`, `parseStart`, `year`.

3. **Phase 2 — `checkCacheFreshness(loaded, userId, options)`** (~80 LOC). Inputs: phase-1 output, userId, options. Performs freshness window check, `isLatestParserRun(landingDoc.sourceDocumentId)`, cache-stale check via nav round count vs stored TeamResult round count. On fresh + parser-up-to-date + not-stale, runs `recordParserRun` for the cache-hit path, calls `linkRegistrationPerson`, runs `recordJudgeRoundsFromLanding` + `recordSpeakerRoundsFromLanding` for the linked person, updates DiscoveredUrl, returns `{ kind: 'cache-hit', result: IngestResult }`. Else returns `{ kind: 'miss' }`. The cache-hit branch is unchanged behavior — same actions, same return shape.

4. **Phase 3 — `fetchAndParseTabs(loaded)`** (~140 LOC). Inputs: phase-1 output (uses fetchSession, navigation, landingHtml, fetchWarnings buffer). Builds the `fetchTab` and `fetchRound` helper closures (which push into `fetchWarnings` on HTTP failures), launches the parallel tab+round+break fetches, calls `parseTeamTab`/`parseSpeakerTab`/`parseParticipantsList`/`parseRoundResults`/`parseBreakPage`, emits `diagnoseVueData` warnings for empty parses, merges landing-card participants into the participants list, derives `tournamentName`, `totalParticipants`, `totalTeams`, `parsedPrelimCount`, `prelimRoundCount`, `format`, `teamBreakRankByTeam`. Returns a typed object with: `teamRows`, `speakerRows`, `mergedParticipantRows`, `rounds`, `breakRows`, `tournamentName`, `totalParticipants`, `totalTeams`, `prelimRoundCount`, `format`, `teamBreakRankByTeam`, `fetchLevelFailures` (subset of `fetchWarnings` starting with `fetch:`).

5. **Phase 4 — `recordPipelineParserRun(loaded, fetched)`** (~12 LOC). Just the `recordParserRun` call after parses are done. Called between phase 3 and the fetch-failure throw in the orchestrator.

6. **Phase 5 — `checkRegressionGuard(loaded, fetched, userId, options)`** (~50 LOC). Inputs: loaded + fetched + userId + options. Performs the post-parse regression-guard check (teams/participants/ranks dropped >50%). On regression detected: emits Sentry warning, calls `linkRegistrationPerson` for the URL owner, updates DiscoveredUrl, returns `{ kind: 'regression-blocked', result: IngestResult }`. Else returns `{ kind: 'proceed' }`.

7. **Phase 6 — `preCommitPeopleAndBuildIndex(loaded, fetched)`** (~30 LOC). Gathers every person name across `speakerRows`, `mergedParticipantRows` (adjudicators), `rounds[].judgeAssignments[]`, and `loaded.snapshot.registration.personName`. Calls `preCommitPersons`. Builds `personMatchIndex` and the `lookupPersonId` closure. Returns `{ personIdByNormalized, personMatchIndex, lookupPersonId }`.

8. **Phase 7 — `writeIngestTransaction(loaded, fetched, persons)`** (~360 LOC). The body that's currently inside `prisma.$transaction(async (tx) => { … })` becomes the body of this function (still wrapped in `prisma.$transaction` internally, called via `withDeadlockRetry`). Same advisory lock, same tournament upsert, same conditional `prepareTournamentWideRefresh`, same team-results loop, same per-round team-results loop, same EliminationResult outround writes, same speakers loop with `primaryTeamByPerson` resolution and `speakerRoundScoreCreates` collection, same adjudicator roster loop, same in-transaction call to `recordJudgeRoundsFromRoundResults` (which itself does work outside its own transaction — preserved). Returns `{ tournament, speakerRoundScoreCreates, linkedPersonId, claimedPersonId, claimedPersonName, isLikelySpeaker, judgeDiagnosticFromLanding, judgeDiagnosticFromRoundResults }`.

9. **Phase 8 — `finalizePostTransaction(loaded, fetched, persons, txResult, userId)`** (~80 LOC). Bulk `speakerRoundScore.createMany({ skipDuplicates: true })`, the post-tx call to `recordJudgeRoundsFromLanding` + `recordSpeakerRoundsFromLanding` for the linked person, DiscoveredUrl updateMany, IngestResult assembly. Returns the final `IngestResult`.

10. **Helper functions** (`inferTournamentFormat`, deadlock helpers, `isLatestParserRun`, `preCommitPersons`, `prepareTournamentWideRefresh`, `linkRegistrationPerson`, `recordJudgeRoundsFromLanding`, `recordSpeakerRoundsFromLanding`, `recordJudgeRoundsFromRoundResults`) **stay where they are**. The phase functions call them as before.

### Part 2 — Judge writer dedup

11. **New file `lib/calicotab/judgeAggregates.ts`** (~50 LOC). Exports:

    ```typescript
    export type JudgeRound = {
      stage: string;
      role: 'chair' | 'panellist' | 'trainee';
      roundNumber: number | null;
    };

    export type JudgeAggregates = {
      chairedPrelims: number;
      deepestChaired: string | null;
      deepestPaneled: string | null;
    };

    export function computeJudgeAggregates(rounds: JudgeRound[]): JudgeAggregates;

    export async function writeJudgeParticipantRole(
      tx: Prisma.TransactionClient | typeof prisma,
      tournamentId: bigint,
      personId: bigint,
      aggregates: JudgeAggregates,
      mergeMode: 'overwrite' | 'fillNullsOnly',
    ): Promise<void>;
    ```

    `computeJudgeAggregates` is pure: calls `getInroundsChairedCount` on the rounds, filters outrounds (`roundNumber == null`), ranks them by `outroundRankStrict(stage)`, picks deepest chair and deepest non-chair (panellist OR trainee). Trainees group with panellists — matches `recordJudgeRoundsFromLanding`'s current behavior (which already includes trainees in `deepestPaneled`); `recordJudgeRoundsFromRoundResults`'s input never carries trainees, so adding trainee to the filter is a no-op for that path.

    `writeJudgeParticipantRole` does the TournamentParticipant upsert + ParticipantRole 'judge' upsert. `mergeMode = 'overwrite'` always sets the three fields (chairedPrelims/deepestChaired/deepestPaneled); `mergeMode = 'fillNullsOnly'` reads the existing row first and only writes a field if the existing value is null. The Landing path uses `overwrite` (the Debates card is authoritative when present); the RoundResults path uses `fillNullsOnly` (it only fires when Landing already ran or when Landing produced nothing).

12. **`recordJudgeRoundsFromLanding`** (L1212): replace the inline `chairedPrelims` / `outrounds` / `ranked` / `deepestChaired` / `deepestPaneled` computation block with `const aggregates = computeJudgeAggregates(adjRounds);`. Replace the inline `tournamentParticipant.upsert` + `participantRole.upsert` block with `await writeJudgeParticipantRole(tx, tournamentId, personId, aggregates, 'overwrite');`. The function shrinks by ~30 LOC and the aggregate logic is no longer inline.

13. **`recordJudgeRoundsFromRoundResults`** (L1412): same replacement. The inline `chairedPrelims` / `outrounds` / `ranked` / `deepestChaired` / `deepestPaneled` block becomes `const aggregates = computeJudgeAggregates(hits.map(h => ({ stage: h.stage, role: h.role, roundNumber: h.roundNumber })));`. The inline `existing` read + selective `update` builder + `tournamentParticipant.upsert` + `participantRole.upsert` block becomes `await writeJudgeParticipantRole(prisma, tournamentId, personId, aggregates, 'fillNullsOnly');`. Function shrinks by ~25 LOC.

14. **New test file `tests/calicotab.judgeAggregates.test.ts`** (~80 LOC). Cases:
    - empty rounds → `{ chairedPrelims: 0, deepestChaired: null, deepestPaneled: null }`
    - prelim-only rounds (roundNumber != null) → chairedPrelims counted correctly, both deepest fields null
    - one chair outround + one panellist outround → deepestChaired = chair's stage, deepestPaneled = panellist's stage
    - trainees count toward deepestPaneled (regression test for the landing-path behavior)
    - deepest stage wins by `outroundRankStrict` (Grand Final > Semifinals)
    - multiple chair outrounds → returns the deepest one only

## Explicitly out of scope

- **No `PARSER_VERSION` bump.** Behavior-preserving refactor; bumping would force cache invalidation across all users for no observable benefit.
- **No roles-table-authoritative `isJudge`.** Deferred to a hypothetical sub-project 9b. Touches `lib/cv/roleClassification.ts:isJudgeParticipant` (which has a 5-signal OR), needs a SQL backfill ensuring every is-judge-by-OR participant has a `ParticipantRole.role = 'judge'` row, and needs the `PARSER_VERSION` bump. Substantial work for an arguably purity-not-function gain.
- **No further dedup beyond the 2 judge writers.** `recordSpeakerRoundsFromLanding` is structurally similar but operates on a different shape (`SpeakerRound[]` instead of judge rounds) and writes a different field (`eliminationReached`). Lumping it in would require a more abstract helper that doesn't earn its complexity.
- **No directory of phases under `lib/calicotab/ingest/`.** Keep ingest.ts as one file; matches the project's flat layout.
- **No schema change.** No queue / lock-order change. No new dependency.
- **No retroactive TDD of `ingestPrivateUrl` itself.** The phase functions don't get dedicated unit tests — they're internal to `ingest.ts` and their contract is implicitly tested by the end-to-end behavior of `ingestPrivateUrl`. Only `judgeAggregates.ts` gets a dedicated test file (it's a new public helper with cleanly-testable pure logic).
- **No `IngestContext` mutable-state object.** Explicit typed returns between phases.

## File layout

| File | Change |
|---|---|
| `lib/calicotab/ingest.ts` | Major restructure: top-level `ingestPrivateUrl` becomes ~30 lines; 8 new phase functions defined below it. Existing helpers (deadlock retry, `preCommitPersons`, `prepareTournamentWideRefresh`, `linkRegistrationPerson`, `recordJudgeRoundsFromLanding`, `recordSpeakerRoundsFromLanding`, `recordJudgeRoundsFromRoundResults`) stay in place; the latter two and one of the landing writers receive ~30 LOC trim each via the judgeAggregates extraction. Net file size: roughly unchanged (~1500 LOC). |
| `lib/calicotab/judgeAggregates.ts` | **+ NEW** ~50 LOC. Exports `JudgeRound`, `JudgeAggregates`, `computeJudgeAggregates`, `writeJudgeParticipantRole`. |
| `tests/calicotab.judgeAggregates.test.ts` | **+ NEW** ~80 LOC. 6 test cases covering the aggregate-computation contract. |

## Behavior preservation

The decomposition is mechanical: every call, every Prisma operation, every warning push, every return path that exists today is preserved in some phase function. The orchestrator threads the same data in the same order. Existing tests (478 currently passing) must all continue to pass — that's the load-bearing contract.

The judge dedup is also behavior-preserving:

- The Landing path's existing behavior (overwrite chairedPrelimRounds / lastOutroundChaired / lastOutroundPaneled with computed values) is captured by `writeJudgeParticipantRole(..., 'overwrite')`.
- The RoundResults path's existing behavior (read existing values, only write a field if existing is null) is captured by `writeJudgeParticipantRole(..., 'fillNullsOnly')`. The reviewer should verify the implementation reads the existing row inside the writer (not stale-snapshot before the writer is called).
- The aggregate computation is identical: `getInroundsChairedCount(rounds.map(r => ({ stage, panelRole: r.role })))` for chairedPrelims; outround filter by `roundNumber == null`; rank by `outroundRankStrict(stage)`; deepest chair, deepest panellist (or trainee).
- The trainee-handling case (Landing includes them in `deepestPaneled`; RoundResults' inputs never have them) is captured by including trainees in the filter unconditionally — a no-op for the RoundResults path's input shape.

## Verification

- `npm test` — full suite green: existing 478 cases + ~6 new judgeAggregates cases ≈ 484 passing.
- `npm run lint` — clean (0 errors; the 1 baseline warning in `scripts/test-scrape.mjs:16` stays).
- `npm run typecheck` — clean. The phase functions' typed signatures should catch any data-flow mistakes (e.g., a phase forgetting to forward a field its successor needs).
- Manual: env-gated live smoke test (`tests/__smoke.live.test.ts`) against a real Tabbycat URL. If the smoke still completes end-to-end with the expected shape, the decomposition didn't break the pipeline.
- Manual: spot-check a re-ingest in dev against an existing tournament — confirm cache-hit path, regression-guard path, and full-refresh path all still return the same `IngestResult` shape.

## Risk

- **Phase signatures are the biggest risk surface.** Each boundary must hand off the right inputs. TypeScript catches type-shape mismatches; behavioral mismatches (e.g., a closure that captured something now needs to be passed explicitly) are caught by the existing tests. If the test suite passes, the decomposition is sound.
- **Mutable `fetchWarnings` buffer** crosses phase boundaries by reference. This is a minor wart — pure-FP design would have each phase return its own warnings and the orchestrator concat them. Keeping the buffer mutable is the lower-risk choice because every existing `.push()` call site keeps working unchanged.
- **The `writeIngestTransaction` phase still owns 360 LOC and a long `prisma.$transaction` body.** Could be further sub-decomposed (write team / write speakers / write judges) but each sub-helper would need access to `tx` and to upstream-derived state; passing them through more layers risks losing locality. The named single function is the right balance for this sub-project; further decomposition can be a 9c if it ever feels needed.
- **Judge dedup behavior preservation** depends on the `fillNullsOnly` mode reading the existing row correctly. The current RoundResults code reads `existing` via `tournamentParticipant.findUnique` before the upsert; the helper must do the same (and the test should pin this — at least one case where the existing row already has non-null values and the writer leaves them untouched).

## Cross-references

- Previous sub-projects: 8 in `docs/superpowers/specs/`. This is sub-project 9.
- Items deferred from: `docs/superpowers/specs/2026-05-22-canonical-mappings-design.md` § "Explicitly out of scope", items "Restructuring the three near-identical judge writers in ingest.ts" and (partially) "roles-table-authoritative isJudge". The latter is further deferred to sub-project 9b per the brainstorming session.
- CLAUDE.md rules honored: no `PARSER_VERSION` bump, no queue lock-order change, no schema change, no new dependency, no state-management / ORM / test-framework introduction, no retroactive TDD of stable behavior beyond the one new test file for the new public helper.
