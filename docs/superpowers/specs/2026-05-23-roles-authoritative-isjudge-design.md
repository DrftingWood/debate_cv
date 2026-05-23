# Roles-Authoritative `isJudge` — Design Spec

**Date:** 2026-05-23
**Status:** Approved, ready for plan-writing
**Type:** Behavioral refactor — schema migration with backfill + `PARSER_VERSION` bump
**Subsystem:** `lib/cv/roleClassification.ts` + SQL backfill + version bump

## Goal

Make `ParticipantRole.role = 'judge'` the single source of truth for "is this participant a judge in this tournament" — replacing the 5-signal OR currently in `lib/cv/roleClassification.ts:isJudgeParticipant`. Backfill ensures every legacy participant that was is-judge-by-OR also has a `'judge'` role row; new ingests already write the role via `writeJudgeParticipantRole` (committed in sub-project 9). Bump `PARSER_VERSION` so cached parses revalidate against the new invariant.

## Motivation

Sub-project 9's `judgeAggregates.ts:writeJudgeParticipantRole` always writes a `'judge'` role row alongside the participant's judge fields, so every new ingest creates that role. The 5-signal OR in `isJudgeParticipant` is now a temporary compatibility layer — it exists only because legacy data may have judge fields set without the role row. Once backfill closes that gap, the OR is dead code; replacing it with a single-signal check simplifies the invariant and lets future code (and future readers) treat `roles` as authoritative.

The canonical-mappings spec (`docs/superpowers/specs/2026-05-22-canonical-mappings-design.md`) explicitly deferred this work: *"roles-table-authoritative isJudge — touches three judge writers in ingest.ts, needs backfill SQL, needs PARSER_VERSION bump. Deferred to the ingest decomposition sub-project."* This is the deferred work, now post-sub-project 9.

## In scope

1. **SQL migration** at `prisma/migrations/20260523130000_roles_authoritative_isjudge/migration.sql`:

   ```sql
   -- Backfill ParticipantRole 'judge' rows for legacy participants who had
   -- judge signals set but no role row. Sub-project 9b makes the role table
   -- authoritative; this migration closes the legacy gap before the read
   -- path stops checking the secondary signals.
   INSERT INTO "ParticipantRole" ("tournamentParticipantId", "role")
   SELECT tp.id, 'judge'
   FROM "TournamentParticipant" tp
   WHERE (
     tp."judgeTypeTag" IS NOT NULL
     OR tp."chairedPrelimRounds" > 0
     OR tp."lastOutroundChaired" IS NOT NULL
     OR tp."lastOutroundPaneled" IS NOT NULL
   )
   AND NOT EXISTS (
     SELECT 1 FROM "ParticipantRole" pr
     WHERE pr."tournamentParticipantId" = tp.id AND pr.role = 'judge'
   );
   ```

   `INSERT ... WHERE NOT EXISTS` makes it idempotent across re-runs.

2. **Simplify `lib/cv/roleClassification.ts:isJudgeParticipant`** — replace the 5-signal OR with a single check on the roles array. Update the JSDoc to reflect the new invariant. The function signature can drop the now-unused field requirements (`judgeTypeTag`, `chairedPrelimRounds`, `lastOutroundChaired`, `lastOutroundPaneled`) and only require `{ roles: ReadonlyArray<{ role: string }> }`.

3. **`PARSER_VERSION` bump** — `lib/calicotab/version.ts` from `'20260501.3'` to `'20260523.0'`. Bumping invalidates cached parses; the next re-ingest for each tournament runs against the new code path.

4. **Update `tests/cv.isJudgeParticipant.test.ts`** — drop test cases that asserted the 5-signal OR variants (judgeTypeTag-only, chairedPrelimRounds-only, etc.) since those signals no longer matter. Keep + expand the role-row-presence-based cases. Note: there are 9 existing tests in that file; ~7 of them test the OR variants and must be deleted or rewritten.

## Behavior preservation

For any participant currently classified as a judge by the 5-signal OR:
- If they have a `'judge'` role row → unchanged classification.
- If they don't have a role row but have a judge signal → backfill creates the role row, then the simplified `isJudgeParticipant` returns true. Same classification result.
- Cache invalidation via `PARSER_VERSION` bump ensures re-ingest produces the same data shape against the new code path.

For participants NOT currently classified as judges (no role, no signals): unchanged — they stay non-judges.

The behavioral guarantee holds AFTER the migration applies. Between deploy of new code and migration apply, there's a brief window where the new code reads legacy data without the backfilled rows; but Prisma migrations run at build time before `next build`, so production never sees that gap. Local dev needs `npm run prisma:migrate:dev` or equivalent.

## Out of scope

- No changes to the judge writers (`recordJudgeRoundsFromLanding`, `recordJudgeRoundsFromRoundResults`) — they already write the role row via `writeJudgeParticipantRole` after sub-project 9.
- No deletion of `judgeTypeTag` / `chairedPrelimRounds` / `lastOutroundChaired` / `lastOutroundPaneled` columns. They still carry useful CV-display data; only their role in classification changes.
- No new test infrastructure.

## File layout

| File | Change |
|---|---|
| `prisma/migrations/20260523130000_roles_authoritative_isjudge/migration.sql` | **+ NEW** ~15 LOC. INSERT WHERE NOT EXISTS backfill. |
| `lib/cv/roleClassification.ts` | **~−20 LOC, +~8 LOC**. Simplify the OR to a single role check; update JSDoc; drop the unused signature fields. |
| `lib/calicotab/version.ts` | **−1 LOC, +1 LOC**. Bump `'20260501.3'` → `'20260523.0'`. |
| `tests/cv.isJudgeParticipant.test.ts` | **~−40 LOC, +~10 LOC**. Drop OR-variant cases; keep+expand role-row-based cases. |

## Verification

- `npm test` — full suite passes (note: some cases in `tests/cv.isJudgeParticipant.test.ts` get deleted; the new total will be lower than 485 minus the dropped cases plus any new ones added).
- `npm run lint` — clean.
- `npm run typecheck` — clean. The signature change of `isJudgeParticipant` should ripple through callers cleanly (Prisma's generated types still provide the `roles` field in any `include: { roles: true }` query).
- Manual: in dev DB, count `TournamentParticipant` rows is-judge-by-OR vs count of `ParticipantRole.role = 'judge'` rows. After migration apply, the two should be equal (or the role count higher if any participant has multiple role rows).
- Deploy: PARSER_VERSION bump triggers cache invalidation; next CV view per user re-fetches.

## Risk

- **Migration runs on prod DB at next deploy.** The INSERT is idempotent and bounded (only touches participants with a judge signal but no role row). On a sized DB (~thousands of TournamentParticipant rows), runtime is ~seconds. If the DB is much larger, the migration is still safe but may slow the build's migrate step.
- **PARSER_VERSION bump invalidates all users' cached parses.** Next CV view per user re-ingests their tournaments. This is the intentional cost of the bump.
- **Behavior change on a participant who somehow has a judge signal but should not be a judge (data corruption).** Backfill makes them a judge per the role row. Acceptable — the OR already classified them as a judge.

## Cross-references

- Previous sub-projects: 10 in `docs/superpowers/specs/` (counting 8b). This is sub-project 9b.
- Deferred from: `docs/superpowers/specs/2026-05-22-canonical-mappings-design.md` § "Explicitly out of scope" item 1.
- Builds on: sub-project 9's `writeJudgeParticipantRole` which made new ingests always write the role row.
- CLAUDE.md rules acknowledged: `PARSER_VERSION` bump IS in scope here (the intentional cost), schema migration adds no columns, no queue lock-order change, no new dependency.
