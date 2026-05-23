# Parser Vue/Cheerio Collapse — Design Spec

**Date:** 2026-05-23
**Status:** Approved, ready for plan-writing
**Type:** Refactor (no parser output change, no schema, no `PARSER_VERSION` bump)
**Subsystem:** `lib/calicotab/parseTabs.ts`, `lib/calicotab/parseNav.ts`, + new adapter file

## Goal

Collapse the duplicated Vue-payload + cheerio-fallback parser logic in `lib/calicotab/parseTabs.ts` (5 parsers) and `lib/calicotab/parseNav.ts` (2 extractors) into a single consumer per data type, with a new cheerio → `VueTable` adapter providing the cheerio path through the same surface as the Vue payload.

Net: ~−460 LOC across the two parser files; ~+100 LOC new adapter file; ~+80 LOC new adapter test file; ~+1 field on `VueCell`. Total codebase delta ≈ −280 LOC.

## Motivation

Each of the 7 parsers currently has two near-identical bodies — one for `extractVueData()` output, one operating on `cheerio.load(html)` selectors. The dual paths exist because (a) modern Tabbycat installs emit the parse-target data as a `window.vueData` JS literal that cheerio can't see (no `<table>` elements), and (b) older Tabbycat installs emit only `<table>` HTML with no Vue data island. Today both paths re-implement: column-header detection, cell text cleaning, number/rank parsing, BP position columns, win/loss detection, role classification. Bug fixes have repeatedly needed to land in two places (commits `826072b`, `5bUTHr7`, `cc4f97d`, et al.).

The canonical-mappings spec (`docs/superpowers/specs/2026-05-22-canonical-mappings-design.md`) explicitly deferred this work: *"Parser Vue/cheerio collapse in parseTabs.ts and parseNav.ts beyond the inlined fuzzy matcher swap. Deferred to the parser-collapse sub-project."*

This is sub-project 8.

## Design choice: bridge over deletion

Two alternative approaches were considered and rejected during brainstorming:

- **Drop the cheerio fallback entirely.** Would require auditing every live deployment to confirm none lack the Vue data island. The codebase's recent history (`5bUTHr7` adding feather-icon detection for 2022–2024 deployments) suggests at least some pre-Vue tournaments are still ingested. Cheerio fallback stays.
- **Helper extraction only.** Pulling shared column-finder / cell-cleaner helpers leaves both bodies intact and only modestly shrinks the duplication. Doesn't address the "fix in two places" maintenance burden.

The chosen approach — bridge — keeps the cheerio source of truth (raw HTML) but adapts it into the same `VueTable` shape the Vue path produces. One consumer body per data type. Single place to land future parsing changes.

## In scope

1. **New file `lib/calicotab/cheerioToVue.ts`** (~100 LOC). Single exported function:

   ```typescript
   export function extractFromCheerio(html: string): VueTable[];
   ```

   Behavior:
   - Loads HTML via `cheerio.load`.
   - Iterates every `<table>` element in DOM order.
   - For each table: extracts header cells from `thead tr:first th` (or `tr:first th` if no `thead`), and data rows from `tbody tr` (or all non-header `tr` if no `tbody`).
   - For each cell: populates a `VueCell` with `text` (cleaned via existing `cleanWhitespace` convention), a new `html` field (raw inner HTML — `$.html($td)`), and `class` (the `<td>`'s `class` attribute).
   - Returns the assembled `VueTable[]` array. Empty array if no tables found.

   Does NOT do table-selection logic; emits every table in DOM order. Parser consumers continue to navigate `tables[0]` / `tables[i]` etc. as they do for Vue payloads today.

2. **Extend `VueCell` in `lib/calicotab/parseTabs.ts`** with one new optional field:

   ```typescript
   export type VueCell = {
     text?: string;
     sort?: number | string;
     class?: string;
     tooltip?: string;
     link?: string;
     popover?: unknown;
     html?: string;          // ← NEW. Populated by cheerioToVue adapter only.
   };
   ```

   `html` is populated only by the cheerio adapter; native Vue payloads leave it `undefined`. Consumers that need raw HTML (the 2 parseNav.ts extractors) read `cell.html ?? cell.text` since Tabbycat's Vue payloads historically embed HTML inside the `.text` field for cells that need it (popover triggers, team-name strongs).

3. **Refactor each `parse*` in `lib/calicotab/parseTabs.ts`** (`parseTeamTab`, `parseSpeakerTab`, `parseRoundResults`, `parseBreakPage`, `parseParticipantsList`) to:

   ```typescript
   export function parseXxx(html: string, ...preExtractedArgs): XxxRow[] {
     // ... existing pre-extract logic (e.g., roundLabel resolution in parseRoundResults) stays ...
     const vue = extractVueData(html);
     if (vue) {
       const rows = xxxFromVue(vue, ...);
       if (rows) return rows;
     }
     const cheerioTables = extractFromCheerio(html);
     if (cheerioTables.length === 0) return [];
     return xxxFromVue(cheerioTables, ...) ?? [];
   }
   ```

   The cheerio block in each `parse*` (currently 40–140 LOC per parser) is **deleted**. The `*FromVue` consumer functions in `parseTabs.ts` stay unchanged — they already operate on `VueTable[]` and only read `cell.text` / `cell.class`, both of which the adapter populates. (The `parseNav.ts` consumers do need a small read-site tweak — see In-scope item 4.)

   Dual-shot extraction preserves the existing second-chance behavior: if `extractVueData` returns a non-null Vue payload but `*FromVue(vue)` returns null (Vue payload is present but malformed for this specific parser), the cheerio adapter still gets a turn.

4. **Refactor each extractor in `lib/calicotab/parseNav.ts`** (`extractAdjudicatorRounds`, `extractSpeakerRounds`) the same shape:

   ```typescript
   export function extractXxxRounds(html: string, ...args): XxxRound[] {
     const vue = extractVueData(html);
     if (vue) {
       const rows = extractXxxRoundsFromVue(vue, ...args);
       if (rows) return rows;
     }
     const cheerioTables = extractFromCheerio(html);
     if (cheerioTables.length === 0) return [];
     return extractXxxRoundsFromVue(cheerioTables, ...args) ?? [];
   }
   ```

   The cheerio blocks (currently ~80 LOC each) are deleted. The `*FromVue` consumer bodies need ONE small change: where they currently read `cell.text` for HTML-aware operations (i.e. the `detectWonFromCellHtml(raw)` call site at parseNav.ts:805 and the analogous site for `extractSpeakerRounds`), switch to `cell.html ?? cell.text`. Vue payloads (which carry HTML inside `.text` for these cells) continue to work; cheerio-adapted tables (which carry HTML in `.html`) also work.

   Note: `extractXxxRoundsFromVue` currently includes its own `extractVueData(html)` call at the top, so refactoring its signature from `(html, ...args)` to `(tables, ...args)` is part of this change. Same for `extractSpeakerRoundsFromVue`.

5. **Pure-cheerio functions that stay untouched** in `parseNav.ts`: `extractNavigation`, `extractRegistration`, `parsePrivateUrlPage`'s opener block, `findDebatesTable`, `isSpeakerPrivateHtmlDebatesTable`, `extractRowStage`, `findTableByHeader` (in parseTabs.ts). These don't parse Vue-eligible tabular data — they read page metadata or auxiliary structures. Out of scope.

6. **Tests**:

   - **New file** `tests/calicotab.cheerioToVue.test.ts` (~80 LOC, 4–5 cases): basic table → `VueTable` shape, multi-table HTML → ordered `VueTable[]`, header detection without `<thead>`, cell `class` and `html` populated, no-tables HTML → empty array.
   - **Existing tests stay** without modification. Every existing parser test (covering both Vue fixtures and HTML fixtures) must continue to pass — that's the load-bearing behavior contract. Specifically: `tests/parseTabs.breakPage.test.ts`, `tests/parseTabs.rankColumns.test.ts`, `tests/parseTabs.roundResults.test.ts`, `tests/parseNav.realMarkup.test.ts`, `tests/calicotab.parseParticipantsList.test.ts`, `tests/calicotab.parseNav.adjudicator.test.ts`, `tests/calicotab.parseNav.test.ts`, `tests/calicotab.parseNav.won.test.ts`, `tests/calicotab.redactedSpeaker.test.ts`. If any of these tests fail post-refactor, the bridge or the consumer tweak is wrong.

## Explicitly out of scope

- **No `PARSER_VERSION` bump.** The refactor is meant to be behavior-preserving — bumping would invalidate every user's cached parses across all tournaments to "let production surface bugs," which contradicts the bridge approach's whole promise. Test coverage is the safety net. The seven prior sub-projects didn't bump either. CLAUDE.md: *"Do not bump PARSER_VERSION casually — it invalidates cached parses across all users."*
- **No `findTableByHeader`-style table-selection logic in the adapter.** Adapter emits all tables in DOM order; consumers select. Mirrors Vue payload semantics.
- **No deletion of the cheerio-only paths in `parseNav.ts`** for non-table content (nav, registration, private-URL opener). Those don't have a Vue analog.
- **No schema change.**
- **No new dependency.** `cheerio` and `cheerio.load` are already imported.
- **No `VueCell.tooltip` / `VueCell.popover` cheerio-adapter population.** Native Vue payloads carry these; cheerio-adapted tables don't need them because no current consumer reads `cell.tooltip` on the cheerio path. If a future parser needs them, the adapter can be extended then.
- **No retroactive TDD of stable behaviors not currently tested.** Existing tests stay; one new file covers the adapter.
- **No restructuring of the cheerio-only helper functions** (`findTableByHeader`, `findDebatesTable`, etc.) — they're consumed by the out-of-scope pure-cheerio paths and don't need to change.

## File layout

| File | Change |
|---|---|
| `lib/calicotab/cheerioToVue.ts` | **+ NEW** ~100 LOC. Single exported `extractFromCheerio(html): VueTable[]`. Imports `cheerio` and `type { VueTable, VueCell, VueHead } from './parseTabs'`. |
| `lib/calicotab/parseTabs.ts` | **+1 field** on `VueCell` (`html?: string`). **−400 LOC** total: deletes the cheerio blocks inside `parseTeamTab` (~40 LOC), `parseSpeakerTab` (~90 LOC), `parseRoundResults` (~140 LOC), `parseBreakPage` (~50 LOC), `parseParticipantsList` (~80 LOC). **+~50 LOC** total: each `parse*` gains the 5-line `extractFromCheerio` fallback block. Net ~−350 LOC. |
| `lib/calicotab/parseNav.ts` | **−~130 LOC**: deletes the cheerio blocks in `extractAdjudicatorRounds` and `extractSpeakerRounds`. **+~20 LOC**: each gets the 5-line fallback block. `extractAdjudicatorRoundsFromVue` and `extractSpeakerRoundsFromVue` change signature from `(html, ...)` to `(tables, ...)`. Inside those, the `detectWonFromCellHtml(raw)` site (currently reading `cell.text`) reads `cell.html ?? cell.text`. Net ~−110 LOC. |
| `tests/calicotab.cheerioToVue.test.ts` | **+ NEW** ~80 LOC. 4–5 cases covering adapter behavior in isolation. |
| `lib/calicotab/version.ts` | **No change.** No `PARSER_VERSION` bump. |

## Behavior preservation

For each of the 7 parsers:

- **Vue payload present + `*FromVue` returns rows** → identical to today (same rows returned).
- **No Vue payload + HTML is parseable by cheerio adapter** → adapter produces `VueTable[]` with the same row count and same column semantics as the existing cheerio block extracted, and `*FromVue` consumes it. Result row shapes are identical because `*FromVue` is the same code that processes Vue payloads, and the adapter populates the same `VueCell` fields (`text`, `class`) that consumers read.
- **No Vue payload + cheerio adapter finds no tables** → identical to today (returns `[]`).
- **Vue payload present but `*FromVue` returns null + cheerio also returns rows** → identical to today via the dual-shot fallback. Rare in practice; preserved by design.

The one carefully-targeted behavior change is in the `detectWonFromCellHtml` call site inside `extractSpeakerRoundsFromVue` and `extractAdjudicatorRoundsFromVue`: the `raw` argument changes from `vueCellText(cell)` (returns `cell.text` string-coerced) to `cell.html ?? vueCellText(cell)`. For Vue payloads `cell.html` is `undefined`, so the expression evaluates to `cell.text` — identical to today. For cheerio-adapted cells, `cell.html` is populated with raw inner HTML, which `detectWonFromCellHtml` parses with the same regex it already uses on the cheerio path. No new behavior; the change is a unified read.

## Verification

- `npm test` — all 468 existing tests pass unchanged + ~5 new adapter tests pass (target: ~473 passing).
- `npm run lint` — clean (baseline 2 warnings).
- `npm run typecheck` — clean. Adding `html?: string` to `VueCell` is a non-breaking extension.
- Manual: re-run the env-gated live smoke test (`tests/__smoke.live.test.ts`) against a known Tabbycat URL. The smoke test fetches a real tournament and asserts parser output shape; if the bridge regresses any field, this catches it.
- Manual: spot-check `/cv` and `/u/<slug>` for a few existing users post-deploy. No CV rows should shift values.

## Risk

- **Adapter completeness.** The cheerio path historically had subtle differences from the Vue path (header-detection variants, BP position columns, redacted-row handling). The unified `*FromVue` consumer was designed against Vue payloads; if it inadvertently rejects cheerio-shaped input on some edge case, that parser silently degrades on old tournaments. **Mitigation:** every parser already has tests with HTML fixtures, and the spec mandates all of them pass unchanged post-refactor. Add adapter-specific cases for any edge case discovered during implementation.
- **`VueCell.html` field convention drift.** If a future Vue payload starts populating `.html`, downstream consumers will read it preferentially over `.text` (per the `cell.html ?? cell.text` pattern in parseNav). That's the desired behavior — but worth a code comment at the field's declaration so future devs don't accidentally populate `.html` from Vue without intending the consumer behavior change.
- **`extractFromCheerio` table selection.** The current cheerio blocks sometimes use `findTableByHeader` to pick the right table. The adapter emits every table in DOM order. The risk is that a parser's `*FromVue` consumer picks `tables[0]` when the right one is `tables[1]` in the cheerio-adapted layout. **Mitigation:** the Vue payload also emits all tables, and consumers already navigate them — same convention. Test fixtures will catch any mismatch.
- **Behavior on malformed cells.** Cheerio's `$.html($td)` and `$(td).text()` both have edge cases (script/style content, nested HTML, self-closing tags). The existing cheerio paths already trip these; the adapter inherits whatever cheerio produces. No new risk; same surface.

## Cross-references

- Previous sub-projects: 7 in `docs/superpowers/specs/`. This is sub-project 8.
- Item deferred from: `docs/superpowers/specs/2026-05-22-canonical-mappings-design.md` § "Explicitly out of scope", item 3.
- Adjacent unstarted sub-project: 9 (ingest.ts pipeline decomposition).
- CLAUDE.md rules honored: no `PARSER_VERSION` bump, no queue lock-order change, no schema change, no new dependency, no state-management / ORM / test-framework introduction, no retroactive TDD of stable code beyond the one new adapter test file this change introduces.
