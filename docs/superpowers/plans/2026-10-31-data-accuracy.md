# Data Accuracy Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit every tournament with logic checks and user reports, store a score per tournament, and show a database accuracy score in the admin view. Each failed check names the pieces to re-scrape.

**Architecture:** A pure check engine (`lib/audit/checks.ts`) and scorer (`lib/audit/score.ts`) take an `AuditInputs` object per tournament. A batched loader (`lib/audit/load.ts`) builds those inputs with grouped queries. `runAudit` stores `TournamentAudit` rows, and runs after scrape writes, from a cron sweep and from admin actions. The admin overview and the per-tournament page read the stored rows.

**Tech Stack:** Next.js 16 App Router, Prisma 7, Vitest 2, zod 4, `components/ui` primitives.

**Spec:** `docs/superpowers/specs/2026-10-31-data-accuracy-design.md`. The check table, weights, thresholds, score rules and bands are binding, verbatim.

## Global Constraints

- New files are 800 lines or less. `lib/calicotab/ingest.ts` gets only small in-place additions. No `PARSER_VERSION` bump.
- No new lint warnings (compare against the base with `git stash`). Prettier. Narrative "why" comments.
- Migration folder: `prisma/migrations/20261031100000_tournament_audit/`.
- `CHECKS_VERSION = '20261031.1'`, exported from `lib/audit/checks.ts`. Bump it whenever a check changes.
- The audit never throws into its callers. The scrape path calls it best-effort; failures go to `console.error` in lib code (Sentry only in routes).
- Batches are bounded: cron sweep 50 tournaments per tick, "Audit now" 100. Queries are grouped and never run per round.
- The UI follows `docs/DESIGN_INSTRUCTIONS.md` §6 and `docs/UI_UX_STANDARDS.md`, with the same rules as the partial-scrapes admin pages:
  - DataTable ledger with `.cell-num` on numeric columns;
  - status as icon plus text (UX-34);
  - sample size next to every aggregate (UX-35);
  - empty states (UX-24);
  - error codes turned into words (UX-23);
  - single-flight actions (UX-17);
  - a status line for slow work (UX-22);
  - Badge and StatusPill; icons via `components/ui/icons.ts`;
  - spacing tokens; 20 px gutters at 390 px.
- Reuse what exists: `PieceRef` / `PieceKind` (`lib/calicotab/scrapePieces.ts`), the rescrape route, `RetryPiecesButton` patterns, `singleFlight`, `relativeTime`, the error mapping in `components/admin/*`, and `outroundRank` / `compareOutroundDepth` / `matchStage` (`lib/calicotab/judgeStats.ts`, `stageLexicon.ts`).

## Review Focus

1. A tournament that never broke (no break rows, no outrounds) gets `champion` = na, not fail. Pinned in Task 2.
2. A tournament where only the URL owner's panels are stored gets `panels` = na, not fail. Pinned in Task 2.
3. Category finals (ESL, Novice, Pro-Am) don't count as the Open champion and don't break `outround_shape` for the Open bracket. Pinned in Task 2.
4. An audit failure during a scrape never fails the scrape. Pinned in Task 3.
5. A tournament with no team tab at all scores low (`team_coverage` fail) rather than crashing on division by zero. Pinned in Task 2.

---

### Task 0: Break-rank fix carried over from partial scrapes

**Files:**
- Modify: `lib/calicotab/ingest.ts`, the break-only `tournamentParticipant.updateMany` block (search for `loadedKind('break') && !loadedKind('speaker')`)
- Test: `tests/calicotab.ingest.characterization.test.ts`

The final review of `feat/partial-scrapes` found the problem. A break-only run, such as the cron retrying the ESL break, writes that category's ranks over ranks stored from another category (Open). Fix: restrict the update to `teamBreakRank: null` rows.

- [ ] **Step 1:** Write the failing test `'a break-only run never overwrites a stored break rank'`. With stored rank 3 for team X and an ESL-only run that gives X rank 1, the `updateMany` `where` includes `teamBreakRank: null`, or X's rank stays 3.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Add `teamBreakRank: null` to the `where`. Update the comment and the HANDOFF caveat line about multi-category break ranks.
- [ ] **Step 4:** Run the characterization file and typecheck. Expected: PASS.
- [ ] **Step 5: Commit:** `fix(scrape): a break-only run fills missing break ranks, never overwrites`

### Task 1: TournamentAudit table, types and scorer

**Files:**
- Modify: `prisma/schema.prisma` (model plus a back-relation on Tournament)
- Create: `prisma/migrations/20261031100000_tournament_audit/migration.sql`
- Create: `lib/audit/types.ts`, `lib/audit/score.ts`
- Test: `tests/audit.score.test.ts`

**Interfaces:**
- Produces, in `types.ts`:
  - `CheckCode`: the 13 spec codes plus `'user_reports'`
  - `CheckStatus = 'pass'|'warn'|'fail'|'na'`
  - `CheckResult = { code: CheckCode; status: CheckStatus; detail: string; pieces: PieceRef[] }`
  - `CHECK_WEIGHTS: Record<Exclude<CheckCode,'user_reports'>, number>`, using the spec's values
- Produces, in `score.ts`:
  - `scoreTournament(checks: CheckResult[], openReports: number): number`
  - `band(score: number): 'good'|'check'|'rescrape'`
  - `databaseScore(rows: Array<{score:number; usersAffected:number}>): { weighted: number|null; unweighted: number|null; n: number }`

- [ ] **Step 1: Write the failing tests:**
  - all pass → 100
  - one `champion` fail with everything else pass → round(100×(98−15)/98) = 85
  - a warn earns half
  - all na → 100
  - `openReports` 4 → minus 30 (cap)
  - floor at 0
  - `band(90)` → good, `band(89)` → check, `band(69)` → rescrape
  - `databaseScore([{score:50,usersAffected:3},{score:100,usersAffected:0}])` → weighted 60 ((50×4+100×1)/5), unweighted 75, n 2
  - empty → nulls
- [ ] **Step 2:** Run. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement. Write the migration SQL by hand in the style of `20261030160000_scrape_pieces`: `TournamentAudit` with `id` BIGSERIAL pk, `tournamentId` unique FK cascade, `score` INTEGER, `checks` JSONB, `usersAffected` INTEGER default 0, `checksVersion` TEXT, `computedAt` TIMESTAMP(3), indexes on `score` and `computedAt`. Then `npx prisma validate && npx prisma generate`.
- [ ] **Step 4:** Run the test and typecheck. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(audit): TournamentAudit table, check types, scorer`

### Task 2: The check engine

**Files:**
- Create: `lib/audit/checks.ts`
- Test: `tests/audit.checks.test.ts` (split into two files if over 400 lines; that is the lint cap)

**Interfaces:**
- Consumes: Task 1 types, `outroundRank` / `compareOutroundDepth` / `matchStage`.
- Produces:
  - `type AuditInputs`, all plain data and no Prisma types:
    - `format: string|null`, `prelimRoundCount: number|null`, `parserVersion: string|null`
    - `teamTab: Array<{ team: string; points: number|null; wins: number|null }>`
    - `roundRows: Array<{ team: string; round: number; points: number|null; wins: number|null; position: string|null }>`
    - `outrounds: Array<{ stage: string; team: string; result: 'won'|'lost' }>`
    - `breakRows: Array<{ stage: string; team: string }>` (team entity only)
    - `speakersByTeam: Record<string, number>`
    - `speakerParticipants: number`, `speakersWithScores: number`
    - `judgeParticipants: number`, `roundResultJudges: number` (distinct persons with `round_results` rows)
    - `judgesByRound: Record<number, { chairs: number; judges: number }>`
    - `motionRounds: number[]`
    - `pieces: Array<PieceRef & { label: string; status: 'ok'|'failed'|'withheld' }>`
    - `openReports: Array<{ categories: string[] }>`
  - `CHECKS_VERSION`
  - `runChecks(inputs: AuditInputs, currentParserVersion: string): CheckResult[]`: one result per spec code, in the spec's order, plus `user_reports` (status `warn` when there are open reports, pieces per category mapping, detail like "2 open user reports").
  - `teamsPerRoom(format, roundRows): 2|4` and `minSpeakers(format): 2|3`, exported for tests.

- [ ] **Step 1: Write the failing tests.** One describe per check, each with pass / warn / fail / na fixtures using the spec's exact thresholds. Include the Review Focus cases 1, 2, 3 and 5 by name:
  - `'a tournament that never broke: champion is na'`
  - `'only the owner's panels stored: panels is na'`
  - `'an ESL final does not stand in for the Open champion'`
  - `'no team tab: team_coverage fails, no crash'`

  Also: `rooms_consistent` on 16/16/12 rooms → fail naming R3 with `pieces` `[{kind:'round',key:'3'}]`; `points_add_up` on BP with one team off; `outround_shape` on a QF with 16 teams where 8 won → pass, and SF with 8 teams where 3 won → fail; `user_reports` mapping `wrong_outround` → break plus outround pieces.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Details must be one plain sentence with numbers, and must never contain raw codes. Outround round pieces are found by matching `pieces` labels to the stage. When nothing matches, `pieces` is `[]`.
- [ ] **Step 4:** Run, then typecheck. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(audit): logic checks over a tournament's rounds, outrounds, panels and reports`

### Task 3: Loader, runAudit and when it runs

**Files:**
- Create: `lib/audit/load.ts`, `lib/audit/run.ts`
- Create: `app/api/admin/audit/route.ts` (POST, `maxDuration = 60`)
- Modify: `lib/calicotab/ingest.ts`, one best-effort call after `recordPieceOutcomes` in `runFullScrape`
- Modify: `app/api/cron/process-queue/route.ts`, an `auditSafely(startedAt)` wrapper after the piece retry, reported as `audited` in the JSON. `runOnce` stays at 60 lines or fewer.
- Test: `tests/audit.load.test.ts`, `tests/audit.run.test.ts`, `tests/api/admin-audit.test.ts`

**Interfaces:**
- `loadAuditInputs(tournamentIds: bigint[]): Promise<Map<bigint, AuditInputs & { usersAffected: number }>>`:
  - grouped and bulk queries, one per table for the whole batch, never per tournament;
  - TeamResult rows for the batch, round 0 and prelims;
  - EliminationResult with `result in (won,lost)`, plus team break rows;
  - TournamentParticipant `groupBy` (`tournamentId`, `teamName`) for speakers;
  - JudgeAssignment `groupBy` (`tournamentId`, `roundNumber`, `panelRole`) where `source = 'round_results'` and `roundNumber` is not null, plus distinct persons;
  - Motion `groupBy`; ScrapePiece; CvErrorReport where `status in (open, acknowledged)` and `tournamentIds` `hasSome`;
  - `usersAffected` = distinct `userId` in DiscoveredUrl by `tournamentId`.
- `runAudit(tournamentIds: bigint[]): Promise<number>` loads, checks, scores and upserts `TournamentAudit` (score, checks, usersAffected, `checksVersion: CHECKS_VERSION`, `computedAt` now). It returns the count audited.
- `auditStale(opts: { limit: number; deadline: number }): Promise<number>` picks tournaments with no audit, an audit older than 24 h, or an old `checksVersion`, oldest first. It runs in chunks of 25 and stops at the deadline.
- `auditAfterScrape(tournamentId: bigint): Promise<void>` calls `runAudit([id])` and catches and logs errors.
- `POST /api/admin/audit`:
  - body `{ tournamentId: string(digits ≤ 18) }` or `{ stale: true }` (limit 100);
  - → 200 `{ audited }`, 400 `bad_request`, 401/403, 500 `server_error`.

- [ ] **Step 1: Write the failing tests:**
  - the loader maps fixture rows into `AuditInputs`, and each Prisma model is queried exactly once per batch;
  - `runAudit` upserts the score from `scoreTournament`;
  - `auditStale` honours limit and deadline;
  - `'an audit failure never fails the scrape'`: runFullScrape still resolves when `runAudit` rejects;
  - the route returns 403 for non-admins, `{stale:true}` calls `auditStale` with limit 100, and a bad id returns 400.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the files, the characterization file, `tests/api/cron-process-queue.test.ts` and typecheck. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(audit): batched loader, stored audits, after-scrape, cron and admin triggers`

### Task 4: Admin overview "Data accuracy"

**Files:**
- Create: `lib/admin/accuracy.ts` (read model), `components/admin/AccuracySection.tsx` (server), `components/admin/AccuracyTable.tsx` (client, `useFirstRows` 20), `components/admin/AuditNowButton.tsx`, `components/admin/RescrapeSuggestedButton.tsx`
- Modify: `app/(app)/admin/page.tsx`, adding the section after Failed imports
- Test: `tests/admin.accuracy.test.ts`, `tests/admin.accuracy.render.test.ts`

**Interfaces:**
- `getAccuracyOverview(): Promise<AccuracyOverview>`:
  - `{ weighted, unweighted, n, onCvs, bands: {good, check, rescrape}, failingByCheck: Array<{code, count}>, stale: number, lowest: Array<{ id: string; name: string; score: number; band; failed: Array<{code; label}>; suggested: PieceRef[]; usersAffected: number; computedAt: Date }> }`;
  - `lowest` holds the 200 lowest scores, ascending;
  - `suggested` is the union of failing and warning pieces, deduplicated, and capped at 40 (the route's cap).
- Check labels:
  - `champion` → "Champion"
  - `rounds_complete` → "Rounds complete"
  - `rooms_consistent` → "Rooms per round"
  - `team_coverage` → "Teams in rounds"
  - `partners` → "Partners"
  - `panels` → "Panels"
  - `points_add_up` → "Points add up"
  - `outround_shape` → "Outround shape"
  - `break_matches` → "Break size"
  - `speaker_tab` → "Speaker tab"
  - `motions` → "Motions"
  - `scrape_incomplete` → "Scrape incomplete"
  - `parser_stale` → "Old parser"
  - `user_reports` → "User reports"
- Layout:
  - **Tiles:** "Accuracy score" (weighted, as a figure, with hint "across n tournaments · m on users' CVs"), "Unweighted", "Good / Check / Re-scrape" counts, and "Not audited in 24 h".
  - **Chart:** a BarList "Tournaments failing each check".
  - **Ledger table:** Tournament (link to `/admin/tournaments/[id]`), Score (`.cell-num`, with a band Badge as text), Failing (badges, at most 4 then "+n"), On CVs (`.cell-num`), Audited (relative, mono), Action "Re-scrape suggested (n)". The action posts `{pieces: suggested}` to the existing rescrape route, with Task 8's pending, status-line and error-mapping pattern. When `suggested` is empty, the button reads "Re-scrape all failed" and posts `'failed'`.
  - **"Audit now":** posts `{stale:true}` and toasts "Audited n tournaments".
  - **Empty state:** "No tournaments audited yet", with Audit now as its action.

- [ ] **Step 1: Write the failing tests:**
  - the read model computes `weighted` from stored rows and dedupes `suggested`;
  - render: the heading "Data accuracy", the tile text with n and m, a row link, the action's accessible name including the tournament name, and the empty state.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run, typecheck and lint the touched files. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(admin): data accuracy score, failing checks and re-scrape suggestions`

### Task 5: Per-tournament "Accuracy checks" panel

**Files:**
- Modify: `app/(app)/admin/tournaments/[id]/page.tsx`, `components/admin/PieceGrid.tsx` (accept `suggested: PieceRef[]` and add a "Select suggested" action next to "Select failed")
- Create: `components/admin/AccuracyChecks.tsx`
- Test: `tests/admin.accuracyChecks.render.test.ts`

**Layout:**
- Above the grid: an h2 "Accuracy checks", the score with its band, and "Audited <relative>", or "Not audited yet".
- A list, one row per check: label, a StatusPill (pass → done "Pass", warn → pending "Check", fail → failed "Fail", na → unavailable "Not applicable"), the detail sentence, and the suggested piece labels.
- "Audit again" posts `{tournamentId}` and then refreshes.
- The PieceGrid's "Select suggested" ticks exactly `suggested`, intersected with the grid.

- [ ] **Step 1: Write the failing tests:**
  - a fixture audit renders every label, the four pill texts and a detail sentence;
  - `pieceGrid` selection: "Select suggested" yields the suggested refs present in the grid.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(admin): accuracy checks on the tournament page, with Select suggested`

### Task 6: Seed, browser check, docs

**Files:**
- Modify: `scripts/seed-dev-scrape-health.mjs` (or a new `scripts/seed-dev-audit.mjs` called the same way), seeding data that makes one tournament fail `rooms_consistent` and `champion`, plus one open CvErrorReport. Then run `runAudit` through the admin route or the cron path.
- Modify: `docs/HANDOFF.md` and the `CLAUDE.md` Architecture section (a `lib/audit/` line).

- [ ] **Step 1:** Seed the local DB (localhost only; print the host first). The throwaway cluster on localhost:55432 may still be running; see `.superpowers/sdd/2026-10-30-partial-scrapes/task-10-report.md` for the recipe.
- [ ] **Step 2: Browser check** with Playwright at 1280 and 390, light and dark, on `/admin` and `/admin/tournaments/<seeded id>`:
  - no console errors, no sideways scroll, 20 px gutters;
  - the score tiles render;
  - "Select suggested" ticks the suggested pieces;
  - "Audit now" returns.
  - Save screenshots to the session scratchpad.
- [ ] **Step 3:** Run `A11Y_ONLY=/admin npm run a11y` with `MSYS_NO_PATHCONV=1`.
- [ ] **Step 4:** Full gate: `npm run typecheck && npm run lint && npx vitest run && node scripts/check-file-size.mjs && node scripts/check-ratchet.mjs`.
- [ ] **Step 5:** Write the HANDOFF entry (what the score means, the check table pointer, triggers, migration, rollback). Commit: `docs: data accuracy handoff, seed audit data`
