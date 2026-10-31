# Admin Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/admin` from a 13-section dump into a tabbed work queue. An Inbox shows only what needs the owner, every flag can be marked checked, and the redundancy goes.

**Architecture:**
- A new `AdminCheck` table records "checked by the owner", with a data fingerprint so a mark lapses when the data changes.
- `lib/admin/inbox.ts` merges open items from audits, reports, imports and parser problems.
- `/admin` becomes URL-synced tabs built from the existing sections, rearranged with nothing duplicated.
- Marks feed the audit score, where a checked check counts as a pass.

**Tech Stack:** Next.js 16 App Router, Prisma 7, Vitest 2, zod 4, `components/ui` (Tabs, DataTable, Pager, StatusPill, Badge, Tooltip).

**Spec:** `docs/superpowers/specs/2026-10-31-admin-redesign-design.md`

## Global Constraints

- **Base.** Starts after the data-accuracy part 2 PR has merged to `main`. Reuse its modules: `lib/admin/*` (scrapeHealth, accuracy, tournamentLookup, tabStatus, reviewSet, cvReports, parserWarnings, pieceGrid), `components/admin/*`, `lib/audit/*`. Re-arrange; don't rewrite.
- **UI rules.** `docs/DESIGN_INSTRUCTIONS.md` §6 and `docs/UI_UX_STANDARDS.md` apply in full.
  - One h1 per page.
  - Tabs use the existing APG `Tabs` with `?tab=` and keep other params.
  - Status is shown as symbol plus word.
  - Tournament URLs are clickable public links via `TabLink`, never a private key in markup, props or exports.
  - 20 rows per page with the shared `Pager`.
  - Single-flight actions, status lines for slow work, toasts only for passive success.
  - Empty states say why.
  - Spacing tokens; 20 px gutters at 390 px; col/cell parity for hidden columns.
- **Owner rule.** A properly scraped tournament is never highlighted.
- **Migration.** `prisma/migrations/20261031150000_admin_checks/` (additive). It must sort after every migration already on `main`; check before naming it.
- **Code rules.**
  - Files ≤ 800 lines; tests ≤ 400 lines.
  - No new lint warnings; the ratchet holds (`node scripts/check-ratchet.mjs`).
  - Prettier; narrative comments.
  - No `PARSER_VERSION` bump.
- **Shell vocabulary (verbatim).**
  - Tab labels: Inbox, Tournaments, Imports, Reports, Parser, Review set, Tools.
  - Summary line: "Needs you N · Accuracy S (Good g · Check c · Re-scrape r) · Imports failing N · Queue N".
  - Row action labels: "Fix", "Mark checked", "Review later".
  - Changed-mark label: "Changed since you checked it".

## Review Focus

1. Marking a check as checked raises that tournament's score straight away (re-audit), and the item leaves the Inbox. Pinned in Tasks R1 and R4.
2. A re-scrape that changes a checked check's detail brings the item back with "Changed since you checked it". Pinned in Tasks R1 and R2.
3. A failed import whose tournament is stored never appears in the Inbox or the "Imports failing" count; it shows under "Covered by stored copy". Pinned in Tasks R2 and R6.
4. Informational parser notes ("competition likely finished", "… (optional)", "constructed as fallback", "… not released") never reach the Inbox. Pinned in Task R2.
5. "1 Jan 1970" never renders anywhere. Pinned in Task R3.

---

### Task R1: `AdminCheck` (mark checked) and the score

**Files:**
- Modify: `prisma/schema.prisma`
- Create: the migration, `lib/admin/adminChecks.ts`, `app/api/admin/checks/route.ts` (POST mark, DELETE undo)
- Modify: `lib/audit/run.ts`, so marks feed scoring
- Test: `tests/admin.adminChecks.test.ts`, `tests/api/admin-checks.test.ts`, `tests/audit.run.marks.test.ts`

**Interfaces:**
- Model `AdminCheck`: `{ id BigInt, kind String, subject String, fingerprint String, note String?, checkedBy String, checkedAt DateTime @default(now()) }`, with `@@unique([kind, subject])`.
- `type MarkKind = 'check' | 'report' | 'import' | 'parser'`.
- `fingerprintOf(kind, payload): string` gives a stable hash (sha1 hex, first 16 characters) of:
  - check: `status + '|' + detail`;
  - import: `errorCategory + '|' + attempts`;
  - parser: the count bucket (1, 2–5, 6–20, 21+);
  - report: status.
- `markChecked({ kind, subject, fingerprint, note?, by }): Promise<void>` upserts.
- `undoMark(kind, subject): Promise<void>`.
- `marksFor(kind, subjects: string[]): Promise<Map<string, { fingerprint; checkedBy; checkedAt; note }>>`.
- `POST /api/admin/checks`:
  - body `{ items: Array<{ kind, subject, fingerprint }> (1..200), note? }`;
  - for check items, re-audits the affected tournaments (`runAudit`) before replying;
  - → `{ marked }`.
- `DELETE /api/admin/checks`: body `{ kind, subject }` → `{ ok }`, and re-audits for checks.
- Both routes: admin-only, zod, codes-only errors.
- `runAudit`: after `runChecks`, a check whose `<tournamentId>:<code>` mark has a matching fingerprint becomes `{ status: 'pass', detail: 'Checked by <name> on <date>. Was: <old detail>', checkedBy, checkedAt }` before scoring. `CheckResult` gains optional `checkedBy`/`checkedAt` (stored in the JSON, parsed by `parseChecks`). Bump `CHECKS_VERSION`.

- [ ] **Step 1: Write the failing tests:**
  - the fingerprint is stable and changes with the detail;
  - mark then `marksFor` returns it, and undo removes it;
  - a matching mark turns a fail into a pass and the score rises;
  - a mismatched fingerprint leaves the fail;
  - the route marks and re-audits; 403 for non-admins; 400 for 201 items.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests, typecheck and the ratchet. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(admin): mark a flag checked; a checked check counts as a pass`

### Task R2: Inbox read model and parser classification

**Files:**
- Create: `lib/admin/inbox.ts`, `lib/admin/parserClass.ts`
- Test: `tests/admin.inbox.test.ts`, `tests/admin.parserClass.test.ts`

**Interfaces:**
- `classifyWarning(headline: string): 'problem' | 'info'`.
  - info: `/likely finished|\(optional\)|constructed as fallback|not released|limited tab visibility/i`.
  - problem: `/→ 0 results|^fetch: .*HTTP|^parse:/i`, plus anything unmatched (unknown warnings are surfaced, not hidden).
- `type InboxItem = { key: string; kind: 'check'|'report'|'import'|'parser'; tournament: { id; name; tabUrl; status: TabStatusValue } | null; summary: string; more: number; usersAffected: number; severity: 'fail'|'warn'; age: Date; fix: FixAction; markItems: Array<{ kind; subject; fingerprint }>; reviewFlag: { priority } | null; changedSinceChecked: boolean }`.
  - `FixAction` is one of: `{ type: 'rescrape', tournamentId, pieces }`, `{ type: 'retry', jobIds }` or `{ type: 'open', href }`.
- `listInbox({ page, kinds?: Kind[] }): Promise<{ rows: InboxItem[]; total; page; pages; counts: Record<Kind, number> }>`.
  - **check:** one item per tournament with any fail or warn check not covered by a matching mark. The summary is its first failing detail plus "+n more". Fix is re-scrape with the suggested pieces.
  - **report:** open or acknowledged reports not marked. Fix is open.
  - **import:** failed or abandoned jobs whose tournament is not stored (or ambiguous), grouped per host and slug (one item, `usersAffected` = distinct users). Fix is retry over all of them.
  - **parser:** problem groups only.
  - Ordering: users affected desc, then fail before warn, then age asc (oldest first).
  - Bounded reads: at most 1,000 candidates per kind, then paginate in memory, saying so in a code comment.
  - `changedSinceChecked` is true when a mark exists but its fingerprint differs; those items stay in the inbox.

- [ ] **Step 1: Write the failing tests:**
  - classification of every headline seen live, including the 2026-10-31 list in the spec;
  - one item per tournament;
  - a stored tournament's failed import is excluded;
  - a marked check is excluded, and a mark with a changed fingerprint is included with `changedSinceChecked`;
  - order; paging; counts per kind.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(admin): one inbox of what needs the owner, informational parser notes left out`

### Task R3: The tabbed shell, summary line, removals, the 1970 fix

**Files:**
- Modify: `app/(app)/admin/page.tsx`, which becomes the shell: summary line plus `Tabs`, with each tab panel a server component in its own file under `components/admin/tabs/`
- Modify: `app/(app)/admin/tournaments/page.tsx`, which redirects to `/admin?tab=tournaments` (keeping `q` and page)
- Create: `components/admin/SummaryLine.tsx`, `lib/admin/summary.ts`, `lib/utils/scrapedLabel.ts`
- Modify: every place that shows `scrapedAt` (grep `scrapedAt` in `components/admin` and `lib/admin`)
- Test: `tests/admin.shell.render.test.ts`, `tests/utils.scrapedLabel.test.ts`

**Interfaces:**
- Tabs in order: Inbox (panel from Task R4), Tournaments (R5), Imports, Reports, Parser (R6), Review set (the existing `ReviewSetSection`), Tools.
- Only the active tab's data is loaded: each panel is its own async component, rendered only when active.
- **Tools** holds: the lookup box; links to verify, tagging and tag proposals; "Export errors"; Re-ingest all with the Locked and Discovered URL counts beside it; and a collapsed `<details>` "Danger zone" with Clear data and Full wipe (their existing confirms).
- **Removed:** the Current-state tiles, the empty Scrape-health section, "Lowest scores" (now the Tournaments tab), the separate accuracy chart (now the filter chips), and the inline Open-questions list (now a Tournaments filter).
- `scrapedLabel(date)`: the epoch marker (`< 2000-01-01`) gives "Re-scrape queued"; otherwise the relative time.

- [ ] **Step 1: Write the failing tests:**
  - the shell renders the summary line text and the seven tab labels;
  - `?tab=imports` renders only the Imports panel;
  - the old `/admin/tournaments` URL redirects with its params;
  - `scrapedLabel(new Date(0))` is "Re-scrape queued";
  - no rendered admin page contains "1970".
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run, typecheck, lint. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(admin): tabs instead of one long page; summary line; dead sections removed`

### Task R4: Inbox tab UI

**Files:**
- Create: `components/admin/tabs/InboxTab.tsx` (server), `components/admin/InboxTable.tsx` (client)
- Test: `tests/admin.inbox.render.test.ts`, extending `tests/admin.clientProps.test.ts`

**Interfaces:**
- Row:
  - checkbox;
  - kind badge (word);
  - tournament name (link to the detail page) plus the unified status cell;
  - summary with "+n more";
  - "Changed since you checked it" badge when relevant;
  - review badge if flagged;
  - users (`.cell-num`);
  - age (mono);
  - actions: **Fix** (per `FixAction`, reusing `RescrapeSuggestedButton`, the retry call and a link), **Mark checked**, **Review later** (reusing `AddToReviewSet`), and a row menu with "Open tab ↗" and "Open details".
- Kind filter chips with counts (`?kinds=`). Bulk bar: "Mark n checked" and "Review n later".
- After Mark checked, the toast reads "Marked checked · Undo" and Undo calls DELETE. The row leaves on refresh.
- Empty state: "Nothing needs you. Every flag is fixed or checked."
- Phone: rows fold to cards with col/cell parity.

- [ ] **Step 1: Write the failing tests:**
  - the render shows the kinds, actions with tournament names in their accessible names, chips with counts, the empty state and the changed badge;
  - the pure helper builds the bulk mark payload;
  - no private key in the props.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(admin): inbox tab with Fix, Mark checked and Review later`

### Task R5: Tournaments tab and per-check marks

**Files:**
- Create: `components/admin/tabs/TournamentsTab.tsx`, which moves the `/admin/tournaments` list in (paged, searchable)
- Modify: `lib/admin/tournamentList.ts`, adding filters
- Modify: `components/admin/AccuracyChecks.tsx` (detail page)
- Test: render and read-model tests

**Interfaces:**
- Filters:
  - `?check=<code>` (chips from the failing-checks counts; one row per check, sorted by count);
  - `?band=good|check|rescrape`;
  - `?question=no_open_bracket_champion` (a one-line chip, "Open question: champion when no Open bracket (47)", with the rule in a `<details>`);
  - `?checked=1` (tournaments with marks).
- Default sort is lowest score first.
- The unified status cell replaces the "In database" and "Tab" cells. There is one Tab ↗ per row.
- Detail page: each non-pass check gets **Mark checked**; a checked one shows "Checked by X on D · Undo".

- [ ] **Step 1: Write the failing tests:**
  - the filters narrow the list;
  - the chip counts equal the overview's `failingByCheck`;
  - the detail page shows Mark checked on fail/warn, and Undo on checked.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(admin): tournaments tab with check filters; mark checks on the detail page`

### Task R6: Imports, Reports and Parser tabs

**Files:**
- Create: `components/admin/tabs/ImportsTab.tsx`, `ReportsTab.tsx`, `ParserTab.tsx`, re-housing the existing tables
- Modify: `lib/admin/scrapeHealth.ts` (filter), `lib/admin/parserWarnings.ts` (classification)
- Test: render and read-model tests

**Interfaces:**
- **Imports:**
  - `?imports=failing` (default: not stored or ambiguous), `?imports=covered` (stored tournaments, explained as "the user already has this tournament from the stored copy"), `?imports=all`;
  - "Export errors" lives here;
  - rows are grouped per host and slug, with affected users listed;
  - Mark checked per row.
- **Reports:** the existing CV reports table, with Mark checked meaning acknowledged.
- **Parser:**
  - `?parser=problems` (default), `?parser=info` (informational, with a line explaining these are expected states);
  - Mark checked per group.
- Each of these tabs gets a "Checked" filter listing marks, with Undo.

- [ ] **Step 1: Write the failing tests:**
  - the default Imports filter excludes stored tournaments and the count matches the summary line;
  - the Parser default excludes info headlines;
  - the "Checked" filters list marks with Undo.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(admin): imports, reports and parser tabs, focused on what needs action`

### Task R7: Seed, browser check, docs

- [ ] **Step 1:** Seed (localhost only; print the host first). Cover every inbox kind, a checked mark, a changed mark, a stored-tournament import failure, info and problem parser warnings, and an epoch `scrapedAt`.
- [ ] **Step 2: Browser check** with Playwright at 390 and 1280, light and dark, on every tab:
  - no console errors, no sideways scroll, 20 px gutters;
  - the inbox Mark checked → Undo round-trip;
  - bulk mark;
  - tab switching keeps params;
  - no "1970";
  - an a11y run.
  Screenshots go to the session scratchpad.
- [ ] **Step 3:** HANDOFF entry (what changed, the migration, rollback); CLAUDE.md admin line.
- [ ] **Step 4:** Full gate. Commit: `docs: admin redesign handoff, seed`


---

## Added 2026-10-31 (owner): fix data gaps from the admin page, plus a "Captured" tab

Owner:
> use the partial scrape and admin page take over tasks to fix format and cap missing issues as well … make a separate tab for tournaments captured — motion balance stats, motion type stats, tournament size and geography stats; think of other potential issues that can use the partial scrape … start reviewing and fixing

Model for every dispatch from here: Sonnet.

**Evidence from a live run (2026-10-31), "Re-scrape suggested" on the 50 lowest-scoring production tournaments:**
- 89 pages loaded, 0 failed, 34 suggested pages not on the tab.
- Only 2 scores rose (ANDL 2025 52→79, Lox Uhuru Worlds 2022 56→66). 48 were unchanged.
- Checks still failing afterwards: Teams in rounds 45, Champion 18, Rooms per round 12, Rounds complete 10, Motions 10, Partners 9.
- Example: TGS Sept 2021's R1–R4 pages load, but Tabbycat 2.12 renders `data: []`, "No Data Available".
- Conclusion: most flags are things the tournament never published, not scrape gaps.

### Task R8: "Not published" is never a failure
- At scrape time, record as `withheld` (reason "not published"):
  - a tab with no nav link (team, speaker, motions, break, participants), when the nav shows the tournament published others;
  - a round page that loads with columns but `data: []`.

  Use `ScrapePiece` with a new optional `reason` column (additive migration). The detail reads "The tournament hasn't published its team tab" or "R3 was published with no results".
- The checks treat these exactly like withheld pages: na, never suggested.
- Tests: an empty round page fixture (TGS-style), a nav without a team tab, and the TGS and Euphoria shapes. "Teams in rounds", "Rounds complete" and "Motions" should drop sharply once deployed.

### Task R9: Missing format
- A check `format_missing`. Fail when `Tournament.format` is null and the tab has rounds. Weight 3.
- Fix action "Infer format": run the existing `inferTournamentFormat` on stored rounds and team sizes. If it can't decide, suggest re-scraping R1 and the team tab.
- A Tools bulk action "Fill missing formats" goes over all tournaments with format null (bounded batches, a status line, a count of filled and not decidable).

### Task R10: Missing adjudication core (CA / CAP)
- Source A: the participants list's Adj Core column (`judgeTypeTag 'core'`; parse it if not parsed yet).
- Source B: the "Tournament Staff" block on the tab home page (free text such as "Core Adjudication Panel: …", "Adjudication: …", "Chief Adjudicator(s): …"). Parse names under CA, CAP, DCA, Core and Adjudication headings. Store them as a role `core` with source `staff_block`, matched to people by name like judges; ambiguous names are not linked.
- A check `core_missing`: warn when neither source names anyone, provided the participants list was read. It suggests the participants piece plus a new `home` piece (the tab home page). Weight 2.
- No `PARSER_VERSION` bump. New data arrives through partial re-scrapes of `participants` and `home`. Tools gets a bulk "Fill missing adjudication cores" action, bounded.
- Evidence and fixtures: `C:/Users/achar/reports/Missing tabs - CA and adjudication core roles 2026-10-27.md`. Expected outcomes are listed there (ASDC 2022, Vivaad 2022, Shri Ram Pre-ABP 2022, 13th CNLU, East Malaysia Open 2022, Pop Posting 2021 = core; SLS PD 2024, The Alfaaz Open = not core).

### Task R11: The "Captured" tab (stats about the stored tournaments)
A tab after Tournaments, in order:
1. **Size:** the distribution of teams per tournament as bins (≤16, 17–32, 33–64, 65–128, 129+), the median, and the largest 10.
2. **Geography:** tournaments by `region` (and by country where known), with an "Unknown region" count.
3. **Formats and years:** counts, including "No format" and "No year" with links to the fixes.
4. **Motion types:** the distribution of `Motion.motionType` and the top topics.
5. **Motion balance:**
   - BP: average points by position (OG / OO / CG / CO), and win share for two-team formats, over all prelim rounds;
   - per motion type: the same split;
   - the 20 most unbalanced motions (position spread, with at least 8 rooms), each linking its tournament.
   - Every figure carries its sample size (UX-35).
6. **Coverage gaps:** counts of missing format, missing year, missing core, unreleased tabs, old parser, with links to the filtered Tournaments list and the bulk fixes.

Charts use `components/ui` primitives (BarList, StatTile) with text alternatives. Reads are aggregate queries, and the tab loads only when it's active.

### Task R12: Other partial-scrape fixes
Each is a check with a suggested piece, or a Tools bulk action, bounded:
- **Old parser:** a tournament scraped by an older `PARSER_VERSION` gets a re-scrape of every recorded piece, rather than a full re-ingest. Tools: "Refresh old-parser tournaments (n)", 20 per run.
- **Motions missing** where the nav links a motions page: re-scrape motions.
- **Break published but not stored**: the nav has break tabs but there are no break rows. Re-scrape the break pieces.
- **Speaker tab published but no scores stored**: re-scrape the speaker tab.
- **Missing year:** read it from the tournament name ("Preworlds24", "Vienna IV 24", "ERR 26") when a 2- or 4-digit year is unambiguous. Tools action "Fill years from names". No scrape needed.
- **Test tournaments** ("test", "DEMO", "minimal8team", blank name): an `ignored` flag, so they leave scores and lists. The admin toggles it.

Order after R2: R8 → R3 → R4 → R5 → R6 → R9 → R10 → R12 → R11 → R7. Each follows the same loop (TDD, gate, task review, fixes). The R7 browser check covers the new tab and actions, and the owner list is updated as items land.
