# parseNav Bridge Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the 2 remaining `parseNav.ts` extractors (`extractAdjudicatorRounds`, `extractSpeakerRounds`) via the `cheerioToVue` adapter — completes the parser-collapse work deferred from sub-project 8.

**Architecture:** Extend the adapter to populate `VueCell.tooltip` from descendant `[data-original-title]` attributes. Broaden `findDebatesVueTable` to take pre-extracted tables + a fuzzy title regex + a cell-class fallback. Update the 2 `*FromVue` consumers with one-line adaptations (extra needle, class-based fallback, `<strong>`-cell win-detection fallback). Replace both extractor bodies with the dual-shot pattern. Delete 4 now-orphaned cheerio helpers. Single commit at the end.

**Tech Stack:** TypeScript 5.7 strict, cheerio 1, Vitest 2 (Node env, mock-driven), npm canonical.

**Spec:** `docs/superpowers/specs/2026-05-23-parsenav-bridge-collapse-design.md`

---

## Pre-flight: branch + baseline

- [ ] **Step 1: Create the feature branch**

```bash
git checkout main
git status
git checkout -b refactor/parsenav-bridge-collapse
```

Expected: clean tree on the new branch.

- [ ] **Step 2: Baseline gates**

```bash
npm test 2>&1 | tail -5
npm run lint 2>&1 | tail -3
npm run typecheck 2>&1 | tail -3
```

Expected: **484 tests passing**, 4 skipped. Lint 1 warning / 0 errors. Typecheck clean.

---

## Task 1: Extend the adapter — populate `VueCell.tooltip` from descendant `data-original-title`

**Files:**
- Modify: `lib/calicotab/cheerioToVue.ts`
- Modify: `tests/calicotab.cheerioToVue.test.ts` (add one test case)

- [ ] **Step 1: Write the failing test case first**

Append this test to `tests/calicotab.cheerioToVue.test.ts` (inside the existing `describe('extractFromCheerio', ...)` block, after the last existing test):

```typescript
  test('populates VueCell.tooltip from descendant [data-original-title] attribute', () => {
    // Tabbycat's Debates table stage cells embed the canonical stage label
    // in a data-original-title on a wrapper div, with abbreviated visible
    // text (e.g. "R1") inside a .tooltip-trigger. The adapter must surface
    // the full label as cell.tooltip so parseNav consumers can read it
    // the same way they read tooltips from native Vue payloads.
    const html = `
      <table>
        <thead><tr><th>R</th><th>Adj</th></tr></thead>
        <tbody>
          <tr>
            <td>
              <div data-original-title="Round 1">
                <span class="tooltip-trigger">R1</span>
              </div>
            </td>
            <td class="adjudicator-name">
              <strong>Owner Name</strong>
            </td>
          </tr>
        </tbody>
      </table>
    `;
    const tables = extractFromCheerio(html);
    expect(tables[0]!.data[0]![0]!.tooltip).toBe('Round 1');
    // The second cell has no descendant data-original-title — tooltip stays undefined.
    expect(tables[0]!.data[0]![1]!.tooltip).toBeUndefined();
  });
```

- [ ] **Step 2: Run the new test — confirm it fails**

```bash
npx vitest run tests/calicotab.cheerioToVue.test.ts -t "tooltip from descendant"
```

Expected: FAIL with `Expected: "Round 1"; Received: undefined`. The adapter doesn't populate `tooltip` yet.

- [ ] **Step 3: Modify `lib/calicotab/cheerioToVue.ts` to populate `cell.tooltip`**

Find the cell-extraction block (currently around lines 64-81). The current cell builder is:

```typescript
const data: VueCell[][] = dataRowEls.map((tr) => {
  const $tr = $(tr);
  return $tr.find('td').map((_j, td) => {
    const $td = $(td);
    const hidden = $td.find('span[hidden]').first().text();
    const trigger = $td.find('.tooltip-trigger').first().text();
    const text = cleanText(
      (hidden && hidden.trim()) ? hidden :
      (trigger && trigger.trim()) ? trigger :
      $td.text(),
    );
    return {
      text,
      html: $td.html() ?? '',
      class: ($td.attr('class') ?? '').trim() || undefined,
    };
  }).get();
});
```

Replace with the same code plus one new field lookup and one extra returned key:

```typescript
const data: VueCell[][] = dataRowEls.map((tr) => {
  const $tr = $(tr);
  return $tr.find('td').map((_j, td) => {
    const $td = $(td);
    const hidden = $td.find('span[hidden]').first().text();
    const trigger = $td.find('.tooltip-trigger').first().text();
    const text = cleanText(
      (hidden && hidden.trim()) ? hidden :
      (trigger && trigger.trim()) ? trigger :
      $td.text(),
    );
    // Surface the first descendant `data-original-title` as cell.tooltip.
    // Tabbycat embeds canonical stage labels here (e.g. data-original-title=
    // "Round 1" on a wrapper div) — without this lift, parseNav consumers
    // can't recover the full stage label from cheerio-adapted tables.
    const tooltip = ($td.find('[data-original-title]').first().attr('data-original-title') ?? '').trim() || undefined;
    return {
      text,
      html: $td.html() ?? '',
      class: ($td.attr('class') ?? '').trim() || undefined,
      ...(tooltip ? { tooltip } : {}),
    };
  }).get();
});
```

Also update the JSDoc block at the top of the file. Find the existing `VueCell.class:` line in the JSDoc and add a `VueCell.tooltip:` entry immediately after it:

```typescript
 *   - VueCell.class: the <td>'s class attribute. Used by parseNav consumers
 *     to find `team-name` cells.
 *   - VueCell.tooltip: first descendant `data-original-title` attribute on
 *     the <td>. Tabbycat embeds canonical stage labels here (e.g. the
 *     "Round 1" full label sitting on a wrapper div with abbreviated visible
 *     text "R1" inside) — surfacing it as cell.tooltip lets parseNav
 *     consumers read stage labels the same way for Vue and cheerio sources.
```

- [ ] **Step 4: Run the new test — should now pass**

```bash
npx vitest run tests/calicotab.cheerioToVue.test.ts
```

Expected: **11 passing** (10 prior + 1 new). All existing cases still pass.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: **485 passing**, 4 skipped (484 baseline + 1 new adapter case). All parseTabs tests still pass (the new field is purely additive — existing consumers never read `cell.tooltip` from cheerio-adapted tables).

---

## Task 2: Refactor `findDebatesVueTable` — take `tables: VueTable[]`, broaden title regex, add cell-class fallback

**Files:**
- Modify: `lib/calicotab/parseNav.ts:426-436` (the function definition)
- Modify: `lib/calicotab/parseNav.ts` (two call sites)

- [ ] **Step 1: Replace the function definition**

Find `findDebatesVueTable` at `lib/calicotab/parseNav.ts:426`. Current:

```typescript
function findDebatesVueTable(html: string): VueTable | null {
  const tables = extractVueData(html);
  if (!tables) return null;
  return (
    tables.find((table) => cleanWhitespace(table.title ?? '').toLowerCase() === 'debates') ??
    tables.find((table) =>
      table.head?.some((h) => (h.key ?? h.title ?? '').toLowerCase().includes('adjudicator')),
    ) ??
    null
  );
}
```

Replace with (signature change + broader title regex + cell-class fallback):

```typescript
function findDebatesVueTable(tables: VueTable[]): VueTable | null {
  // Title-based match: Tabbycat's Debates card is most reliably identified
  // by its title, but the exact label varies across themes ("Debates",
  // "My Debates", "Rounds", "Schedule", "Panel History", "Round
  // Assignments"). The regex covers the common variants.
  const titleMatch = tables.find((table) =>
    /^(my\s+|your\s+)?debates?$|^(my\s+|your\s+)?rounds?$|^schedule$|^panel(s|\s+history)?$|round\s+assignments?/i
      .test(cleanWhitespace(table.title ?? '')),
  );
  if (titleMatch) return titleMatch;

  // Header-based fallback: any table whose head includes an 'adjudicator' /
  // 'judge' key. Captures themes that don't set a title at all.
  const headerMatch = tables.find((table) =>
    table.head?.some((h) =>
      ['adjudicator', 'judge'].some((needle) => (h.key ?? h.title ?? '').toLowerCase().includes(needle)),
    ),
  );
  if (headerMatch) return headerMatch;

  // Cell-class fallback: cheerio-adapted tables from class-driven Tabbycat
  // markup may have bare-abbreviation headers ("R", "Adj") that miss both
  // checks above. Identify the Debates card by the class on any first-row
  // cell — `team-name` or `adjudicator-name` are class signals only the
  // Debates card emits.
  const cellClassMatch = tables.find((table) =>
    table.data?.[0]?.some((cell) => {
      const cls = (cell?.class ?? '').toLowerCase();
      return cls.includes('team-name') || cls.includes('adjudicator-name');
    }),
  );
  return cellClassMatch ?? null;
}
```

- [ ] **Step 2: Update the two existing callers**

`findDebatesVueTable` has two call sites in the same file:

Site 1 — `extractAdjudicatorRoundsFromVue` (around L505):

```typescript
const table = findDebatesVueTable(html);
```

Site 2 — `extractSpeakerRoundsFromVue` (around L761):

```typescript
const table = findDebatesVueTable(html);
```

Both pass `html`. After the signature change they need `tables`. We update them as part of Tasks 3 and 4 (where the consumer signatures change too). For now leave them as `findDebatesVueTable(html)` — TypeScript will flag them as type errors after Step 1 above, which we'll resolve in Tasks 3 and 4.

- [ ] **Step 3: Confirm typecheck breaks at the expected sites**

```bash
npm run typecheck 2>&1 | head -20
```

Expected: 2 errors of the form `Argument of type 'string' is not assignable to parameter of type 'VueTable[]'` at the two call sites in `parseNav.ts`. This confirms the signature change is wired up; the resolution happens in Tasks 3 and 4.

If you see more than 2 errors or errors at unexpected locations, something else is consuming `findDebatesVueTable` — investigate.

---

## Task 3: Refactor `extractAdjudicatorRoundsFromVue` + simplify `extractAdjudicatorRounds`

**Files:**
- Modify: `lib/calicotab/parseNav.ts:501-543` (the `extractAdjudicatorRoundsFromVue` body)
- Modify: `lib/calicotab/parseNav.ts:545-617` (the `extractAdjudicatorRounds` body — delete the cheerio fallback block)

- [ ] **Step 1: Update `extractAdjudicatorRoundsFromVue` signature + body**

Find the function at L501. Current:

```typescript
function extractAdjudicatorRoundsFromVue(
  html: string,
  knownPersonName?: string | null,
): AdjudicatorRound[] | null {
  const table = findDebatesVueTable(html);
  if (!table?.data?.length) return null;
  const roundCol = vueColumn(table, 'round');
  const adjCol = vueColumn(table, 'adjudicator', 'judge');
  if (adjCol < 0) return null;

  const rows: AdjudicatorRound[] = [];
  table.data.forEach((row, idx) => {
    const stageCell = roundCol >= 0 ? row[roundCol] : row[0];
    const stageInfo = stageInfoFromLabel(stageCell?.tooltip ?? stageCell?.text ?? null);
    if (!stageInfo) return;
    const role = extractOwnerRoleFromAdjHtml(vueCellText(row[adjCol]), knownPersonName);
    if (!role) return;
    rows.push({
      stage: stageInfo.stage,
      roundNumber: stageInfo.roundNumber,
      role,
      sequenceIndex: idx + 1,
    });
  });
  return rows.length > 0 ? rows : null;
}
```

Replace with (signature change + `'adj'` needle + cell-class fallback for `adjCol`):

```typescript
function extractAdjudicatorRoundsFromVue(
  tables: VueTable[],
  knownPersonName?: string | null,
): AdjudicatorRound[] | null {
  const table = findDebatesVueTable(tables);
  if (!table?.data?.length) return null;
  const roundCol = vueColumn(table, 'round');
  // 'adj' needle catches bare-abbreviation headers like <th>Adj</th> that
  // cheerio-adapted tables surface. 'adjudicator'/'judge' still catch the
  // full-word headers native Vue payloads use.
  let adjCol = vueColumn(table, 'adjudicator', 'judge', 'adj');
  if (adjCol < 0) {
    // Cell-class fallback: cheerio-adapted markup may have non-descriptive
    // headers but always tags the adjudicator cell with class
    // 'adjudicator-name'. Find the column from the first row's cell classes.
    const firstRow = table.data[0] ?? [];
    adjCol = firstRow.findIndex((cell) => (cell?.class ?? '').toLowerCase().includes('adjudicator-name'));
  }
  if (adjCol < 0) return null;

  const rows: AdjudicatorRound[] = [];
  table.data.forEach((row, idx) => {
    const stageCell = roundCol >= 0 ? row[roundCol] : row[0];
    const stageInfo = stageInfoFromLabel(stageCell?.tooltip ?? stageCell?.text ?? null);
    if (!stageInfo) return;
    const role = extractOwnerRoleFromAdjHtml(vueCellText(row[adjCol]), knownPersonName);
    if (!role) return;
    rows.push({
      stage: stageInfo.stage,
      roundNumber: stageInfo.roundNumber,
      role,
      sequenceIndex: idx + 1,
    });
  });
  return rows.length > 0 ? rows : null;
}
```

- [ ] **Step 2: Replace `extractAdjudicatorRounds` body with dual-shot pattern**

Find the function at L545. Current body is ~70 LOC (Vue path + cheerio fallback). Replace entirely with:

```typescript
export function extractAdjudicatorRounds(
  html: string,
  knownPersonName?: string | null,
): AdjudicatorRound[] {
  const vue = extractVueData(html);
  if (vue) {
    const vueRows = extractAdjudicatorRoundsFromVue(vue, knownPersonName);
    if (vueRows) return vueRows;
  }
  const cheerioTables = extractFromCheerio(html);
  if (cheerioTables.length === 0) return [];
  return extractAdjudicatorRoundsFromVue(cheerioTables, knownPersonName) ?? [];
}
```

The JSDoc above the function (which currently describes the cheerio fallback's role-detection strategies) can stay as-is — it correctly documents the unified consumer's behavior since the consumer reads the same `<strong>` markers + class fallback that the deleted cheerio block did.

- [ ] **Step 3: Add the `extractFromCheerio` import at the top of `parseNav.ts`**

Current imports (around L1-3):

```typescript
import * as cheerio from 'cheerio';
import { extractVueData, type VueCell, type VueTable } from './parseTabs';
import { personNameMatches } from './personMatch';
```

Add the new import:

```typescript
import * as cheerio from 'cheerio';
import { extractVueData, type VueCell, type VueTable } from './parseTabs';
import { extractFromCheerio } from './cheerioToVue';
import { personNameMatches } from './personMatch';
```

- [ ] **Step 4: Run the adjudicator-rounds tests**

```bash
npx vitest run tests/calicotab.parseNav.adjudicator.test.ts
```

Expected: all tests pass. If a test fails, the most likely culprit is the column-detection fallback — verify the test fixture's HTML structure has either an `adjCol` matchable header OR a cell with class `adjudicator-name` in the first row.

---

## Task 4: Refactor `extractSpeakerRoundsFromVue` + simplify `extractSpeakerRounds`

**Files:**
- Modify: `lib/calicotab/parseNav.ts:757-816` (the `extractSpeakerRoundsFromVue` body)
- Modify: `lib/calicotab/parseNav.ts:818-880` (the `extractSpeakerRounds` body)

- [ ] **Step 1: Update `extractSpeakerRoundsFromVue` signature + add `<strong>`-cell win-detection fallback**

Find the function at L757. Current:

```typescript
function extractSpeakerRoundsFromVue(
  html: string,
  knownTeamName?: string | null,
): SpeakerRound[] | null {
  const table = findDebatesVueTable(html);
  if (!table?.data?.length) return null;
  const roundCol = vueColumn(table, 'round');
  const adjCol = vueColumn(table, 'adjudicator', 'judge');
  const wantedTeam = (knownTeamName ?? '').trim().toLowerCase();
  const speakerPrivateRowsAreOwned = isSpeakerPrivateVueDebatesTable(table);
  const rows: SpeakerRound[] = [];

  table.data.forEach((row, idx) => {
    const stageCell = roundCol >= 0 ? row[roundCol] : row[0];
    const stageInfo = stageInfoFromLabel(stageCell?.tooltip ?? stageCell?.text ?? null);
    if (!stageInfo) return;

    let ownedCellRaw: string | null = null;
    let ownedCellClass: string | null = null;
    const owned =
      speakerPrivateRowsAreOwned ||
      row.some((cell, cellIdx) => {
        if (cellIdx === roundCol || cellIdx === adjCol) return false;
        const cls = (cell?.class ?? '').toLowerCase();
        const header = (table.head[cellIdx]?.key ?? table.head[cellIdx]?.title ?? '').toLowerCase();
        if (!cls.includes('team-name') && !/^(og|oo|cg|co|prop|opp|aff|neg|team)/i.test(header)) return false;
        const raw = vueCellText(cell);
        if (/<strong\b/i.test(raw)) {
          ownedCellRaw = raw;
          ownedCellClass = cls;
          return true;
        }
        if (!wantedTeam) return false;
        const plain = cleanWhitespace(cheerio.load(`<div>${raw}</div>`).text()).toLowerCase();
        if (teamCellMatches(plain, wantedTeam)) {
          ownedCellRaw = raw;
          ownedCellClass = cls;
          return true;
        }
        return false;
      });
    if (!owned) return;

    // Win detection inspects both the cell html (icon classes, inline
    // win/loss markers) and the cell-wrapper class (some Tabbycat
    // versions paint `text-success` on the <td> itself rather than an
    // inner <i>). Either signal counts.
    const won = ownedCellRaw
      ? detectWonFromCellHtml(`${ownedCellRaw} ${ownedCellClass ?? ''}`)
      : null;

    rows.push({
      stage: stageInfo.stage,
      roundNumber: stageInfo.roundNumber,
      sequenceIndex: idx + 1,
      won,
    });
  });
  return rows.length > 0 ? rows : null;
}
```

Replace with (signature change + `<strong>`-cell fallback for win detection on speakerPrivateRowsAreOwned rows):

```typescript
function extractSpeakerRoundsFromVue(
  tables: VueTable[],
  knownTeamName?: string | null,
): SpeakerRound[] | null {
  const table = findDebatesVueTable(tables);
  if (!table?.data?.length) return null;
  const roundCol = vueColumn(table, 'round');
  const adjCol = vueColumn(table, 'adjudicator', 'judge', 'adj');
  const wantedTeam = (knownTeamName ?? '').trim().toLowerCase();
  const speakerPrivateRowsAreOwned = isSpeakerPrivateVueDebatesTable(table);
  const rows: SpeakerRound[] = [];

  table.data.forEach((row, idx) => {
    const stageCell = roundCol >= 0 ? row[roundCol] : row[0];
    const stageInfo = stageInfoFromLabel(stageCell?.tooltip ?? stageCell?.text ?? null);
    if (!stageInfo) return;

    let ownedCellRaw: string | null = null;
    let ownedCellClass: string | null = null;
    const owned =
      speakerPrivateRowsAreOwned ||
      row.some((cell, cellIdx) => {
        if (cellIdx === roundCol || cellIdx === adjCol) return false;
        const cls = (cell?.class ?? '').toLowerCase();
        const header = (table.head[cellIdx]?.key ?? table.head[cellIdx]?.title ?? '').toLowerCase();
        if (!cls.includes('team-name') && !/^(og|oo|cg|co|prop|opp|aff|neg|team)/i.test(header)) return false;
        const raw = vueCellText(cell);
        if (/<strong\b/i.test(raw)) {
          ownedCellRaw = raw;
          ownedCellClass = cls;
          return true;
        }
        if (!wantedTeam) return false;
        const plain = cleanWhitespace(cheerio.load(`<div>${raw}</div>`).text()).toLowerCase();
        if (teamCellMatches(plain, wantedTeam)) {
          ownedCellRaw = raw;
          ownedCellClass = cls;
          return true;
        }
        return false;
      });
    if (!owned) return;

    // Win detection: prefer the team-name cell's html (icon classes,
    // inline win/loss markers); also inspect the cell-wrapper class
    // since some Tabbycat versions paint `text-success` on the <td>
    // itself. When speakerPrivateRowsAreOwned is true but no team-name
    // cell matched (cheerio-adapted private-URL Debates tables where
    // the URL owner's team name lives inside a <strong> in some other
    // column), fall back to the first cell containing <strong>.
    let won: boolean | null = null;
    if (ownedCellRaw) {
      won = detectWonFromCellHtml(`${ownedCellRaw} ${ownedCellClass ?? ''}`);
    } else if (speakerPrivateRowsAreOwned) {
      const strongCell = row.find((cell) => /<strong\b/i.test(cell?.html ?? cell?.text ?? ''));
      if (strongCell) {
        const cellHtml = strongCell.html ?? strongCell.text ?? '';
        const cellCls = strongCell.class ?? '';
        won = detectWonFromCellHtml(`${cellHtml} ${cellCls}`);
      }
    }

    rows.push({
      stage: stageInfo.stage,
      roundNumber: stageInfo.roundNumber,
      sequenceIndex: idx + 1,
      won,
    });
  });
  return rows.length > 0 ? rows : null;
}
```

- [ ] **Step 2: Replace `extractSpeakerRounds` body with dual-shot pattern**

Find the function at L818. Current body is ~62 LOC (Vue path + cheerio fallback). Replace entirely with:

```typescript
export function extractSpeakerRounds(
  html: string,
  knownTeamName?: string | null,
): SpeakerRound[] {
  const vue = extractVueData(html);
  if (vue) {
    const vueRows = extractSpeakerRoundsFromVue(vue, knownTeamName);
    if (vueRows) return vueRows;
  }
  const cheerioTables = extractFromCheerio(html);
  if (cheerioTables.length === 0) return [];
  return extractSpeakerRoundsFromVue(cheerioTables, knownTeamName) ?? [];
}
```

- [ ] **Step 3: Run the speaker-rounds tests**

```bash
npx vitest run tests/calicotab.parseNav.won.test.ts tests/calicotab.parseNav.test.ts tests/calicotab.redactedSpeaker.test.ts
```

Expected: all tests pass. If `parseNav.won.test.ts` fails on a `speakerPrivateRowsAreOwned`-true fixture, the most likely culprit is the new `<strong>`-cell fallback — verify the fallback finds the right cell and that `detectWonFromCellHtml` produces the expected boolean.

---

## Task 5: Delete orphaned cheerio helpers + import cleanup + commit

**Files:**
- Modify: `lib/calicotab/parseNav.ts` — delete 4 helper functions, possibly 2 type aliases

- [ ] **Step 1: Grep for remaining callers of each orphaned helper**

```bash
grep -nE "findDebatesTable|isSpeakerPrivateHtmlDebatesTable|extractRowStage|tableHeaderTexts" lib/calicotab/parseNav.ts tests/
```

Expected results, for each helper:
- `findDebatesTable` — only the definition site at L341 should match in `lib/`; no callers (since both call sites were inside the deleted cheerio blocks).
- `isSpeakerPrivateHtmlDebatesTable` — only the definition site at L380; no callers.
- `extractRowStage` — only the definition site at L399; no callers.
- `tableHeaderTexts` — only the definition site at L373; no callers.

If any helper has a remaining caller outside the deleted blocks, DO NOT delete it. Verify each before removing.

Tests in `tests/` should have zero matches for all 4 helper names — they were internal.

- [ ] **Step 2: Delete the 4 orphaned helpers**

In `lib/calicotab/parseNav.ts`, delete:

- The `findDebatesTable` function and its preceding JSDoc (around L341-371)
- The `tableHeaderTexts` function (around L373-378)
- The `isSpeakerPrivateHtmlDebatesTable` function (around L380-397)
- The `extractRowStage` function (around L399-424)

After deletion, also delete any `type CheerioRoot = ...` or `type CheerioSel = ...` aliases that were only used by those helpers. Grep first:

```bash
grep -nE "CheerioRoot|CheerioSel" lib/calicotab/parseNav.ts
```

If matches remain outside the alias-definition lines, keep the aliases. If only definition lines match, delete them.

- [ ] **Step 3: Run full test suite**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: **485 passing**, 4 skipped (484 baseline + 1 new adapter case).
- `npm run lint`: 0 errors, 1 warning (baseline). The helper deletions should not introduce new unused-vars warnings since we deleted them entirely.
- `npm run typecheck`: clean.

If any test fails, investigate before committing — the refactor was supposed to be behavior-preserving.

- [ ] **Step 4: Sanity grep — confirm no orphaned references remain**

```bash
grep -nE "findDebatesTable|isSpeakerPrivateHtmlDebatesTable|extractRowStage|tableHeaderTexts" lib/calicotab/parseNav.ts
grep -nE "extractFromCheerio" lib/calicotab/parseNav.ts
grep -nE "// Cheerio fallback" lib/calicotab/parseNav.ts
```

Expected:
- First grep: **zero matches** (all deletions confirmed).
- Second grep: should match 3 lines — the import + 2 call sites in the dual-shot extractors.
- Third grep: **zero matches** (all cheerio fallback comments deleted with the bodies).

- [ ] **Step 5: Commit**

```bash
git add lib/calicotab/cheerioToVue.ts lib/calicotab/parseNav.ts tests/calicotab.cheerioToVue.test.ts
git commit -m "$(cat <<'EOF'
refactor: collapse parseNav extractors via cheerioToVue bridge (sub-project 8b)

Completes the parser collapse that sub-project 8 deferred. The 2
parseNav extractors (extractAdjudicatorRounds, extractSpeakerRounds)
now share the same dual-shot consumer pattern the 5 parseTabs parsers
use, fed by either extractVueData or the cheerioToVue adapter.

Four targeted consumer enhancements address the root causes the
prior dispatch identified as blockers:

1. cheerioToVue.ts: VueCell.tooltip populated from first descendant
   [data-original-title] attribute. Lets parseNav consumers read
   canonical stage labels uniformly across both sources.

2. findDebatesVueTable (now (tables: VueTable[]) -> VueTable | null):
   broadened title regex covers "Debates" / "My Debates" / "Rounds" /
   "Schedule" / "Panel History" / "Round Assignments"; new cell-class
   fallback matches any table whose first row has a 'team-name' /
   'adjudicator-name' cell.

3. extractAdjudicatorRoundsFromVue: 'adj' added to the vueColumn
   needle list (catches bare-abbreviation <th>Adj</th> headers);
   cell-class fallback uses 'adjudicator-name' on the first row when
   header-key detection misses.

4. extractSpeakerRoundsFromVue: <strong>-cell fallback for win
   detection on speakerPrivateRowsAreOwned rows where no team-name
   cell matched. Mirrors the deleted cheerio fallback's
   $tr.find('td:has(strong)') logic.

extractAdjudicatorRounds and extractSpeakerRounds become 5-line
dual-shot extractors. ~110 LOC of cheerio fallback bodies deleted
along with 4 now-orphaned helpers (findDebatesTable,
tableHeaderTexts, isSpeakerPrivateHtmlDebatesTable, extractRowStage)
plus any unused CheerioRoot/CheerioSel type aliases.

No PARSER_VERSION bump - refactor is behavior-preserving (all
existing parseNav fixtures - both Vue and cheerio - produce identical
output). 485 tests pass (484 baseline + 1 new adapter case).

Spec: docs/superpowers/specs/2026-05-23-parsenav-bridge-collapse-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Post-flight: verification + finishing

- [ ] **Step 1: Final state check**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
npm test 2>&1 | tail -5
npm run lint 2>&1 | tail -3
npm run typecheck 2>&1 | tail -3
```

Expected:
- One commit on the branch.
- 3 files in the diff: `lib/calicotab/cheerioToVue.ts` (+~10 LOC), `lib/calicotab/parseNav.ts` (net ~−110 LOC), `tests/calicotab.cheerioToVue.test.ts` (+~25 LOC for the new case).
- 485 tests passing, lint 1 warning / 0 errors, typecheck clean.

- [ ] **Step 2: Stop and ask the user about push / PR / merge**

Push/PR/merge is a user-visible action per the harness rules. Present the standard `superpowers:finishing-a-development-branch` options:

1. Merge to main locally (pattern used for prior 9 sub-projects).
2. Push + open PR.
3. Keep as-is.
4. Discard.

---

## Self-review

**1. Spec coverage:**

- ✅ Spec In-scope item 1 (adapter `cell.tooltip` from descendant `[data-original-title]`): Task 1.
- ✅ Spec In-scope item 2 (`findDebatesVueTable` refactor — signature change + broader title regex + cell-class fallback): Task 2.
- ✅ Spec In-scope item 3 (`extractAdjudicatorRoundsFromVue` — signature + `'adj'` needle + `adjudicator-name` class fallback): Task 3 Step 1.
- ✅ Spec In-scope item 4 (`extractSpeakerRoundsFromVue` — signature + `<strong>`-cell win-detection fallback): Task 4 Step 1.
- ✅ Spec In-scope item 5 (dual-shot extractors): Task 3 Step 2 + Task 4 Step 2.
- ✅ Spec In-scope item 6 (delete 4 orphaned helpers): Task 5 Step 2.
- ✅ Spec In-scope item 7 (new adapter test case): Task 1 Step 1.

**2. Placeholder scan:** Searched for TBD / TODO / "fill in" / "add appropriate" / "similar to". No matches. Every code step shows complete code.

**3. Type consistency:**
- `findDebatesVueTable(tables: VueTable[])` — defined in Task 2, consumed in Tasks 3 and 4.
- `extractFromCheerio(html: string): VueTable[]` — already exists from sub-project 8 (commit `010aefc`); imported in Task 3 Step 3 and consumed in Tasks 3 and 4.
- `extractAdjudicatorRoundsFromVue(tables, knownPersonName)` / `extractSpeakerRoundsFromVue(tables, knownTeamName)` — signatures align between definition (Tasks 3/4 Step 1) and call site (Tasks 3/4 Step 2).
- Cell field reads (`cell.class`, `cell.html`, `cell.text`, `cell.tooltip`) — all defined in the existing `VueCell` type, consistent across files.

No drift.
