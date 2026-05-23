# Persist Derived Speaker Rank — Design Spec

**Date:** 2026-05-23
**Status:** Approved, ready for plan-writing
**Type:** Refactor + schema migration with backfill (no behavior change at the read boundary)
**Subsystem:** `lib/cv/buildCvData.ts` (read), `lib/calicotab/ingest.ts` (write), `prisma/schema.prisma` (+1 column)

## Goal

Move the "speaker rank by total score" fallback derivation out of the per-request `buildCvData` read path and into ingest-time persistence. Adds a nullable `speakerRankOpenDerived` column on `TournamentParticipant`, populated at ingest and backfilled for legacy rows in the same Prisma migration. Eliminates one tournament-scope `findMany` + sort + position-assignment loop from every CV page view and CSV export.

## Motivation

`buildCvData` is called from `app/cv/page.tsx` (personal CV), `app/u/[slug]/page.tsx` (public CV), and `app/api/cv/export/route.ts` (CSV) — all three are `force-dynamic`, so the function runs on every request. The block at `lib/cv/buildCvData.ts:262–291` issues a tournament-scope `SELECT … ORDER BY speakerScoreTotal DESC`, iterates the result to assign `ROW_NUMBER`-style positions, and writes them into a per-tournament Map. The result is purely a function of the participant rows that were already written at ingest time, so deriving it on every read is wasted work.

The canonical-mappings spec (`docs/superpowers/specs/2026-05-22-canonical-mappings-design.md`) explicitly deferred this: *"Removing the read-time `derivedRankByTournament` speaker-rank fallback at `buildCvData.ts:259–282`. Deferred to the 'persist what buildCvData derives' sub-project."*

This is sub-project 7 of the session's diagnosis backlog. Scope was narrowed during brainstorming to **only** this deferred item — other cheap cousins (effective `prelimRoundCount`, `wonTournament`, EUDC `eliminationReachedByCategory`) are left for a later pass.

## In scope

1. **Schema** — add one column on `TournamentParticipant` in `prisma/schema.prisma`:

   ```prisma
   speakerRankOpenDerived  Int?
   ```

   Sits alongside the existing `speakerRankOpen` / `speakerRankEsl` / `speakerRankEfl` parsed columns. Nullable: rows whose `speakerScoreTotal` is null (or who have no `speaker` role) stay null forever.

2. **Migration** — single migration that ALTERs the table and backfills existing rows in one transactional SQL block. Backfill uses Postgres `ROW_NUMBER()` window function so it executes server-side with no app code involvement:

   ```sql
   ALTER TABLE "TournamentParticipant"
     ADD COLUMN "speakerRankOpenDerived" INT;

   UPDATE "TournamentParticipant" tp
   SET "speakerRankOpenDerived" = sub.r
   FROM (
     SELECT
       tp2.id,
       ROW_NUMBER() OVER (
         PARTITION BY tp2."tournamentId"
         ORDER BY tp2."speakerScoreTotal" DESC, tp2.id ASC
       ) AS r
     FROM "TournamentParticipant" tp2
     WHERE tp2."speakerScoreTotal" IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM "ParticipantRole" pr
         WHERE pr."tournamentParticipantId" = tp2.id AND pr.role = 'speaker'
       )
   ) sub
   WHERE tp.id = sub.id;
   ```

   The `id ASC` secondary sort makes the rank assignment deterministic on ties — the deleted JS loop was non-deterministic on ties because it followed Prisma's row order, which is itself unordered on ties in Postgres.

3. **Ingest write** — `lib/calicotab/ingest.ts`. After the speaker-upsert loop completes inside the tournament-write transaction (the block ending at L665), add one `tx.$executeRaw` UPDATE that recomputes `speakerRankOpenDerived` **for this tournament only**. Same window-function form as the backfill, scoped by `WHERE "tournamentId" = ${t.id}`. Runs in the same transaction so a failed UPDATE rolls back the whole tournament write — no half-state.

   No per-row update; one SQL statement covers all speakers in the tournament at once.

4. **Read simplification** — `lib/cv/buildCvData.ts`:

   - Delete the entire `derivedRankByTournament` block at L262–291 (the comment, the `findMany`, the loop). Net −30 LOC.
   - Add `speakerRankOpenDerived: true` to the `myParticipations` `select` so the read path has the column available without a second query.
   - Change the rank read at L560–563 from:

     ```typescript
     speakerRankOpen:
       p.speakerRankOpen ??
       derivedRankByTournament.get(tid)?.get(p.personId) ??
       null,
     ```

     to:

     ```typescript
     speakerRankOpen: p.speakerRankOpen ?? p.speakerRankOpenDerived ?? null,
     ```

5. **Tests** — additions, not retroactive coverage:

   - `tests/ingest.speakerRankDerived.test.ts` (new): seed a tournament with 3 speakers having distinct `speakerScoreTotal` values, invoke whichever ingest entry point currently writes participants, assert `speakerRankOpenDerived` is 1/2/3 on the three rows. A second case: 2 speakers with identical `speakerScoreTotal` resolve to ranks N and N+1 in `id ASC` order (deterministic tiebreak). A third case: speakers with `speakerScoreTotal = null` stay `null` (not 0, not last).
   - Update one existing case in `tests/cv.test.ts` so a participant whose `speakerRankOpen` is null but `speakerRankOpenDerived = 7` flows through `buildCvData` and emerges as `CvSpeakerRow.speakerRankOpen === 7`. This is the read-path equivalence check.

## Explicitly out of scope

- **No `PARSER_VERSION` bump.** The derivation logic is unchanged — same `ORDER BY speakerScoreTotal DESC` filter, same "rows with speakerScoreTotal IS NOT NULL and a speaker role" predicate, same 1-based output. Only the location of computation changes. Tiebreak is now deterministic by `id ASC` where it previously depended on Postgres row order, which is a strict improvement (no current consumer compares ranks across reads).
- **No other persisted derivations.** Cheap cousins discussed in brainstorming (`prelimRoundCount` effective value, `wonTournament` boolean, EUDC `eliminationReachedByCategory`, highlights, teammates, myName-by-tournament) are out of scope for this sub-project. They can be a sub-project 7a or later.
- **No deletion of `mergeSpeakerCvSignals`, `buildTeamRankLookup`, `computeSpeakerAvg`, or other CV-side aggregators.** They derive from already-persisted fields and don't need an ingest hop.
- **No new dependency.** Prisma 6 + Postgres window functions are sufficient.
- **No CV-side query change beyond adding the column to `select`.** Same set of `findMany` calls.
- **No retroactive TDD** of already-stable code per CLAUDE.md.

## File layout

| File | Change |
|---|---|
| `prisma/schema.prisma` | **+1 line** in `TournamentParticipant`: `speakerRankOpenDerived  Int?` |
| `prisma/migrations/<ts>_speaker_rank_open_derived/migration.sql` | **+ NEW** ~12 lines: `ALTER TABLE` + `UPDATE … ROW_NUMBER() OVER (…)` backfill |
| `lib/calicotab/ingest.ts` | **+ ~8 LOC** inside the speaker-write transaction (after L665, before the adjudicator loop): one `tx.$executeRaw` UPDATE bounded to `WHERE "tournamentId" = ${t.id}`. Includes a short comment explaining why the recompute is full-tournament-scope (cheaper and simpler than tracking incremental rank changes when a single speaker's total updates). |
| `lib/cv/buildCvData.ts` | **−30 LOC** delete the derivation block (L262–291). **+1 line** add `speakerRankOpenDerived: true` to the `myParticipations.select`. **−2 LOC** simplify the rank read at L560–563 to `p.speakerRankOpen ?? p.speakerRankOpenDerived ?? null`. Net −31 LOC. |
| `tests/ingest.speakerRankDerived.test.ts` | **+ NEW** ~60 LOC: 3 cases (distinct totals, tie, null total). |
| `tests/cv.test.ts` | **~5 LOC change** existing fixture so one participant exercises the persisted-derived path. |

## Behavior preservation

The output of `buildCvData` for any existing user is identical pre/post-migration:

- For every speaker participant with `speakerRankOpen != null`: read path returns `speakerRankOpen` exactly as today (the `??` chain short-circuits on the non-null value).
- For every speaker participant with `speakerRankOpen == null AND speakerScoreTotal != null AND has speaker role`: backfill sets `speakerRankOpenDerived` to the same `ROW_NUMBER()` rank the deleted JS block produced. The backfill SQL and the deleted JS loop walk the exact same set of rows in the exact same primary sort order; the only difference is the new deterministic tiebreak (`id ASC`), which only affects ordering when `speakerScoreTotal` ties — a case the JS loop also ranked, just non-deterministically.
- For every speaker participant with `speakerRankOpen == null AND speakerScoreTotal == null`: stays `null` everywhere. The JS block excluded these rows from the sort (the `speakerScoreTotal: { not: null }` `where` clause); the backfill SQL has the same `WHERE speakerScoreTotal IS NOT NULL`.
- Adjudicator-only participants (no `speaker` role row): stay `null`. Both the JS block and the backfill SQL gate on `roles: { some: { role: 'speaker' } }` / `EXISTS … pr.role = 'speaker'`.

No user-visible CV row changes shape, value, or ordering except where ties existed and now resolve deterministically.

## Verification

Run after the plan completes:

- `npm test` — full suite green, including the new `ingest.speakerRankDerived.test.ts` and the updated `cv.test.ts` case.
- `npm run lint` — clean (or unchanged from baseline; 2 warnings tolerated).
- `npm run typecheck` — clean. The new `speakerRankOpenDerived` field appears in the Prisma client types after `prisma generate`; `select: { ... speakerRankOpenDerived: true }` propagates through to `p.speakerRankOpenDerived` in `buildCvData`.
- Manual: in a dev Postgres, before/after the migration check `SELECT id, "speakerRankOpen", "speakerRankOpenDerived" FROM "TournamentParticipant" WHERE "tournamentId" = <small tournament> ORDER BY "speakerScoreTotal" DESC NULLS LAST;` — every row with a non-null total has a non-null derived rank starting at 1.
- Vercel deploy: the migration step in `npm run build` (`scripts/migrate-if-configured.mjs`) runs the new migration on first deploy. With the Vercel pipeline freshly green from the prior commit (`6edce14`, dropped `pnpm-lock.yaml`), this is the next migration to land.

## Risk

- **Backfill on large data.** Production DB row count for `TournamentParticipant` is bounded by `n_users × n_tournaments × n_participants_per_tournament`. With ~real users and ~16 tab fetches per ingest, the partition count is moderate and the `ROW_NUMBER()` window function over `(tournamentId, speakerScoreTotal)` is index-friendly. The migration runs once on deploy; if it ever became slow enough to time out, the backfill can be split out of the migration into a manual one-off (acceptable fallback — the new code path still works on freshly-ingested tournaments without backfill, just with `derivedRankByTournament = null` on legacy rows; the read path would degrade to "show null where parser missed it" on legacy rows only).
- **Determinism change on ties.** A speaker tied with a teammate on `speakerScoreTotal` who previously got rank `N+1` may now get rank `N`, and vice versa. No consumer compares this rank across reads; no concrete user-visible impact identified.
- **Transactional consistency in ingest.** The `tx.$executeRaw` runs after the upsert loop and before the transaction commits. If the SQL string composition ever loses the `WHERE "tournamentId" = ${t.id}` clause (typo), it would recompute ranks across the entire table inside that transaction — slow + a lot of dead writes, but still correct (the result is the same). The plan must call out this exact-shape `WHERE` requirement so the engineer doesn't accidentally drop it.

## Cross-references

- Previous sub-projects: 6 in `docs/superpowers/specs/` (canonical-mappings, dedupe-brace-counters, replace-new-function-eval, proto-key-rejection, extract-all-judges-decision, fetch-session-lifetime). This is sub-project 7.
- Item deferred from: `docs/superpowers/specs/2026-05-22-canonical-mappings-design.md` § "Explicitly out of scope", item 2.
- Adjacent unstarted sub-projects: 8 (parser Vue/cheerio collapse) and 9 (ingest.ts pipeline decomposition).
- CLAUDE.md rules honored: no `PARSER_VERSION` bump, no queue lock-order change, no new state-management / ORM / test framework, no retroactive TDD of stable code beyond the two targeted behavior-preservation tests this change requires. Migration adds a column with backfill — the kind of schema change CLAUDE.md anticipates ("Prisma migration drops four unused columns" in commit `2f10f0c` is precedent for migrations landing alongside code changes).
