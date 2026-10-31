# Partial Scrapes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrape, store and retry a tournament piece by piece: per tab, and per round within results. Mark partly loaded tournaments on the CV, and give admins an overview and a picker to act on it.

**Architecture:** A new `ScrapePiece` table records every page a scrape tried. `fetchAndParseTabs` reports one outcome per page and can be limited to chosen pieces. `runFullScrape` keeps what loaded instead of aborting, and in partial mode deletes only the chosen pieces' rows before rewriting them. A new `lib/calicotab/partialScrape.ts` holds the partial entry point and the automatic retry, which the cron calls. The admin overview and a per-tournament page read `ScrapePiece`.

**Tech Stack:** Next.js 16 App Router, Prisma 7 (Postgres), Vitest 2, Tailwind 4 primitives in `components/ui/`, zod 4.

**Spec:** `docs/superpowers/specs/2026-10-30-partial-scrapes-design.md`

## Global Constraints

- Every new file is 800 lines or less (`scripts/check-file-size.mjs`). `lib/calicotab/ingest.ts` (2,474 lines, `allowGrowth`) gets only small in-place additions; new logic goes in new modules.
- No `PARSER_VERSION` bump.
- No new lint warnings: compare `npx eslint .` against `main`. The type-aware ratchet (`node scripts/check-ratchet.mjs`) must hold.
- Prettier on every touched file. Comments in the existing narrative "why" voice.
- All calicotab fetches go through `fetchHtmlWithProvenance` / `fetchRoundWithProvenance` with the ingest's `FetchSession`, so the shared throttle and the one-calicotab-job rule still hold.
- Before a partial re-scrape writes, take the scrape claim with `acquireScrapeClaim`. If another scrape holds it, refuse.
- UI follows `docs/DESIGN_INSTRUCTIONS.md` §6 and `docs/UI_UX_STANDARDS.md`:
  - Ledger tables via `DataTable` with `.cell-num` on numeric columns.
  - An em dash for empty cells.
  - Status shown with an icon and text, never colour alone (UX-34).
  - Every list defines its empty state (UX-24).
  - Sample size next to every aggregate (UX-35).
  - Icons only via `components/ui/icons.ts`.
  - Spacing on the token scale.
- Migration folder name: `prisma/migrations/20261030160000_scrape_pieces/`.
- Copy, verbatim:
  - the CV mark: **"Partly loaded"**;
  - its tooltip: **"Some pages of this tournament's tab didn't load. We retry them automatically."**
- Retry delays after the nth consecutive failure: 15 min, 1 h, 6 h, 24 h. From the 5th failure on, `nextRetryAt` is null (no automatic retry).

## Review Focus

1. Re-scraping round 3 alone leaves rounds 1, 2 and 4 untouched (TeamResult, EliminationResult, JudgeAssignment). Pinned in Task 4.
2. A full re-scrape of a stored tournament whose speaker tab fails keeps the stored speaker scores and ranks. Pinned in Task 3.
3. A failed team tab doesn't overwrite `Tournament.totalTeams` with 0 or null, and doesn't trip the regression guard. Pinned in Task 3.
4. A partial re-scrape requested while another scrape holds the claim is refused, writing nothing (409 at the API). Pinned in Tasks 4 and 7.
5. A requested round no longer in the tab's navigation is reported as "not on the tab any more", and nothing is deleted. Pinned in Task 4.

---

### Task 1: `ScrapePiece` table and piece helpers

**Files:**
- Modify: `prisma/schema.prisma` (new model; a back-relation `scrapePieces ScrapePiece[]` on `Tournament`)
- Create: `prisma/migrations/20261030160000_scrape_pieces/migration.sql`
- Create: `lib/calicotab/scrapePieces.ts`
- Test: `tests/calicotab.scrapePieces.test.ts`

**Interfaces:**
- Produces:
  - `type PieceKind = 'team' | 'speaker' | 'participants' | 'motions' | 'break' | 'round'`
  - `type PieceRef = { kind: PieceKind; key: string }`. `key` is `''` for single tabs. For a break, it's the last path segment of its URL, lower-cased (`open`, `esl`). For a round, it's the round number from `/results/round/<n>/` as a string; with no number, it's the URL path.
  - `type PieceOutcome = PieceRef & { label: string; url: string; ok: boolean; httpStatus: number | null; error: string | null }`
  - `pieceRefForUrl(kind: PieceKind, url: string): PieceRef`
  - `roundPieceLabel(roundNumber: number | null, roundLabel: string | null): string`: `"R3"` for a numbered prelim, else the label (for example `"Grand Final"`)
  - `retryDelayMs(failures: number): number | null`: 1 → 900000, 2 → 3600000, 3 → 21600000, 4 → 86400000, 5 or more → null
  - `recordPieceOutcomes(tournamentId: bigint, outcomes: PieceOutcome[], now?: Date): Promise<void>`:
    - upserts on `(tournamentId, kind, key)`;
    - on ok: status `'ok'`, `attempts` 0, `loadedAt` = now, `nextRetryAt` null, `lastError` null;
    - on failure: status `'failed'`, `attempts` + 1, `nextRetryAt` = now + `retryDelayMs(attempts)` or null, `httpStatus` and `lastError` set, `loadedAt` unchanged;
    - `lastAttemptAt` = now either way.

Model fields:
- `id BigInt @id @default(autoincrement())`
- `tournamentId BigInt`
- `kind String`
- `key String`
- `label String`
- `url String`
- `status String`
- `httpStatus Int?`
- `lastError String?`
- `attempts Int @default(0)`
- `lastAttemptAt DateTime`
- `loadedAt DateTime?`
- `nextRetryAt DateTime?`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`
- relation to Tournament with `onDelete: Cascade`
- `@@unique([tournamentId, kind, key])`
- `@@index([status, nextRetryAt])`

- [ ] **Step 1: Write the failing tests** in `tests/calicotab.scrapePieces.test.ts`, with the Prisma mock from `tests/setup/api-test-utils` as in `tests/calicotab.storedFirst.test.ts`:
  - `pieceRefForUrl('round', 'https://x.calicotab.com/t/results/round/3/')` equals `{kind:'round', key:'3'}`.
  - `pieceRefForUrl('break', 'https://x.calicotab.com/t/break/teams/ESL/')` equals `{kind:'break', key:'esl'}`.
  - `pieceRefForUrl('team', …)` equals `{kind:'team', key:''}`.
  - `roundPieceLabel(3, 'Round 3')` is `'R3'`; `roundPieceLabel(7, 'Grand Final')` is `'Grand Final'`.
  - `retryDelayMs` returns exactly the values above for 1–5.
  - `recordPieceOutcomes`:
    - a failed outcome on a piece with `attempts` 1 upserts `attempts: {increment: 1}` (or 2) and `nextRetryAt` = now + 3600000;
    - an ok outcome sets `attempts: 0`, `nextRetryAt: null`, `loadedAt: now`.
- [ ] **Step 2:** Run `npx vitest run tests/calicotab.scrapePieces.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Add the model and the migration. Write the SQL by hand in the style of existing migrations (`CREATE TABLE`, unique index, index, FK `ON DELETE CASCADE`), then run `npx prisma validate` and `npx prisma generate`. Implement `lib/calicotab/scrapePieces.ts`. To read a failed piece's current attempts, use the upsert's `update: { attempts: { increment: 1 } }`, then set `nextRetryAt` from the returned row in a second `update`.
- [ ] **Step 4:** Run the test, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(scrape): ScrapePiece table and piece helpers`

### Task 2: `fetchAndParseTabs` reports per-page outcomes and can be limited to pieces

**Files:**
- Modify: `lib/calicotab/ingest.ts`: the `FetchedTabs` type (`:120-140`), the `fetchAndParseTabs` helpers `fetchTab` (`:882`), `fetchRound` (`:919`) and `fetchOptionalTab` (`:939`), and the round/break loops (`:1033`, `:1041`)
- Test: `tests/calicotab.ingest.characterization.test.ts` (existing harness)

**Interfaces:**
- Consumes: `PieceRef`, `PieceOutcome`, `pieceRefForUrl` and `roundPieceLabel` from Task 1.
- Produces:
  - `FetchedTabs.pieceOutcomes: PieceOutcome[]`: one per page the scrape tried. The API paths record an outcome for the tab they stand in for.
  - `fetchAndParseTabs(loaded, only?: PieceRef[])`: when `only` is given, only nav pages whose `pieceRefForUrl` is in `only` are fetched. All other fields come back empty, but `prelimRoundCount` is still computed from the nav.
  - `FetchedTabs.fetchedPieces: PieceRef[]`: the pieces that loaded, for Task 4's scoped deletes.

- [ ] **Step 1: Write the failing tests** in the characterization file:
  - `'records an outcome per page, ok and failed'`: make one round URL return HTTP 504 through the harness's fetch mock. `fetched.pieceOutcomes` has that round with `ok:false, httpStatus:504`, and the team tab has `ok:true`.
  - `'fetches only the requested pieces'`: `only = [{kind:'round', key:'2'}]`. The fetch mock is called for the landing page's round-2 URL and no other tab URL.
- [ ] **Step 2:** Run the characterization file. Expected: the two new tests FAIL.
- [ ] **Step 3:** Implement. Each helper pushes a `PieceOutcome` next to its existing warning push. The existing `fetchWarnings` and `fetchLevelFailures` text stays unchanged. `only` filters the URL lists before fetching.
- [ ] **Step 4:** Run the characterization file and `npm run typecheck`. Expected: PASS, with all existing tests unchanged.
- [ ] **Step 5: Commit:** `feat(scrape): per-page outcomes, and fetch limited to chosen pieces`

### Task 3: Keep what loaded

**Files:**
- Modify: `lib/calicotab/ingest.ts`: `runFullScrape` (`:405-468`), `checkRegressionGuard` (`:1203-1299`), and the Tournament upsert in `writeIngestTransaction` (`:1411`)
- Test: `tests/calicotab.ingest.characterization.test.ts`

**Interfaces:**
- Consumes: `FetchedTabs.pieceOutcomes` (Task 2) and `recordPieceOutcomes` (Task 1).
- Produces: `runFullScrape(loaded, userId, options: { force?: boolean; only?: PieceRef[] }, afterWrite?)`. It throws `"Aborting ingest: no page loaded"` only when no outcome is ok. Otherwise it writes, then calls `recordPieceOutcomes(tournamentId, fetched.pieceOutcomes)`. An ingest result with failed pieces carries a warning beginning `partial:`.

Rules:
- The tournament-wide refresh (`:1448`) never runs when any piece failed or `only` is set. The existing `fetchWarnings.length === 0` check covers the first case; add `!options.only`.
- The Tournament upsert keeps the stored `totalTeams` when the team piece didn't load, and the stored `totalParticipants` when neither the speaker nor the participants piece loaded.
- The regression guard compares teams only if the team piece loaded, and ranks only if the speaker piece loaded. It is skipped entirely when `only` is set.

- [ ] **Step 1: Write the failing tests:**
  - `'a failed round keeps the pages that loaded'`: first ingest with round 2 at 504. The ingest resolves (no throw), TeamResult round-0 rows are written, `recordPieceOutcomes` is called with round 2 failed, and the result warnings include one starting `partial:`.
  - `'a failed speaker tab on a stored tournament keeps stored speaker data'`: existing row, speaker tab 504. No `prepareTournamentWideRefresh` deletes run (no `teamResult.deleteMany` / `eliminationResult.deleteMany` calls), and no speakerRoundScore `deleteMany` for the participants.
  - `'a failed team tab keeps the stored team count and passes the guard'`: existing row `totalTeams: 40`, team tab 504. The Tournament upsert data has no `totalTeams` key (or 40), and the result has no `regression-guard` warning.
  - `'every page failing still aborts'`: every fetch 504 rejects with `/no page loaded/`.
- [ ] **Step 2:** Run. Expected: FAIL. The current behaviour throws "Aborting ingest: 1 tab fetch(es) failed".
- [ ] **Step 3:** Implement the rules above.
- [ ] **Step 4:** Run the characterization file, `tests/calicotab.*.test.ts` and `npm run typecheck`. Expected: PASS. Existing tests that asserted the old abort get updated to the new rule, with a comment naming the owner decision.
- [ ] **Step 5: Commit:** `feat(scrape): keep what loaded; record every piece`

### Task 4: Partial re-scrape with piece-scoped deletes

**Files:**
- Create: `lib/calicotab/partialScrape.ts`
- Modify: `lib/calicotab/scrapePieces.ts` (add `clearPieces`)
- Modify: `lib/calicotab/ingest.ts`:
  - export `runFullScrape`, `loadPublicLanding` (factored out of `prescrapeTournament` `:238-321`: the landing fetch and the `existing` lookup) and `acquireScrapeClaim`;
  - inside `writeIngestTransaction`, call the scoped delete when `only` is set;
  - make the pre-scrape `afterWrite` judge rewrite (`recordEveryJudgeFromRoundResults`, `:383`) delete only fetched rounds' `round_results` rows when `only` is set.
- Test: `tests/calicotab.partialScrape.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `clearPieces(tx: Prisma.TransactionClient, tournamentId: bigint, pieces: Array<PieceRef & { roundNumber: number | null; roundLabel: string | null; breakStage: string | null }>): Promise<void>` in **`scrapePieces.ts`**, not `partialScrape.ts`: `ingest.ts` calls it, and `partialScrape.ts` imports `ingest.ts`, so this placement avoids an import cycle. The deletes per kind:
    - `round`: TeamResult `roundNumber = n`; EliminationResult `entityType 'team'`, `stage = roundLabel`, `result in ('won','lost')`; JudgeAssignment `source 'round_results'` and (`roundNumber = n` or, for outrounds, `stage = roundLabel`).
    - `team`: TeamResult `roundNumber 0`.
    - `break`: EliminationResult `stage = breakStage`, `result null`.
    - `speaker`, `participants`, `motions`: no delete. Their writes already replace per participant or per motion.
  - `type PartialResult = { tournamentId: bigint; loaded: PieceRef[]; failed: PieceRef[]; notOnTab: PieceRef[] }`
  - `rescrapePieces(tournamentId: bigint, pieces: PieceRef[] | 'failed', opts?: { deadline?: number }): Promise<PartialResult>`. `'failed'` means every piece of that tournament with status `'failed'`. It throws `ScrapeBusyError` (exported) when the claim is held.

- [ ] **Step 1: Write the failing tests** in `tests/calicotab.partialScrape.test.ts`. Mock `@/lib/db` and the fetch layer the same way as the characterization harness.
  - `'rescraping round 3 deletes and rewrites only round 3'`: TeamResult `deleteMany` is called once with `{tournamentId, roundNumber: 3}`. No `deleteMany` touches another roundNumber or roundNumber 0, and there is no tournament-wide refresh.
  - `'an outround deletes only its stage'`: `key '7'`, label `'Grand Final'`. The EliminationResult delete has `stage: 'Grand Final'` and `result: {in: ['won','lost']}`.
  - `'a round no longer on the tab is reported, not deleted'`: requested `{round,'9'}` absent from the nav, so `notOnTab` contains it and no `deleteMany` runs.
  - `'refuses while another scrape holds the claim'`: claim held, so it rejects with `ScrapeBusyError` and there is no write.
  - `"'failed' re-scrapes exactly the failed pieces"`: ScrapePiece findMany returns two failed pieces, and the fetch mock sees exactly those two URLs plus the landing page.
- [ ] **Step 2:** Run. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement. Load the Tournament, take its public base from `sourceUrlRaw` (`publicTournamentBase`), `loadPublicLanding`, intersect the requested pieces with the nav, `acquireScrapeClaim`, then `runFullScrape(loaded, null, { only })`.
- [ ] **Step 4:** Run the new file, the characterization file and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(scrape): re-scrape chosen tabs or rounds, deleting only their rows`

### Task 5: Automatic retry of failed pieces

**Files:**
- Modify: `lib/calicotab/partialScrape.ts`
- Modify: `app/api/cron/process-queue/route.ts`: after `drainQueue`, when time remains, call the retry. Report `piecesRetried` in the JSON. Keep `runOnce` at 60 lines or less with a small wrapper, the same pattern as `scanSafely`.
- Test: `tests/calicotab.partialScrape.test.ts`

**Interfaces:**
- Produces: `retryDuePieces(opts: { deadline: number; now?: Date }): Promise<{ tournaments: number; loaded: number; failed: number }>`. It selects ScrapePiece rows with `status 'failed'` and `nextRetryAt <= now`, ordered by `nextRetryAt`, and groups them by tournament. It runs `rescrapePieces(id, refs)` one tournament at a time while `Date.now() < deadline - 20000`. It skips a tournament on `ScrapeBusyError`.

- [ ] **Step 1: Write the failing tests:**
  - `'retries due pieces one tournament at a time'`: rescrapePieces is called with each tournament's due refs, in `nextRetryAt` order.
  - `'stops when the deadline is near'`: deadline = now + 10000, so no call.
  - `'a piece not due is not retried'`: the findMany `where` includes `nextRetryAt: { lte: now }`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement, and wire the cron.
- [ ] **Step 4:** Run the file, `tests/api/cron-*.test.ts` (if present) and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(scrape): failed pieces retry on their own from the cron`

### Task 6: "Partly loaded" on the CV

**Files:**
- Modify: `lib/cv/buildCvData.ts`: one query, `scrapePiece.findMany({ where: { tournamentId: { in: tournamentIds }, status: 'failed' }, select: { tournamentId: true } })` in the existing `Promise.all`. Add `partlyLoaded: boolean` to `CvSpeakerRow` and the judge row type.
- Modify: `components/RecordLedger.tsx` and `app/u/[slug]/PublicRecordCards.tsx`: after the tournament name, a `Badge variant="warning"` with the text "Partly loaded", wrapped in `Tooltip` with the copy from Global Constraints. It must work on keyboard focus and not depend on hover alone (UX-36): the badge text itself says it.
- Modify: `lib/sample/sampleRecord.ts`, setting `partlyLoaded: false` on every row.
- Test: `tests/cv.buildCvData.characterization.test.ts`, and a render test following `tests/publicCv.render.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - buildCvData: with the scrapePiece mock returning `[{tournamentId: 1n}]`, `speakerRows[0].partlyLoaded` is true; with `[]` it is false.
  - Render: a row with `partlyLoaded: true` renders the text "Partly loaded".
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the two files and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(cv): mark partly loaded tournaments`

### Task 7: Admin API for acting on scrapes and jobs

**Files:**
- Create: `app/api/admin/tournaments/[id]/rescrape/route.ts` (POST, `maxDuration = 60`)
- Create: `app/api/admin/jobs/retry/route.ts` (POST)
- Create: `lib/admin/scrapeHealth.ts`: the read model for both admin pages
- Test: `tests/api/admin-rescrape.test.ts`, `tests/api/admin-jobs-retry.test.ts`, `tests/admin.scrapeHealth.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/admin/tournaments/[id]/rescrape`:
    - body (zod): `{ pieces: 'failed' | Array<{ kind: PieceKind; key: string }> }`, with at most 40 pieces;
    - → 200 `{ loaded, failed, notOnTab }`, where each is an array of `{kind, key}`;
    - → 409 `{ error: 'scrape_busy' }` on `ScrapeBusyError`;
    - → 400 `{ error: 'bad_request' }`, 404 `{ error: 'not_found' }`, 401/403 via `requireAdmin`.
    - Deadline: `Date.now() + 55000`.
  - `POST /api/admin/jobs/retry`:
    - body: `{ ids: string[] }` (1–200) or `{ all: true }`;
    - resets matching `failed` and `abandoned` IngestJobs to `pending` (`attempts 0`, `lastError null`, `scheduledAt` now, `startedAt`/`finishedAt` null);
    - → `{ requeued: number }`.
  - `getScrapeHealth(): Promise<ScrapeHealth>` in `lib/admin/scrapeHealth.ts`:
    - `tracked`: tournaments with any piece;
    - `partlyLoaded`: tournaments with a failed piece;
    - `failingPieces`: count;
    - `retriesDue`: failed with `nextRetryAt <= now`;
    - `stuck`: failed with `nextRetryAt` null;
    - `failingByKind: Array<{ kind: PieceKind; count: number }>`;
    - `partlyLoadedTournaments`: up to 200, newest attempt first, each `{ id: bigint; name: string; failed: Array<{ kind; key; label; httpStatus; attempts; nextRetryAt: Date | null }>; lastAttemptAt: Date }`;
    - `failedJobs`: up to 200 IngestJob `failed`/`abandoned`, newest first, each `{ id; url; userEmail; attempts; lastError; finishedAt }`.
  - `getTournamentPieces(id: bigint): Promise<{ tournament: { id; name; sourceUrl }; tabs: PieceRow[]; rounds: PieceRow[] } | null>`. `PieceRow = { kind; key; label; status: 'ok' | 'failed'; httpStatus; attempts; loadedAt; lastAttemptAt; nextRetryAt; lastError }`. Rounds are ordered by numeric key, then the outrounds.

- [ ] **Step 1: Write the failing tests:**
  - non-admin → 403 and nothing called;
  - `pieces: 'failed'` calls `rescrapePieces(5n, 'failed', …)`;
  - `ScrapeBusyError` → 409 `scrape_busy`;
  - 41 pieces → 400;
  - jobs retry `{all:true}` → `updateMany` where `status in [failed, abandoned]`;
  - `getScrapeHealth` groups `failingByKind` and computes `retriesDue` vs `stuck` from mock rows.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Validate with zod, and catch `requireAdmin` errors as in `app/api/admin/reingest-all/route.ts`.
- [ ] **Step 4:** Run the three files and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(admin): API to re-scrape pieces and retry failed jobs`

### Task 8: Admin overview: visualise and act

**Files:**
- Modify: `app/(app)/admin/page.tsx`
- Create: `components/admin/ScrapeHealthSection.tsx` (server component)
- Create: `components/admin/FailedJobsTable.tsx` (client: selection and actions)
- Create: `components/admin/RetryPiecesButton.tsx` (client)
- Test: `tests/admin.render.test.ts` (render pattern from `tests/publicSurfaces.render.test.ts`)

**Layout**, top to bottom; existing sections keep their order below these:
1. **"Current state"** becomes a `StatRow` of `StatTile`s: Tournaments, Discovered URLs, Locked URLs, Pending jobs. Add **Partly loaded** (`accent` none, `hint` "of N tracked") and **Failed jobs**.
2. **"Scrape health"** (`ScrapeHealthSection`):
   - A `BarList` of failing pieces by kind, with the labels Team tab, Speaker tab, Participants, Motions, Break, Round. Each bar shows its count, and the total is stated as "n failing pieces across m tournaments" (UX-35).
   - A line with "Retries due now: x · Waiting for an admin (5 failures): y".
   - A ledger `DataTable` "Partly loaded tournaments", with columns:
     - Tournament: links to `/admin/tournaments/[id]`;
     - Missing: piece labels as `Badge`s, at most 6, then "+n";
     - Last tried: relative time, mono;
     - Next retry: relative time, or "Needs you" in a warning `Badge` when null;
     - Action: `RetryPiecesButton` "Retry failed", whose accessible name includes the tournament name (UX-11).
   - `useFirstRows` 20.
   - Empty state: "Every tracked tournament loaded in full", with the reason that pieces are tracked from the next scrape onwards.
3. **"Failed imports"** (`FailedJobsTable`): a `DataTable` with checkbox selection and the columns User, Tournament URL (`shortUrl`), Attempts (`.cell-num`), Error (the first 80 chars of `userMessage`-style text, never a raw code, per UX-23) and When. Actions: "Retry selected" and "Retry all n". Not destructive, so no confirm. `postJson`, a toast with the requeued count, then `router.refresh()`. Empty state: "No failed imports".

- [ ] **Step 1: Write the failing render tests:**
  - With fixture health data, the page renders the heading "Scrape health", the text "Partly loaded tournaments", a row link to `/admin/tournaments/5`, a "Retry failed" button whose accessible name contains the tournament name, and "Needs you" for a null `nextRetryAt`.
  - With empty data, both empty-state titles render.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with the primitives listed in Global Constraints. `RetryPiecesButton` posts `{pieces:'failed'}` to Task 7's route. It shows a pending state, and its result says "Loaded n, still failing m" (a toast for success; inline `role=alert` for a 409, as "Another scrape of this tournament is running. Try again in a minute.").
- [ ] **Step 4:** Run the render test, `npm run typecheck` and `npm run lint` (no new warnings). Expected: PASS.
- [ ] **Step 5: Commit:** `feat(admin): scrape health and failed imports, with actions`

### Task 9: Per-tournament piece grid and picker

**Files:**
- Create: `app/(app)/admin/tournaments/[id]/page.tsx` (server, `requireAdmin` → redirect `/`)
- Create: `components/admin/PieceGrid.tsx` (client: selection plus the re-scrape call)
- Test: `tests/admin.pieceGrid.render.test.ts`

**Layout:**
- h1 is the tournament name, with a link to its public tab.
- Two groups, each a `fieldset` with a `legend`: **Tabs** (team, speaker, participants, motions, each break) and **Rounds** (R1…Rn, then outrounds by label).
- Each piece is a checkbox card:
  - the label;
  - a `StatusPill`: `done`, labelled "Loaded"; or `failed`, labelled "Failed · HTTP 504";
  - the loaded or last-tried time in mono;
  - attempts when above 0.
- Cards sit on a grid. Colour comes only with the icon and text (UX-34).
- Untracked tournaments say "No pieces recorded yet. They are recorded from the next scrape."
- Actions:
  - "Select failed" (selects every failed piece);
  - "Clear";
  - primary "Re-scrape selected (n)", which validates on press with an inline message when n = 0 (UX-16) and never disables to signal it;
  - a polite live-region result line: "Loaded 3 · Failed 1 · Not on the tab any more 0".
- A request runs up to about 55 s, so show the spinner with "Re-scraping n pieces…" (UX-22: say what is happening). The page refreshes when done.
- Link back to `/admin`.

- [ ] **Step 1: Write the failing render tests:**
  - Fixture: tabs `[team ok, speaker failed 504]`, rounds `[R1 ok, R2 failed, Grand Final ok]`. Renders the legends "Tabs" and "Rounds", "Failed · HTTP 504", and a checkbox labelled "R2".
  - "Select failed" then "Re-scrape selected (2)" posts `{pieces:[{kind:'speaker',key:''},{kind:'round',key:'2'}]}`. Mock `postJson`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(admin): per-tournament piece grid with a re-scrape picker`

### Task 10: Seed, browser check, docs

**Files:**
- Modify: `scripts/seed-dev-data.mjs`: ScrapePiece rows for two seeded tournaments, one fully ok and one with a failed speaker tab and a failed R2 (one with `nextRetryAt` null). Plus one failed IngestJob.
- Modify: `docs/HANDOFF.md` (new entry at the top, in the style of the others)
- Modify: `CLAUDE.md` Architecture: one line each for `lib/calicotab/scrapePieces.ts`, `lib/calicotab/partialScrape.ts`, `/admin/tournaments/[id]`

- [ ] **Step 1:** Seed the local DB (Postgres 17 runs locally; `npx prisma migrate deploy`, then `npm run seed:dev`). Set `ADMIN_EMAIL=maya@example.com` in `.env.local` and run `npm run dev`.
- [ ] **Step 2: Browser check** (signed in with the seed cookie), at 1280 and 390, light and dark:
  - `/admin` shows the tiles, Scrape health and Failed imports;
  - `/admin/tournaments/<id>` shows the grid;
  - "Select failed" selects 2;
  - `/cv` shows "Partly loaded" on the seeded partly loaded tournament.
  - No console errors and no sideways scroll. Edges align to the 20 px gutter (owner's UI precision rule: measure, don't eyeball).
- [ ] **Step 3:** Run `npm run a11y` with `A11Y_ONLY=/admin`. Report any new violations.
- [ ] **Step 4:** Full gate: `npm run typecheck && npm run lint && npx vitest run && node scripts/check-file-size.mjs && node scripts/check-ratchet.mjs`. Expected: all pass, with lint warnings not above `main`.
- [ ] **Step 5:** Write the HANDOFF entry (what changed, the migration, rollback = revert plus drop the table) and the CLAUDE.md lines. Commit: `docs: partial scrapes handoff, seed pieces`
