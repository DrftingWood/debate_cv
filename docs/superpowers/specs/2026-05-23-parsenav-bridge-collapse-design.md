# parseNav Bridge Collapse — Design Spec

**Date:** 2026-05-23
**Status:** Approved, ready for plan-writing
**Type:** Refactor (no parser output change, no schema, no `PARSER_VERSION` bump)
**Subsystem:** `lib/calicotab/parseNav.ts` + small extension to `lib/calicotab/cheerioToVue.ts`

## Goal

Finish the parser Vue/cheerio collapse that sub-project 8 started. Sub-project 8 collapsed the 5 `parseTabs.ts` parsers via the new `cheerioToVue` adapter but explicitly carved out the 2 `parseNav.ts` extractors (`extractAdjudicatorRounds`, `extractSpeakerRounds`) because their cheerio HTML was class-driven (not header-key-driven) and the adapter as-shipped couldn't bridge them without consumer rewrites.

This sub-project (8b) adds the missing adapter capability (`cell.tooltip` from descendant `data-original-title`), broadens the parseNav consumers to handle both Vue payloads and cheerio-adapted tables uniformly, deletes the now-orphaned cheerio fallback bodies in `parseNav.ts`, and deletes the helper functions that fed them.

## Motivation

The previous dispatch's diagnosis identified four blockers for the parseNav bridge:

1. Cheerio HTML uses bare-abbreviation headers (`<th>R</th>`, `<th>Adj</th>`) — `vueColumn(table, 'adjudicator', 'judge')` returns -1 because `'adj'.includes('adjudicator')` is false.
2. Stage labels live on descendant `data-original-title` attributes (`<div data-original-title="Round 1"><span class="tooltip-trigger">R1</span></div>`), not on the cell text.
3. `findDebatesVueTable` only matched `title === 'debates'`. Cheerio HTML has no inherent title; it had to fall back to broader signals.
4. `extractSpeakerRoundsFromVue`'s win detection relies on finding the team-name cell. On `speakerPrivateRowsAreOwned` rows the team-name cell may not exist; the old cheerio path had a `<strong>`-cell fallback for that case.

Sub-project 8 user accepted "Path A" (carve parseNav out) with the understanding that 8b would tackle these. 8b is that.

## In scope

1. **`lib/calicotab/cheerioToVue.ts` extension** (~7 LOC). Populate `VueCell.tooltip` from the first descendant `[data-original-title]` attribute on each `<td>`. Same for `<th>` (the data-original-title may live on a child wrapper rather than the th itself — though the existing th-attribute read already handles the common case; this extension is the cell-level analog). When no descendant has the attribute, `tooltip` stays `undefined`.

2. **`findDebatesVueTable` refactor**:
   - Signature changes from `(html: string) => VueTable | null` to `(tables: VueTable[]) => VueTable | null`. Callers pass the already-extracted tables array.
   - Title matching broadens from strict `=== 'debates'` to a fuzzy regex covering `/^(my\s+|your\s+)?debates?$|^(my\s+|your\s+)?rounds?$|^schedule$|^panel(s|\s+history)?$|round\s+assignments?/i`.
   - Existing header-fallback (matching `adjudicator` in a head key/title) stays.
   - New cell-class fallback: any table whose first data row has at least one cell with `class*='adjudicator-name'` or `class*='team-name'`.

3. **`extractAdjudicatorRoundsFromVue` refactor**:
   - Signature changes from `(html: string, knownPersonName?: string | null)` to `(tables: VueTable[], knownPersonName?: string | null)`. The internal `findDebatesVueTable(html)` call becomes `findDebatesVueTable(tables)`.
   - Add `'adj'` to the `vueColumn` needle list so bare-abbreviation `<th>Adj</th>` headers match. Existing `'adjudicator'`, `'judge'` needles stay.
   - When `adjCol` still doesn't match (no recognizable header at all), add a cell-class fallback: scan the first row for any cell with `class*='adjudicator-name'` and use that column index. Captures the BP-style class-driven layout.

4. **`extractSpeakerRoundsFromVue` refactor**:
   - Same signature change `(tables, knownTeamName?)`.
   - `<strong>`-cell fallback for win detection: when `speakerPrivateRowsAreOwned` is true and no team-name cell matched the wantedTeam, find the first cell containing `<strong>` (in `cell.html ?? cell.text`) and use that cell's html + class for `detectWonFromCellHtml`. This mirrors the existing cheerio fallback at `parseNav.ts:865-867` (`const strongCells = $tr.find('td:has(strong)');`).

5. **`extractAdjudicatorRounds` and `extractSpeakerRounds` body refactor**:
   - Replace each body with the dual-shot pattern used by the 5 parseTabs parsers from sub-project 8:
     ```typescript
     const vue = extractVueData(html);
     if (vue) {
       const rows = extractXxxRoundsFromVue(vue, ...);
       if (rows) return rows;
     }
     const cheerioTables = extractFromCheerio(html);
     if (cheerioTables.length === 0) return [];
     return extractXxxRoundsFromVue(cheerioTables, ...) ?? [];
     ```
   - Delete the cheerio fallback bodies (currently ~60 LOC + ~50 LOC, total ~110 LOC of duplicated logic).

6. **Delete pure-cheerio helpers that were only used by the deleted bodies**:
   - `findDebatesTable($)` (parseNav.ts:341)
   - `tableHeaderTexts($, table)` (parseNav.ts:373) — verify zero remaining callers
   - `isSpeakerPrivateHtmlDebatesTable($, table)` (parseNav.ts:380)
   - `extractRowStage($, $tr)` (parseNav.ts:399) — verify zero remaining callers
   - `CheerioRoot` / `CheerioSel` type aliases if no other consumer remains

7. **New adapter test case** in `tests/calicotab.cheerioToVue.test.ts`: assert that `cell.tooltip` is populated from a descendant `[data-original-title]` attribute. Match the fixture shape parseNav consumers will see.

## Behavior preservation

For each existing test fixture:
- Vue payload → unchanged (cell.tooltip is already populated for Vue inputs that have it; the extension only affects cheerio-adapted cells).
- Cheerio fixture with bare-abbreviation headers → previously routed through the cheerio fallback block; now routes through the bridge and the unified `*FromVue` consumer with the broadened needle list + class-based column fallback. Output rows are identical because the underlying win-detection / role-detection / stage-detection logic is the same.

Specifically: every test in `tests/calicotab.parseNav.adjudicator.test.ts`, `tests/calicotab.parseNav.test.ts`, `tests/calicotab.parseNav.won.test.ts`, `tests/parseNav.realMarkup.test.ts`, and `tests/calicotab.redactedSpeaker.test.ts` must pass unchanged. That's the load-bearing contract.

## Out of scope

- **No `PARSER_VERSION` bump.** Refactor is behavior-preserving — all existing fixtures (both Vue and cheerio) produce identical output.
- **No schema, no queue lock changes, no new dependency.**
- **No further dedup beyond the 2 parseNav extractors.** Pure-cheerio paths (`extractNavigation`, `extractRegistration`, `parsePrivateUrlPage` opener block) stay untouched — they don't parse Vue-eligible tabular data.
- **No retroactive TDD** of stable behavior beyond the one new adapter test case (`cell.tooltip` populated from descendant attribute).

## File layout

| File | Change |
|---|---|
| `lib/calicotab/cheerioToVue.ts` | **+~7 LOC**. Populate `VueCell.tooltip` from descendant `[data-original-title]`. JSDoc comment updated to note this. |
| `lib/calicotab/parseNav.ts` | **−~140 LOC** (delete 2 cheerio fallback bodies + 4 helper functions + ~10 LOC of unused type aliases) **+~30 LOC** (4 consumer enhancements + 2 dual-shot extractor bodies). Net ~−110 LOC. |
| `tests/calicotab.cheerioToVue.test.ts` | **+1 case** asserting cell.tooltip populated from descendant data-original-title. |

## Verification

- `npm test` — 485 passing (484 baseline + 1 new adapter case), 4 skipped.
- `npm run lint` — clean (0 errors; baseline 1 warning). Deletions of unused helpers should not introduce new unused-vars warnings.
- `npm run typecheck` — clean. The signature change of `findDebatesVueTable` cascades through both callers; TypeScript catches any miss.
- Manual: env-gated live smoke (`tests/__smoke.live.test.ts`) against a real Tabbycat URL ingests a tournament end-to-end and verifies the parseNav path produces the same data shape.

## Risk

- **Existing test coverage of parseNav cheerio path is genuine and load-bearing.** The previous dispatch failed at 29 tests when the consumer-side changes weren't made. This spec's consumer-side changes (item 3's `'adj'` needle + class fallback, item 4's `<strong>` fallback, item 2's broader title regex + cell-class fallback in `findDebatesVueTable`) directly address each of those 29 failures' root causes. If a test still fails after this commit, the cause is something the previous dispatch didn't surface — investigate before claiming behavior preservation.
- **The `<strong>`-cell fallback in `extractSpeakerRoundsFromVue` is the most subtle change.** The existing Vue-payload code path doesn't hit this fallback (Vue payloads always populate the team cell). The fallback only fires on cheerio-adapted tables where `speakerPrivateRowsAreOwned` is true AND no team-name cell exists. The mirror in the existing cheerio fallback path (parseNav.ts:865-867 — `$tr.find('td:has(strong)')`) is the reference behavior to match.

## Cross-references

- Previous sub-projects: 9 in `docs/superpowers/specs/`. This is sub-project 8b (continuation of 8).
- Carved out from: `docs/superpowers/specs/2026-05-23-parser-vue-cheerio-collapse-design.md` (sub-project 8's spec) + the prior dispatch's BLOCKED report that identified the 4 root causes.
- Adjacent unstarted sub-project: 9b (roles-table-authoritative `isJudge` with backfill + PARSER_VERSION bump).
- CLAUDE.md rules honored: no `PARSER_VERSION` bump, no queue lock-order change, no schema change, no new dependency, no retroactive TDD of stable code beyond the one new adapter test case this change requires.
