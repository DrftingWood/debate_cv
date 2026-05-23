# Parser Vue/Cheerio Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the 7 dual-path parsers in `lib/calicotab/parseTabs.ts` (5) and `lib/calicotab/parseNav.ts` (2) into single consumers fed by either the existing Vue extractor OR a new `cheerioToVue.ts` adapter that converts raw HTML tables into the same `VueTable` shape.

**Architecture:** New `lib/calicotab/cheerioToVue.ts` (~150 LOC, encodes Tabbycat-specific HTML conventions: card-title hoisting, `span[hidden]` preferred cell text, `data-original-title` header preference, `<td>` class preservation, raw inner HTML preservation). `VueCell` extends with one optional `html?: string` field. Each `parse*` becomes a 5-line dual-shot extractor; cheerio fallback bodies (~530 LOC gross) are deleted. parseNav's `*FromVue` consumers gain a one-line tweak (`cell.html ?? cell.text`) and a signature change. parseParticipantsList's `participantsFromVue` gains a `table.title` section-inference read plus feather-check flag detection.

**Tech Stack:** Cheerio 1 (already imported), TypeScript 5.7 strict, Vitest 2 (Node env, mock-driven), npm canonical. Path alias `@/*` → repo root.

**Spec:** `docs/superpowers/specs/2026-05-23-parser-vue-cheerio-collapse-design.md`

**Two commits at end of branch:** Task 1 commits the adapter foundation by itself; Tasks 2–3 land all parser refactors as a second commit. This makes the diff reviewable in two coherent units (adapter alone is meaningful and testable; the parser collapse uses it).

---

## Pre-flight: branch setup & baseline

- [ ] **Step 1: Create the feature branch**

```bash
git checkout main
git status
git checkout -b refactor/parser-vue-cheerio-collapse
git status
```

Expected: clean tree on `refactor/parser-vue-cheerio-collapse`, only `.claude/settings.local.json` untracked.

- [ ] **Step 2: Confirm baseline is green**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: **468 tests pass**, 4 skipped (current main after sub-project 7 landed).
- `npm run lint`: **2 warnings, 0 errors** (the two baseline `unused vars` in `parseTabs.ts:1112` and `scripts/test-scrape.mjs:16`).
- `npm run typecheck`: clean.

If anything regresses on freshly-branched `main`, stop and flag.

---

## Task 1: Adapter foundation + VueCell.html field + adapter tests

**Files:**
- Modify: `lib/calicotab/parseTabs.ts:14-22` (extend `VueCell` type)
- Create: `lib/calicotab/cheerioToVue.ts`
- Create: `tests/calicotab.cheerioToVue.test.ts`

Single commit at the end of this task.

- [ ] **Step 1: Extend the `VueCell` type with `html?: string`**

Find the existing type definition at `lib/calicotab/parseTabs.ts:13-22`:

```typescript
export type VueHead = { key?: string; title?: string; tooltip?: string };
export type VueCell = {
  text?: string;
  sort?: number | string;
  class?: string;
  tooltip?: string;
  link?: string;
  popover?: unknown;
};
export type VueTable = { title?: string; subtitle?: string; head: VueHead[]; data: VueCell[][] };
```

Replace with (adds one line — `html?: string` — and a short comment explaining its provenance):

```typescript
export type VueHead = { key?: string; title?: string; tooltip?: string };
export type VueCell = {
  text?: string;
  sort?: number | string;
  class?: string;
  tooltip?: string;
  link?: string;
  popover?: unknown;
  // Populated only by the cheerio→VueTable adapter (lib/calicotab/cheerioToVue.ts).
  // Native Vue payloads from Tabbycat leave this undefined — they embed HTML
  // inside `text` instead, which is why parseNav's HTML-aware consumers read
  // `cell.html ?? cell.text` to converge both sources.
  html?: string;
};
export type VueTable = { title?: string; subtitle?: string; head: VueHead[]; data: VueCell[][] };
```

- [ ] **Step 2: Write the failing tests first (TDD)**

Create `tests/calicotab.cheerioToVue.test.ts` with the following exact content:

```typescript
import { describe, expect, test } from 'vitest';
import { extractFromCheerio } from '@/lib/calicotab/cheerioToVue';

describe('extractFromCheerio', () => {
  test('returns empty array when HTML has no tables', () => {
    const tables = extractFromCheerio('<div><p>nothing here</p></div>');
    expect(tables).toEqual([]);
  });

  test('extracts a single basic table into VueTable shape', () => {
    const html = `
      <table>
        <thead><tr><th>Rank</th><th>Team</th><th>Points</th></tr></thead>
        <tbody>
          <tr><td>1</td><td>Alpha</td><td>10</td></tr>
          <tr><td>2</td><td>Beta</td><td>8</td></tr>
        </tbody>
      </table>
    `;
    const tables = extractFromCheerio(html);
    expect(tables).toHaveLength(1);
    const t = tables[0]!;
    expect(t.head.map((h) => h.title)).toEqual(['Rank', 'Team', 'Points']);
    expect(t.head.map((h) => h.key)).toEqual(['rank', 'team', 'points']);
    expect(t.data).toHaveLength(2);
    expect(t.data[0]!.map((c) => c.text)).toEqual(['1', 'Alpha', '10']);
    expect(t.data[1]!.map((c) => c.text)).toEqual(['2', 'Beta', '8']);
  });

  test('emits multiple tables in DOM order', () => {
    const html = `
      <table><thead><tr><th>A</th></tr></thead><tbody><tr><td>first</td></tr></tbody></table>
      <table><thead><tr><th>B</th></tr></thead><tbody><tr><td>second</td></tr></tbody></table>
    `;
    const tables = extractFromCheerio(html);
    expect(tables).toHaveLength(2);
    expect(tables[0]!.head[0]!.title).toBe('A');
    expect(tables[0]!.data[0]![0]!.text).toBe('first');
    expect(tables[1]!.head[0]!.title).toBe('B');
    expect(tables[1]!.data[0]![0]!.text).toBe('second');
  });

  test('handles tables without <thead> by reading first row as headers', () => {
    const html = `
      <table>
        <tr><th>Round</th><th>Score</th></tr>
        <tr><td>R1</td><td>76</td></tr>
      </table>
    `;
    const tables = extractFromCheerio(html);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.head.map((h) => h.title)).toEqual(['Round', 'Score']);
    expect(tables[0]!.data).toHaveLength(1);
    expect(tables[0]!.data[0]!.map((c) => c.text)).toEqual(['R1', '76']);
  });

  test('populates VueCell.html with raw inner HTML for icon detection', () => {
    const html = `
      <table>
        <thead><tr><th>Team</th><th>Result</th></tr></thead>
        <tbody>
          <tr>
            <td><strong>Alpha</strong></td>
            <td><i class="text-success result-icon"><svg class="feather feather-chevrons-up"></svg></i></td>
          </tr>
        </tbody>
      </table>
    `;
    const tables = extractFromCheerio(html);
    const cells = tables[0]!.data[0]!;
    expect(cells[0]!.text).toBe('Alpha');
    expect(cells[0]!.html).toMatch(/<strong>Alpha<\/strong>/);
    expect(cells[1]!.html).toMatch(/feather-chevrons-up/);
  });

  test('populates VueCell.class from the <td> class attribute', () => {
    const html = `
      <table>
        <thead><tr><th>Team</th></tr></thead>
        <tbody>
          <tr><td class="team-name text-success"><strong>Alpha</strong></td></tr>
        </tbody>
      </table>
    `;
    const tables = extractFromCheerio(html);
    expect(tables[0]!.data[0]![0]!.class).toMatch(/team-name/);
    expect(tables[0]!.data[0]![0]!.class).toMatch(/text-success/);
  });

  test('prefers span[hidden] text when present (Tabbycat sortable canonical value)', () => {
    const html = `
      <table>
        <thead><tr><th>Team</th></tr></thead>
        <tbody>
          <tr>
            <td>
              <span hidden>Akbar → Jahangir → Shah Jahan</span>
              <i class="emoji">🍓</i>
              <span class="tooltip-trigger">Akbar → Jahangir → Shah Jahan</span>
              <span>Robin Ahuja, K Dhruv Singh, Kinshuk Vasan</span>
            </td>
          </tr>
        </tbody>
      </table>
    `;
    const tables = extractFromCheerio(html);
    expect(tables[0]!.data[0]![0]!.text).toBe('Akbar → Jahangir → Shah Jahan');
  });

  test('falls back to tooltip-trigger text when span[hidden] absent', () => {
    const html = `
      <table>
        <thead><tr><th>Name</th></tr></thead>
        <tbody>
          <tr>
            <td>
              <span class="tooltip-trigger">Abhishek Acharya</span>
            </td>
          </tr>
        </tbody>
      </table>
    `;
    const tables = extractFromCheerio(html);
    expect(tables[0]!.data[0]![0]!.text).toBe('Abhishek Acharya');
  });

  test('prefers data-original-title for header keys when present', () => {
    const html = `
      <table>
        <thead>
          <tr>
            <th data-original-title="Member of the Adjudication Core"><span>Adj Core</span></th>
            <th data-original-title="Independent Adjudicator"><span>Independent</span></th>
          </tr>
        </thead>
      </table>
    `;
    const tables = extractFromCheerio(html);
    expect(tables[0]!.head[0]!.key).toBe('member of the adjudication core');
    expect(tables[0]!.head[0]!.title).toBe('Adj Core');
    expect(tables[0]!.head[1]!.key).toBe('independent adjudicator');
  });

  test('hoists preceding .card-title heading into table.title', () => {
    const html = `
      <div class="card">
        <div class="card-body">
          <h4 class="card-title">Adjudicators</h4>
          <table>
            <thead><tr><th>Name</th></tr></thead>
            <tbody><tr><td>Aadyant</td></tr></tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-body">
          <h4 class="card-title">Speakers</h4>
          <table>
            <thead><tr><th>Name</th></tr></thead>
            <tbody><tr><td>Robin Ahuja</td></tr></tbody>
          </table>
        </div>
      </div>
    `;
    const tables = extractFromCheerio(html);
    expect(tables).toHaveLength(2);
    expect(tables[0]!.title).toBe('Adjudicators');
    expect(tables[1]!.title).toBe('Speakers');
  });
});
```

- [ ] **Step 3: Run the new tests to confirm they fail**

```bash
npx vitest run tests/calicotab.cheerioToVue.test.ts
```

Expected: All cases FAIL with module-not-found errors (`Failed to resolve import "@/lib/calicotab/cheerioToVue"`). The adapter file doesn't exist yet.

- [ ] **Step 4: Create `lib/calicotab/cheerioToVue.ts`**

Create the file with the following exact content:

```typescript
import * as cheerio from 'cheerio';
import type { VueCell, VueHead, VueTable } from './parseTabs';

/**
 * Converts every <table> in `html` into the VueTable shape that Tabbycat's
 * Vue data island uses. Bridge for the parser Vue/cheerio collapse
 * (sub-project 8): one parser body per data type consumes VueTable[]
 * regardless of whether the source was a real Vue payload or this adapter's
 * output.
 *
 * Encodes Tabbycat-specific HTML conventions:
 *   - table.title: hoisted from a preceding `.card-title` heading inside the
 *     same `.card` / `.card-body` container (Tabbycat's participants-list and
 *     similar pages use these headings to differentiate sections like
 *     "Adjudicators" vs "Speakers" — without this, downstream parsers can't
 *     tell which table is which).
 *   - VueHead.key: prefers `data-original-title` (the tooltip carries the
 *     full label like "Member of the Adjudication Core" where the visible
 *     <th> text is just "Adj Core"); falls back to lower-cased visible text.
 *   - VueHead.title: visible <th> text as-is.
 *   - VueCell.text: prefers `span[hidden]` text (Tabbycat's sortable canonical
 *     value, used to escape from team-name cells crammed with emoji icons,
 *     tooltip triggers, and popovers); falls back to `.tooltip-trigger` text;
 *     final fallback is the cleaned full cell text.
 *   - VueCell.html: raw inner HTML of the <td>. Used by parseNav's HTML-aware
 *     consumers for icon-based win detection. Always populated.
 *   - VueCell.class: the <td>'s class attribute. Used by parseNav consumers
 *     to find `team-name` cells.
 *
 * Returns tables in DOM order. Empty array if no tables found.
 */
export function extractFromCheerio(html: string): VueTable[] {
  const $ = cheerio.load(html);
  const tables: VueTable[] = [];

  $('table').each((_i, tableEl) => {
    const $table = $(tableEl);

    // Headers: prefer <thead tr:first>; fall back to the first <tr> if no <thead>.
    const $headerRow = $table.find('thead tr').first().length
      ? $table.find('thead tr').first()
      : $table.find('tr').first();
    const head: VueHead[] = $headerRow.find('th').map((_j, th) => {
      const $th = $(th);
      const visibleText = cleanText($th.text());
      const tooltip = ($th.attr('data-original-title') ?? '').trim();
      const key = (tooltip || visibleText).toLowerCase();
      return { key, title: visibleText };
    }).get();

    // Data rows: prefer <tbody tr>; fall back to all <tr> minus the header row
    // when <tbody> isn't present.
    const dataRowEls = $table.find('tbody tr').length
      ? $table.find('tbody tr').toArray()
      : $table.find('tr').toArray().filter((tr) => tr !== $headerRow.get(0));

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
          html: $.html($td) ?? '',
          class: ($td.attr('class') ?? '').trim() || undefined,
        };
      }).get();
    });

    // Title: hoisted from a preceding .card-title heading inside the same
    // .card / .card-body container. Tabbycat marks section roles
    // (Adjudicators / Speakers) this way; without it the participants-list
    // parser can't distinguish the two tables on a single page.
    const $cardBody = $table.closest('.card-body, .card');
    const cardTitle = $cardBody.length
      ? cleanText($cardBody.find('.card-title').first().text())
      : '';
    const title = cardTitle || undefined;

    tables.push({ head, data, ...(title ? { title } : {}) });
  });

  return tables;
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 5: Run the adapter tests — they should now pass**

```bash
npx vitest run tests/calicotab.cheerioToVue.test.ts
```

Expected: all 10 cases PASS.

If `text` assertions fail on the `span[hidden]` or `.tooltip-trigger` cases, check Step 4's `cleanText` invocation — `s.replace(/\s+/g, ' ').trim()` must collapse the leading/trailing whitespace from the fixture's multi-line `<span hidden>` content.

- [ ] **Step 6: Run the full test suite + lint + typecheck**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: **478 passing** (baseline 468 + 10 new adapter cases), 4 skipped. **Critically**: every existing parser test in `tests/parseTabs.*` / `tests/parseNav.*` / `tests/calicotab.parse*` must still pass — the VueCell type extension is non-breaking (optional field added), and the new adapter file is not yet consumed by any production code path.
- `npm run lint`: still 2 warnings, 0 errors.
- `npm run typecheck`: clean.

- [ ] **Step 7: Commit (commit 1 of 2 on this branch)**

```bash
git add lib/calicotab/parseTabs.ts lib/calicotab/cheerioToVue.ts tests/calicotab.cheerioToVue.test.ts
git commit -m "$(cat <<'EOF'
feat: add cheerio→VueTable adapter for parser collapse (sub-project 8)

New lib/calicotab/cheerioToVue.ts exports extractFromCheerio(html):
walks every <table>, converts each into the VueTable shape Tabbycat's
Vue data island uses. Encodes Tabbycat-specific HTML conventions —
card-title hoisting for table.title, data-original-title preference for
header keys, span[hidden]/.tooltip-trigger preference for cell.text,
raw inner HTML preserved in cell.html, <td> class preserved in cell.class.

VueCell extended by one optional field (html?: string). Native Vue
payloads from Tabbycat leave this undefined; the adapter always
populates it. parseNav's HTML-aware consumers (to be refactored in
the next commit) will read `cell.html ?? cell.text` so both sources
converge.

10 new adapter test cases. Existing 468 tests unchanged (the VueCell
extension is non-breaking; no production code path consumes the
adapter yet).

Part 1 of the sub-project-8 collapse. Part 2 refactors the 7 parsers
to use this adapter.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Refactor the 5 parsers in `parseTabs.ts`

**Files:**
- Modify: `lib/calicotab/parseTabs.ts` — replace cheerio blocks in 5 `parse*` functions; enhance `participantsFromVue` for section-inference from `table.title`.

No commit at the end of this task — defer to Task 4 single commit covering all 7 parser refactors.

- [ ] **Step 1: Add the `extractFromCheerio` import at the top of `parseTabs.ts`**

Current imports at `lib/calicotab/parseTabs.ts:1-2`:

```typescript
import * as cheerio from 'cheerio';
import { parseJsValue } from './parseJsValue';
```

Add a third import line:

```typescript
import * as cheerio from 'cheerio';
import { parseJsValue } from './parseJsValue';
import { extractFromCheerio } from './cheerioToVue';
```

- [ ] **Step 2: Refactor `parseTeamTab` (smallest, demonstrates the pattern)**

Find the function at `lib/calicotab/parseTabs.ts:398-442`. Current shape:

```typescript
export function parseTeamTab(html: string): TeamTabRow[] {
  const vue = extractVueData(html);
  if (vue) {
    const rows = teamTabFromVue(vue);
    if (rows) return rows;
  }

  // Cheerio fallback
  const $ = cheerio.load(html);
  const rows: TeamTabRow[] = [];
  const table =
    findTableByHeader($, (headers) => headers.some((h) => h.includes('team'))) ??
    $('table').first();
  const headers = table
    .find('thead th, tr').first()
    .find('th')
    .map((_i, th) => cleanText($(th).text()).toLowerCase())
    .get();
  const idx = (...needles: string[]) =>
    headers.findIndex((h) => needles.some((n) => h.includes(n)));
  const rankCol = idx('rank');
  const teamCol = idx('team');
  const instCol = idx('institution', 'school');
  const speakersCol = idx('speakers');
  const winsCol = idx('win', 'record');
  const pointsCol = idx('total', 'points');
  table.find('tbody tr').each((_i, tr) => {
    const cells = $(tr).find('td').map((_j, td) => cleanText($(td).text())).get();
    if (!cells.length) return;
    const teamName = teamCol >= 0 ? cells[teamCol] : cells[0];
    if (!teamName) return;
    const speakersText = speakersCol >= 0 ? cells[speakersCol] : '';
    rows.push({
      rank: rankCol >= 0 ? parseNumber(cells[rankCol]) : null,
      teamName,
      institution: instCol >= 0 ? cells[instCol] || null : null,
      speakers: speakersText
        ? speakersText.split(/[,;]|\sand\s/).map(cleanText).filter(Boolean)
        : [],
      wins: winsCol >= 0 ? parseNumber(cells[winsCol]) : null,
      totalPoints: pointsCol >= 0 ? parseNumber(cells[pointsCol]) : null,
    });
  });
  return rows;
}
```

Replace with:

```typescript
export function parseTeamTab(html: string): TeamTabRow[] {
  const vue = extractVueData(html);
  if (vue) {
    const rows = teamTabFromVue(vue);
    if (rows) return rows;
  }
  const cheerioTables = extractFromCheerio(html);
  if (cheerioTables.length === 0) return [];
  return teamTabFromVue(cheerioTables) ?? [];
}
```

The cheerio block is deleted; the `*FromVue` consumer now runs on either native Vue tables or cheerio-adapted tables.

- [ ] **Step 3: Refactor `parseSpeakerTab`**

Find the function at `lib/calicotab/parseTabs.ts:549-643`. The current body has the Vue-first check at the top (~L549-554) followed by ~90 LOC of cheerio fallback (`const $ = cheerio.load(html); ...` through the final closing `}` before the next `// ── parseRoundResults` divider comment).

Replace the entire function body with:

```typescript
export function parseSpeakerTab(html: string): SpeakerTabRow[] {
  const vue = extractVueData(html);
  if (vue) {
    const rows = speakerTabFromVue(vue);
    if (rows) return rows;
  }
  const cheerioTables = extractFromCheerio(html);
  if (cheerioTables.length === 0) return [];
  return speakerTabFromVue(cheerioTables) ?? [];
}
```

- [ ] **Step 4: Refactor `parseRoundResults` (preserving the pre-extract logic)**

This one's a touch more involved because it has pre-extract logic (navLabel/headingLabel/roundLabel/isOutround resolution) that must be preserved BEFORE the Vue/cheerio branching.

Find `parseRoundResults` at `lib/calicotab/parseTabs.ts:751`. The function signature and pre-extract block (roughly L751-786) stay; only the Vue branch + cheerio fallback section changes. Read the current code:

```typescript
export function parseRoundResults(
  html: string,
  // ... existing args ...
): RoundDebate {
  // ... existing pre-extract: roundLabelFallback, isOutroundFromUrl,
  // headingLabel, headingLooksRoundRelated, roundLabel, isOutround ...
  // (lines ~751-786, KEEP this entirely)

  const vue = extractVueData(html);
  if (vue) {
    const result = roundResultsFromVue(vue, roundNumber, roundLabel, isOutround);
    if (result) return result;
  }

  // Cheerio fallback — reuse the hoisted roundLabel + isOutround so both
  // paths agree on classification.
  // ... ~140 LOC cheerio block extracting teamResults + judgeAssignments ...
  // (lines ~794-896, DELETE this entirely and replace per below)
}
```

Replace the Vue branch + cheerio fallback section (everything from `const vue = extractVueData(html);` through the closing `}` of the function) with:

```typescript
  const vue = extractVueData(html);
  if (vue) {
    const result = roundResultsFromVue(vue, roundNumber, roundLabel, isOutround);
    if (result) return result;
  }
  const cheerioTables = extractFromCheerio(html);
  if (cheerioTables.length === 0) {
    return { roundLabel, isOutround, teamResults: [], judgeAssignments: [] };
  }
  return roundResultsFromVue(cheerioTables, roundNumber, roundLabel, isOutround) ?? {
    roundLabel,
    isOutround,
    teamResults: [],
    judgeAssignments: [],
  };
```

Note: `parseRoundResults` returns a `RoundDebate` object, not an array, so the empty-tables and `null`-from-consumer cases return a properly-shaped empty `RoundDebate`. Verify the existing function's signature/return type to confirm the empty-shape literal matches.

- [ ] **Step 5: Refactor `parseBreakPage`**

Find the function at `lib/calicotab/parseTabs.ts:940-983`. Current shape preserves the pre-extract for `isAdj` and `stage`:

```typescript
export function parseBreakPage(html: string, sourceUrl: string): BreakRow[] {
  const isAdj = /\/break\/adjudicators\//.test(sourceUrl);
  const stageMatch = sourceUrl.match(/\/break\/(teams\/[^/]+|adjudicators)/);
  const stage = normalizeBreakStage(stageMatch ? stageMatch[1] : null);

  const vue = extractVueData(html);
  if (vue) {
    const rows = breakPageFromVue(vue, isAdj, stage);
    if (rows) return rows;
  }

  // Cheerio fallback — ~30 LOC
  // ...
}
```

Keep the pre-extract block (lines 941-943). Replace the Vue branch + cheerio fallback (from `const vue = extractVueData(html);` through the end of the function) with:

```typescript
  const vue = extractVueData(html);
  if (vue) {
    const rows = breakPageFromVue(vue, isAdj, stage);
    if (rows) return rows;
  }
  const cheerioTables = extractFromCheerio(html);
  if (cheerioTables.length === 0) return [];
  return breakPageFromVue(cheerioTables, isAdj, stage) ?? [];
}
```

- [ ] **Step 6: Refactor `participantsFromVue` to read `table.title` for section inference (richer consumer)**

This is the parser whose cheerio path has the most algorithmic divergence from the Vue path — it uses `.card-title` heading detection for section role ("Adjudicators" vs "Speakers"), which the adapter now hoists into `table.title`. The Vue consumer needs to read it.

Find `participantsFromVue` at `lib/calicotab/parseTabs.ts:987-1035`. Current shape (lines 987-1009):

```typescript
function participantsFromVue(tables: VueTable[]): ParticipantsRow[] | null {
  const rows: ParticipantsRow[] = [];
  for (const table of tables) {
    if (!table?.head?.length || !table?.data?.length) continue;
    const heads = table.head;

    const nameCol = vueCol(heads, 'name');
    if (nameCol < 0) continue;

    const teamCol = vueCol(heads, 'team');
    const instCol = vueCol(heads, 'inst', 'school');
    const roleCol = vueCol(heads, 'role');

    // Infer role from table structure when there's no explicit role column
    const isSpeakerTable = teamCol >= 0;
    const isAdjTable =
      !isSpeakerTable &&
      heads.some((h) => {
        const k = (h.key ?? '').toLowerCase();
        const t = (h.title ?? '').toLowerCase();
        return k.includes('rating') || t.includes('rating');
      });
```

Replace lines 1000-1008 (the `// Infer role from table structure` block) with a richer inference that uses `table.title` first:

```typescript
    // Infer role from: explicit table.title (cheerio adapter hoists section
    // headings like "Adjudicators" / "Speakers" here) > role column > table
    // structure (presence of team column = speakers; rating header = adjs).
    const titleLower = (table.title ?? '').toLowerCase();
    const titleIsAdj = /^adjudicators?$/.test(titleLower);
    const titleIsSpeaker = /^speakers?$/.test(titleLower);
    const isSpeakerTable = titleIsSpeaker || (teamCol >= 0 && !titleIsAdj);
    const isAdjTable =
      titleIsAdj ||
      (!isSpeakerTable &&
        heads.some((h) => {
          const k = (h.key ?? '').toLowerCase();
          const t = (h.title ?? '').toLowerCase();
          return k.includes('rating') || t.includes('rating');
        }));
    const adjCoreCol = vueCol(heads, 'adjudication core', 'adj core');
    const independentCol = vueCol(heads, 'independent');
```

Then find the existing per-row loop where `judgeTag` is assigned (around lines 1015-1024). Current:

```typescript
      let role: ParticipantsRow['role'] = 'other';
      let judgeTag: ParticipantsRow['judgeTag'] = null;
      if (roleCol >= 0) {
        const classified = classifyParticipantRole(cellText(row[roleCol]));
        role = classified.role;
        judgeTag = classified.judgeTag;
      } else if (isSpeakerTable) {
        role = 'speaker';
      } else if (isAdjTable) {
        role = 'adjudicator';
        judgeTag = 'normal';
      }
```

Replace with (adds feather-check detection on adj-core/independent cells via the new `cell.html` field):

```typescript
      let role: ParticipantsRow['role'] = 'other';
      let judgeTag: ParticipantsRow['judgeTag'] = null;
      if (roleCol >= 0) {
        const classified = classifyParticipantRole(cellText(row[roleCol]));
        role = classified.role;
        judgeTag = classified.judgeTag;
      } else if (isSpeakerTable) {
        role = 'speaker';
      } else if (isAdjTable) {
        role = 'adjudicator';
        // For adjudicators without an explicit role-column tag, derive the
        // judgeTag from check-icon presence on Adj Core / Independent flag
        // columns. The cheerio adapter populates VueCell.html with raw inner
        // HTML (where the feather-check svg lives); native Vue payloads put
        // the flag in `text` or `class`, so check both.
        const cellHasCheck = (idx: number): boolean => {
          if (idx < 0) return false;
          const cell = row[idx];
          if (!cell) return false;
          const html = cell.html ?? '';
          const cls = cell.class ?? '';
          return /feather-check\b/i.test(html) || /\bfeather-check\b/i.test(cls);
        };
        const isIndependent = cellHasCheck(independentCol);
        // Adj-core flag's closest semantic in our judgeTag union is 'normal'
        // (matching the cheerio path's previous decision at parseTabs.ts:1146).
        judgeTag = isIndependent ? 'invited' : 'normal';
      }
```

- [ ] **Step 7: Refactor `parseParticipantsList` body**

Find at `lib/calicotab/parseTabs.ts:1037`. The function currently has the same shape as the others but with ~80 LOC of much more elaborate cheerio code. Replace the entire body (everything from the existing `const vue = extractVueData(html);` to the function's closing `}`) with:

```typescript
export function parseParticipantsList(html: string): ParticipantsRow[] {
  const vue = extractVueData(html);
  if (vue) {
    const rows = participantsFromVue(vue);
    if (rows) return rows;
  }
  const cheerioTables = extractFromCheerio(html);
  if (cheerioTables.length === 0) return [];
  return participantsFromVue(cheerioTables) ?? [];
}
```

- [ ] **Step 8: Run the parseTabs test suite to verify behavior preservation**

```bash
npx vitest run tests/parseTabs.breakPage.test.ts tests/parseTabs.rankColumns.test.ts tests/parseTabs.roundResults.test.ts tests/calicotab.parseParticipantsList.test.ts tests/calicotab.redactedSpeaker.test.ts
```

Expected: ALL pre-existing test cases pass. These tests cover both Vue fixtures and HTML fixtures — any regression here is a bridge bug.

If `tests/calicotab.parseParticipantsList.test.ts` fails on the MUKMEM_HTML fixture, the most likely cause is either: (a) the adapter's `span[hidden]` preference isn't firing (re-check Step 4 of Task 1), or (b) `participantsFromVue`'s title-based section inference isn't matching (titles come through with leading/trailing whitespace — confirm `cleanText` is applied in the adapter and the regex `/^adjudicators?$/` matches the cleaned title).

If `tests/parseTabs.roundResults.test.ts` fails, the most likely cause is `parseRoundResults` returning a mis-shaped empty `RoundDebate` — check Step 4 against the actual return type definition.

---

## Task 3: Refactor the 2 extractors in `parseNav.ts`

**Files:**
- Modify: `lib/calicotab/parseNav.ts` — refactor `findDebatesVueTable`, `extractAdjudicatorRoundsFromVue`, `extractAdjudicatorRounds`, `extractSpeakerRoundsFromVue`, `extractSpeakerRounds`.

No commit at the end of this task — defer to Task 4.

- [ ] **Step 1: Add `extractFromCheerio` import**

Current imports at `lib/calicotab/parseNav.ts:1-3`:

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

- [ ] **Step 2: Refactor `findDebatesVueTable` to take `tables: VueTable[]` instead of `html: string`**

Find at `lib/calicotab/parseNav.ts:426-436`. Current:

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

Replace with:

```typescript
function findDebatesVueTable(tables: VueTable[]): VueTable | null {
  return (
    tables.find((table) => cleanWhitespace(table.title ?? '').toLowerCase() === 'debates') ??
    tables.find((table) =>
      table.head?.some((h) => (h.key ?? h.title ?? '').toLowerCase().includes('adjudicator')),
    ) ??
    null
  );
}
```

The `extractVueData(html)` call is removed; the caller will pass tables in.

- [ ] **Step 3: Refactor `extractAdjudicatorRoundsFromVue` to take `tables` and read `cell.html ?? cell.text` (no detect-won site here, so just the signature change)**

Find at `lib/calicotab/parseNav.ts:501-543`. Current signature:

```typescript
function extractAdjudicatorRoundsFromVue(
  html: string,
  knownPersonName?: string | null,
): AdjudicatorRound[] | null {
  const table = findDebatesVueTable(html);
  if (!table?.data?.length) return null;
  // ... rest of body unchanged ...
```

Replace the signature line and the first body line:

```typescript
function extractAdjudicatorRoundsFromVue(
  tables: VueTable[],
  knownPersonName?: string | null,
): AdjudicatorRound[] | null {
  const table = findDebatesVueTable(tables);
  if (!table?.data?.length) return null;
  // ... rest of body unchanged ...
```

(Only those two lines change. The function body continues to use `table` as before.)

- [ ] **Step 4: Refactor `extractAdjudicatorRounds` body to use dual-shot extraction**

Find at `lib/calicotab/parseNav.ts:545`. Current shape:

```typescript
export function extractAdjudicatorRounds(
  html: string,
  knownPersonName?: string | null,
): AdjudicatorRound[] {
  const vueRows = extractAdjudicatorRoundsFromVue(html, knownPersonName);
  if (vueRows) return vueRows;

  const $ = cheerio.load(html);
  // ... ~80 LOC cheerio body ...
}
```

Replace the entire function body with:

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

- [ ] **Step 5: Refactor `extractSpeakerRoundsFromVue` (signature + the `cell.html ?? cell.text` read tweak at the detect-won site)**

Find at `lib/calicotab/parseNav.ts:757-816`. Current signature:

```typescript
function extractSpeakerRoundsFromVue(
  html: string,
  knownTeamName?: string | null,
): SpeakerRound[] | null {
  const tables = extractVueData(html);
  if (!tables) return null;
  const table = findDebatesVueTable(html);
  // ... body continues ...
```

Replace the signature + first three body lines:

```typescript
function extractSpeakerRoundsFromVue(
  tables: VueTable[],
  knownTeamName?: string | null,
): SpeakerRound[] | null {
  const table = findDebatesVueTable(tables);
  // ... body continues ...
```

(The `if (!tables)` check is no longer needed — the caller guarantees a non-empty array.)

Now find the detect-won site inside the same function. Current code around `lib/calicotab/parseNav.ts:783-806`:

```typescript
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
```

Replace the `const raw = vueCellText(cell);` line with:

```typescript
        // Read raw HTML for the cell. Vue payloads from Tabbycat embed HTML
        // in `text` (so vueCellText returns it); cheerio-adapted cells have
        // raw HTML in `html`. Either source flows through detectWonFromCellHtml.
        const raw = cell?.html ?? vueCellText(cell);
```

All downstream uses of `raw` (the `<strong>` regex, the `cleanWhitespace(cheerio.load(...))` text extraction, the `detectWonFromCellHtml(\`${ownedCellRaw} ${ownedCellClass ?? ''}\`)` call) continue to work unchanged: for Vue payloads `cell.html` is undefined so we fall through to `vueCellText(cell)` (no behavior change); for cheerio-adapted cells `cell.html` is populated with raw HTML that has the same shape (`<strong>` tags, icon classes, etc.) that detectWonFromCellHtml inspects.

- [ ] **Step 6: Refactor `extractSpeakerRounds` body to use dual-shot extraction**

Find at `lib/calicotab/parseNav.ts:818-880`. Current shape:

```typescript
export function extractSpeakerRounds(
  html: string,
  knownTeamName?: string | null,
): SpeakerRound[] {
  const vueRows = extractSpeakerRoundsFromVue(html, knownTeamName);
  if (vueRows) return vueRows;

  const $ = cheerio.load(html);
  // ... ~60 LOC cheerio body ...
}
```

Replace the entire function body with:

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

- [ ] **Step 7: Run the parseNav test suite**

```bash
npx vitest run tests/calicotab.parseNav.test.ts tests/calicotab.parseNav.adjudicator.test.ts tests/calicotab.parseNav.won.test.ts tests/parseNav.realMarkup.test.ts tests/calicotab.redactedSpeaker.test.ts
```

Expected: every existing case passes. If `tests/calicotab.parseNav.won.test.ts` fails, the most likely cause is the `cell.html ?? vueCellText(cell)` swap in Step 5 — confirm `vueCellText` is still imported/in-scope and that `cell?.html` returns `undefined` (not empty string) for native Vue cells, so the `??` fallthrough fires.

---

## Task 4: Final verification + commit 2

- [ ] **Step 1: Run the full test suite + lint + typecheck**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: **478 passing**, 4 skipped (baseline 468 + 10 new adapter cases from Task 1). All existing parser tests pass unchanged.
- `npm run lint`: 0 errors, 2 warnings (baseline).
- `npm run typecheck`: clean.

If anything regresses, do NOT commit. Back out the offending change and re-investigate.

- [ ] **Step 2: Sanity grep — confirm cheerio fallback blocks are deleted**

```bash
grep -nE "Cheerio fallback|Cheerio fallback —" lib/calicotab/parseTabs.ts lib/calicotab/parseNav.ts
grep -nE "cheerio\.load\(html\)" lib/calicotab/parseTabs.ts lib/calicotab/parseNav.ts
grep -nE "extractFromCheerio" lib/calicotab/parseTabs.ts lib/calicotab/parseNav.ts
```

Expected:
- First grep: **zero matches** in either file. The `// Cheerio fallback` comments marked the start of each block; all 7 should be deleted.
- Second grep: zero matches in `parseTabs.ts`. In `parseNav.ts` there will still be matches for the OUT-OF-SCOPE pure-cheerio functions (`extractNavigation`, `extractRegistration`, `parsePrivateUrlPage`, `extractOwnerRoleFromAdjHtml`, the team-cell `cheerio.load(\`<div>${raw}</div>\`)` micro-parses in `extractSpeakerRoundsFromVue`). Spot-check the matches: every remaining `cheerio.load(html)` in `parseNav.ts` should be inside one of the explicitly out-of-scope functions above OR inside a `*FromVue` micro-parse (where `raw` is a cell value, not the whole page).
- Third grep: `extractFromCheerio` should appear 5 times in `parseTabs.ts` (one per refactored `parse*`) and 2 times in `parseNav.ts` (one per refactored `extract*Rounds`). 7 total.

- [ ] **Step 3: Check the diff stat against the spec's predictions**

```bash
git diff --stat HEAD~1
```

Expected (approximate):
- `lib/calicotab/parseTabs.ts`: ~350 lines deleted (5 cheerio blocks + the parseRoundResults block is largest), ~50 lines added (5 dual-shot bodies + the participantsFromVue enhancements). Net ~−300 LOC.
- `lib/calicotab/parseNav.ts`: ~140 lines deleted (2 cheerio blocks), ~25 lines added (2 dual-shot bodies + the signature and read-site tweaks). Net ~−115 LOC.

If the net deletion is dramatically smaller than expected, double-check that the cheerio blocks were actually deleted (Steps 2.2 through 2.7 and 3.4/3.6) — it's easy to leave dead code behind during a delete-and-replace.

- [ ] **Step 4: Commit (commit 2 of 2)**

```bash
git add lib/calicotab/parseTabs.ts lib/calicotab/parseNav.ts
git commit -m "$(cat <<'EOF'
refactor: collapse parser Vue/cheerio dual paths via cheerioToVue adapter

Sub-project 8 part 2. With the cheerioToVue adapter from the previous
commit, each parser becomes a 5-line dual-shot extractor:
  - try extractVueData → run *FromVue
  - else extractFromCheerio → run *FromVue again
The cheerio fallback bodies that re-implemented column-header detection,
cell text cleaning, number parsing, BP position columns, role
classification, and feather-check icon detection are all deleted.

parseTabs.ts (~−300 LOC net):
  - parseTeamTab, parseSpeakerTab, parseRoundResults, parseBreakPage,
    parseParticipantsList — all 5 use the dual-shot pattern.
  - participantsFromVue (the Vue consumer) gains two enhancements so
    cheerio-adapted tables flow through it equivalently to the deleted
    cheerio block:
      a) reads table.title (hoisted from `.card-title` headings by the
         adapter) for section role inference — "Adjudicators" / "Speakers"
         identify which table is which on the participants page.
      b) reads cell.html / cell.class for `.feather-check` icon detection
         on Adj Core / Independent flag columns to derive judgeTag.

parseNav.ts (~−115 LOC net):
  - findDebatesVueTable's signature changes from (html) to
    (tables: VueTable[]) so it works on either source.
  - extractAdjudicatorRoundsFromVue, extractSpeakerRoundsFromVue gain
    the same signature change.
  - extractSpeakerRoundsFromVue's detectWonFromCellHtml site reads
    `cell.html ?? vueCellText(cell)` so Vue (HTML embedded in .text)
    and cheerio-adapted (HTML in .html) both flow through the same
    win-detection regex.
  - extractAdjudicatorRounds, extractSpeakerRounds become 5-line
    dual-shot extractors.

No PARSER_VERSION bump — refactor is behavior-preserving across all
existing test fixtures (468 prior + 10 new adapter cases = 478 pass).
Spec: docs/superpowers/specs/2026-05-23-parser-vue-cheerio-collapse-design.md

Pure-cheerio paths untouched: extractNavigation, extractRegistration,
parsePrivateUrlPage opener block, extractOwnerRoleFromAdjHtml, plus
the team-cell micro-parses inside *FromVue functions. Those don't
parse Vue-eligible tabular data and aren't in scope.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Post-flight: verification, finishing

- [ ] **Step 1: Confirm final state**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
npm test 2>&1 | tail -5
npm run lint 2>&1 | tail -3
npm run typecheck 2>&1 | tail -3
```

Expected:
- Two commits on the branch (adapter foundation + parser collapse).
- 4 files in the diff: `lib/calicotab/cheerioToVue.ts` (new, ~150 LOC), `lib/calicotab/parseTabs.ts` (net ~−300 LOC), `lib/calicotab/parseNav.ts` (net ~−115 LOC), `tests/calicotab.cheerioToVue.test.ts` (new, ~150 LOC).
- 478 tests passing, 4 skipped.
- Lint: 2 warnings, 0 errors.
- Typecheck: clean.

- [ ] **Step 2: Manual live smoke test (optional but recommended)**

If the env-gated live Tabbycat smoke is set up (`tests/__smoke.live.test.ts`):

```bash
LIVE_SMOKE_TABBYCAT_URL=<url> npx vitest run tests/__smoke.live.test.ts
```

This fetches a real tournament URL and runs the full parser pipeline end-to-end. If it surfaces any shape-mismatch between the bridge output and what `ingest.ts` consumes downstream, that's a critical regression to investigate before merge.

If no smoke URL is configured, skip — the unit tests are the load-bearing safety net.

- [ ] **Step 3: Stop and ask the user about push / PR / merge**

Push and PR are user-visible / shared-state actions per the harness rules. Do not run `git push` or `gh pr create` without explicit user confirmation. Present the standard `superpowers:finishing-a-development-branch` options:

1. Merge to `main` locally (the pattern used for the prior 7 sub-projects).
2. Push the branch + open a PR.
3. Keep the branch as-is for further review.
4. Discard.

---

## Self-review

**1. Spec coverage.** Walking through each section of `docs/superpowers/specs/2026-05-23-parser-vue-cheerio-collapse-design.md`:

- ✅ "In scope" item 1 (new `lib/calicotab/cheerioToVue.ts` with `extractFromCheerio`): Task 1, Step 4. **Plan deviation:** the spec estimated ~100 LOC for the adapter; the plan's adapter is ~150 LOC because of Tabbycat-specific HTML conventions (card-title hoisting, span[hidden] preference, data-original-title preference) the spec mentioned in design but underestimated in LOC. The added complexity is required for `parseParticipantsList` to preserve behavior.
- ✅ "In scope" item 2 (extend `VueCell` with `html?: string`): Task 1, Step 1.
- ✅ "In scope" item 3 (refactor 5 parseTabs `parse*` functions to dual-shot pattern): Task 2, Steps 2–7.
- ✅ "In scope" item 4 (refactor 2 parseNav extractors + `findDebatesVueTable` signature + `cell.html ?? cell.text` tweak): Task 3, Steps 2–6.
- ✅ "In scope" item 5 (pure-cheerio paths stay untouched): Task 4, Step 2's grep enforces this.
- ✅ "In scope" item 6 (new `tests/calicotab.cheerioToVue.test.ts` + existing tests unchanged): Task 1 Steps 2–6; Task 2 Step 8 and Task 3 Step 7 verify the existing suite stays green.
- ⚠️ **Spec deviation called out:** `participantsFromVue` gains two enhancements (table.title section inference, feather-check detection via cell.html/cell.class). The spec said "the *FromVue consumer functions in parseTabs.ts stay unchanged"; this consumer is the exception because the cheerio path's algorithm diverges from the Vue path's enough that the bridge requires consumer-side adaptation. Called out in Task 2 Step 6 and in commit 2's message.
- ✅ "Explicitly out of scope" items: no PARSER_VERSION bump, no schema, no new dep, no retroactive TDD, all honored.
- ✅ "Verification" steps: post-flight Step 1 covers `npm test` / `lint` / `typecheck`; Step 2 covers the optional smoke; Step 3 prompts the merge gate.
- ✅ "Risk" items mitigated: Task 4 Step 2's grep catches missing-deletion; Task 1 Step 6 catches VueCell-extension type errors; Task 2 Step 8 + Task 3 Step 7 catch behavior regressions per parser.

**2. Placeholder scan.** Searched for TBD / TODO / "fill in" / "add appropriate" / "similar to". No matches. Every code step shows full code.

**3. Type consistency.** Cross-checked symbols across tasks:
- `extractFromCheerio` — defined in Task 1 Step 4, imported in Task 2 Step 1 and Task 3 Step 1, called by 7 production sites + 10 adapter tests. Same signature throughout: `(html: string) => VueTable[]`.
- `VueCell.html` field — declared in Task 1 Step 1, populated by Task 1 Step 4's adapter, consumed in Task 2 Step 6 (`cellHasCheck`) and Task 3 Step 5 (`cell?.html ?? vueCellText(cell)`). Same nullable string semantics throughout.
- `findDebatesVueTable(tables: VueTable[])` — signature change in Task 3 Step 2, callers updated in Task 3 Steps 3 and 5.
- `*FromVue` consumer signatures — `teamTabFromVue(tables: VueTable[])`, `speakerTabFromVue(tables)`, `roundResultsFromVue(tables, roundNumber, roundLabel, isOutround)`, `breakPageFromVue(tables, isAdj, stage)`, `participantsFromVue(tables)`, `extractAdjudicatorRoundsFromVue(tables, knownPersonName)`, `extractSpeakerRoundsFromVue(tables, knownTeamName)` — all consistently typed against `VueTable[]` as the first param.
- Dual-shot fallback pattern — identical 5-line shape used in all 7 callers (Task 2 Steps 2/3/4/5/7 and Task 3 Steps 4/6). No drift.

No issues found during self-review.
