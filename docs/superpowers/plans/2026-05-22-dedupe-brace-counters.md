# Dedupe Brace-Counter Scanners in parseTabs.ts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the three byte-equivalent balanced-brace + string-escape scanners in `lib/calicotab/parseTabs.ts` into one shared `findBalancedJsRegion` helper, replace all three call sites, remove the `// TODO(dedupe-brace-counters)` annotation, and add unit tests pinning the helper's contract.

**Architecture:** Single-branch, single-commit refactor. Add the helper near the top of `parseTabs.ts` as a non-exported function (matching the file's existing pattern of internal utilities). Expose it through a `__test__` re-export object at the bottom of the file (mirrors `lib/calicotab/fetch.ts:312-319`'s convention). Three call sites each collapse from ~13 lines of inline scanner to one line. Existing parseTabs/parseNav/parseJsValue integration tests are the regression check.

**Tech Stack:** TypeScript 5.7 strict, Vitest 2 (Node env), npm canonical. Path alias `@/*` → repo root.

**Spec:** `docs/superpowers/specs/2026-05-22-dedupe-brace-counters-design.md`

---

## Pre-flight: branch setup & baseline

- [ ] **Step 1: Create the feature branch**

```bash
git checkout main
git status
git checkout -b refactor/dedupe-brace-counters
git status
```

Expected: clean working tree on `refactor/dedupe-brace-counters`, with `.claude/settings.local.json` showing as the only untracked file (harness-local, ignored).

- [ ] **Step 2: Confirm baseline is green**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: 454 tests pass, 44 files.
- `npm run lint`: 2 warnings, 0 errors. (Pre-existing warnings at `parseTabs.ts:1118` for `adjCoreCol` and `scripts/test-scrape.mjs:16` for `ROOT`.)
- `npm run typecheck`: exit 0, no output.

If anything fails on the freshly-branched main, stop and flag — this plan assumes a green baseline.

---

## Task 1: Add `findBalancedJsRegion` helper + tests + replace 3 call sites + remove TODO

**Files:**
- Modify: `lib/calicotab/parseTabs.ts` — add helper, replace 3 inline scanners, remove TODO comment, add `__test__` export
- Create: `tests/calicotab.findBalancedJsRegion.test.ts`

Single commit at the end. The bite-sized steps below all land in one atomic commit because the changes are interlocking: the helper exists to replace the inlines, the inlines exist to be replaced by the helper, the TODO exists to be removed when the dedup lands, and the test file exists to pin the helper's contract. Splitting them into separate commits would leave intermediate states with dead code or unused tests.

- [ ] **Step 1: Write the failing test file**

Create `tests/calicotab.findBalancedJsRegion.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { __test__ } from '@/lib/calicotab/parseTabs';

const { findBalancedJsRegion } = __test__;

describe('findBalancedJsRegion — locates the end of a balanced JS region', () => {
  it('empty object literal', () => {
    expect(findBalancedJsRegion('{}')).toBe(2);
  });

  it('empty array literal', () => {
    expect(findBalancedJsRegion('[]')).toBe(2);
  });

  it('object with content', () => {
    expect(findBalancedJsRegion('{a:1}')).toBe(5);
  });

  it('nested object containing an array', () => {
    expect(findBalancedJsRegion('{a:[1,2]}')).toBe(9);
  });

  it('double-quoted string containing a brace is opaque', () => {
    // The `}` inside "x}y" must NOT decrement depth. Final close is at position 8.
    expect(findBalancedJsRegion('{a:"x}y"}')).toBe(9);
  });

  it('escaped quote inside a string does not close the string early', () => {
    // The `\"` is a literal quote inside the string, so `"x\"y"` is one string.
    expect(findBalancedJsRegion('{a:"x\\"y"}')).toBe(10);
  });

  it('unbalanced input — missing close brace returns -1', () => {
    expect(findBalancedJsRegion('{a:1')).toBe(-1);
  });

  it('empty input returns -1', () => {
    expect(findBalancedJsRegion('')).toBe(-1);
  });

  it('whitespace-only input returns -1', () => {
    expect(findBalancedJsRegion('   ')).toBe(-1);
  });
});
```

- [ ] **Step 2: Run the test file to verify it fails**

```bash
npm test -- tests/calicotab.findBalancedJsRegion.test.ts
```

Expected: FAIL with something like `Failed to resolve import "@/lib/calicotab/parseTabs"` or `__test__ has no exported member 'findBalancedJsRegion'`. (The `__test__` export doesn't exist yet on `parseTabs.ts`.)

- [ ] **Step 3: Add `findBalancedJsRegion` helper to `parseTabs.ts`**

Open `lib/calicotab/parseTabs.ts`. Find the existing `// TODO(dedupe-brace-counters):` comment block at lines 55-57. Insert the new helper **above** that comment block (i.e., after the Vue type exports at line ~21 and before the `// TODO(dedupe-brace-counters):` line). Use this exact code, preserving the narrative-comment style of the file:

```typescript
/**
 * Find the position immediately after the first balanced `{...}` or `[...]`
 * region in `text`, treating double-quoted strings as opaque (so braces
 * inside string literals don't affect the depth count) and respecting
 * backslash escapes inside strings.
 *
 * Operates from index 0. Returns -1 when no balanced region is found
 * (input exhausted before depth returned to zero, or no opening brace
 * ever encountered).
 *
 * Used by extractJsonAt, extractTablesDataDirectly, and diagnoseVueData
 * to locate where an embedded JS object/array literal ends. NOTE: handles
 * only double-quoted strings — single-quoted string contents containing
 * unmatched braces would still trip the depth count, but the downstream
 * parseJsValue's trailing-content guard converts that failure mode into
 * "returns null" rather than "silently wrong output."
 */
function findBalancedJsRegion(text: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }

  return -1;
}
```

- [ ] **Step 4: Add the `__test__` re-export at the bottom of the file**

At the very bottom of `lib/calicotab/parseTabs.ts` (after the last existing function and any existing exports), add:

```typescript
// Re-export for tests that assert on the helper's contract.
export const __test__ = {
  findBalancedJsRegion,
};
```

Match the format of `lib/calicotab/fetch.ts:311-319` exactly.

- [ ] **Step 5: Run the test file to verify it passes**

```bash
npm test -- tests/calicotab.findBalancedJsRegion.test.ts
```

Expected: all 9 tests PASS. (The 8 cases from the spec plus the description-level `describe` block totals 9 `it` blocks.)

If any test fails, the helper's body diverged from the inline scanners' logic — re-check the function body against the existing inline scanner at the current `extractJsonAt` (lines ~68-83).

- [ ] **Step 6: Replace the inline scanner in `extractJsonAt`**

Find `extractJsonAt` in `lib/calicotab/parseTabs.ts` (currently around line 63 in the pre-modification file; after Steps 3-4 the line numbers shift down by ~22). Its current body looks like:

```typescript
function extractJsonAt(html: string, marker: string): VueTable[] | null {
  const idx = html.indexOf(marker);
  if (idx < 0) return null;

  const rest = html.slice(idx + marker.length);
  let depth = 0;
  let inString = false;
  let escaped = false;
  let endIdx = -1;

  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!;
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) { endIdx = i + 1; break; }
    }
  }

  if (endIdx < 0) return null;
  return parseSlice(rest.slice(0, endIdx));
}
```

Replace the entire body with:

```typescript
function extractJsonAt(html: string, marker: string): VueTable[] | null {
  const idx = html.indexOf(marker);
  if (idx < 0) return null;

  const rest = html.slice(idx + marker.length);
  const endIdx = findBalancedJsRegion(rest);
  if (endIdx < 0) return null;
  return parseSlice(rest.slice(0, endIdx));
}
```

The JSDoc above the function is unchanged.

- [ ] **Step 7: Replace the inline scanner in `extractTablesDataDirectly`**

Still in `lib/calicotab/parseTabs.ts`. Find `extractTablesDataDirectly`. Its current body looks like:

```typescript
function extractTablesDataDirectly(html: string): VueTable[] | null {
  const m = /"tablesData"\s*:\s*\[/.exec(html);
  if (!m) return null;
  const arrayStart = html.indexOf('[', m.index);
  if (arrayStart < 0) return null;

  const rest = html.slice(arrayStart);
  let depth = 0;
  let inString = false;
  let escaped = false;
  let endIdx = -1;

  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!;
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) { endIdx = i + 1; break; }
    }
  }

  if (endIdx < 0) return null;
  return parseSlice(rest.slice(0, endIdx));
}
```

Replace the body with:

```typescript
function extractTablesDataDirectly(html: string): VueTable[] | null {
  const m = /"tablesData"\s*:\s*\[/.exec(html);
  if (!m) return null;
  const arrayStart = html.indexOf('[', m.index);
  if (arrayStart < 0) return null;

  const rest = html.slice(arrayStart);
  const endIdx = findBalancedJsRegion(rest);
  if (endIdx < 0) return null;
  return parseSlice(rest.slice(0, endIdx));
}
```

The JSDoc above the function is unchanged.

- [ ] **Step 8: Replace the inline scanner in `diagnoseVueData`**

Still in `lib/calicotab/parseTabs.ts`. Find `diagnoseVueData`. The relevant chunk inside the `if (hasMarker)` block currently looks like:

```typescript
    if (hasMarker) {
      const rest = html.slice(markerIdx + 'window.vueData = '.length);
      let depth = 0, inStr = false, esc = false, endIdx = -1;
      for (let i = 0; i < rest.length; i++) {
        const ch = rest[i]!;
        if (esc) { esc = false; continue; }
        if (ch === '\\' && inStr) { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
      }
      if (endIdx >= 0) {
        try { JSON.parse(rest.slice(0, endIdx)); } catch (e) {
          const preview = rest.slice(0, endIdx).replace(/\s+/g, ' ').slice(0, 80);
          parseError = ` parseErr=${String(e).slice(0, 80)} near: ${preview}`;
        }
      } else {
        parseError = ' braceCounter: endIdx not found (unbalanced JSON)';
      }
    }
```

Replace with:

```typescript
    if (hasMarker) {
      const rest = html.slice(markerIdx + 'window.vueData = '.length);
      const endIdx = findBalancedJsRegion(rest);
      if (endIdx >= 0) {
        try { JSON.parse(rest.slice(0, endIdx)); } catch (e) {
          const preview = rest.slice(0, endIdx).replace(/\s+/g, ' ').slice(0, 80);
          parseError = ` parseErr=${String(e).slice(0, 80)} near: ${preview}`;
        }
      } else {
        parseError = ' braceCounter: endIdx not found (unbalanced JSON)';
      }
    }
```

The rest of `diagnoseVueData` (the part below the `if (hasMarker)` block — `scriptSnippets`, etc.) is unchanged.

- [ ] **Step 9: Remove the `// TODO(dedupe-brace-counters)` comment block**

Find and delete these three lines (currently at lines 55-57, but shifted after Steps 3-4):

```typescript
// TODO(dedupe-brace-counters): this balanced-brace scanner is duplicated
// in extractTablesDataDirectly and diagnoseVueData. Lift into a shared
// helper as part of a follow-up parseTabs cleanup sub-project.
```

After deletion, the JSDoc for `extractJsonAt` should sit directly under the `findBalancedJsRegion` helper (with one blank line of separation).

Verify via:

```bash
grep -n "TODO(dedupe-brace-counters)" lib/calicotab/parseTabs.ts
```

Expected: no matches.

- [ ] **Step 10: Sanity check via grep**

Confirm no orphan scanner state remains:

```bash
grep -nE "let depth = 0|inString = false|escaped = false" lib/calicotab/parseTabs.ts
```

Expected: exactly 3 matches, all on consecutive lines inside the new `findBalancedJsRegion` helper (one for each of `depth`, `inString`, `escaped`). If there are more, an inline scanner wasn't fully replaced.

- [ ] **Step 11: Run full test suite, lint, and typecheck**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: **462 tests pass**, 45 files (was 454/44). The integration suites `tests/parseTabs.*.test.ts`, `tests/parseNav.*.test.ts`, and `tests/calicotab.parseJsValue.test.ts` are the regression check — they all continue to pass because the helper's behavior is byte-equivalent to the deleted inline scanners.
- `npm run lint`: **2 warnings, 0 errors** (unchanged from baseline).
- `npm run typecheck`: clean.

If any of the integration tests fail, the helper's body diverged from one of the inline scanners — verify by diffing the helper against the original inline scanner text.

- [ ] **Step 12: Commit**

```bash
git add lib/calicotab/parseTabs.ts tests/calicotab.findBalancedJsRegion.test.ts
git commit -m "$(cat <<'EOF'
refactor: dedupe brace-counter scanners in parseTabs into shared helper

The three byte-equivalent balanced-brace + string-escape scanners in
parseTabs.ts (extractJsonAt, extractTablesDataDirectly, and the inline
one in diagnoseVueData) are consolidated into a single
findBalancedJsRegion helper. Same depth + inString + escaped logic, lifted
verbatim into one function with shared JSDoc.

Helper is non-exported but re-exposed via the __test__ symbol at the
bottom of the file (matches the convention from lib/calicotab/fetch.ts).
Adds tests/calicotab.findBalancedJsRegion.test.ts with 9 unit cases
pinning the contract (empty containers, nested, double-quoted opacity,
escape handling, unbalanced input, empty/whitespace).

Resolves the // TODO(dedupe-brace-counters) annotation landed in the
previous sub-project. The single-quote string limitation noted in the
diagnosis is explicitly documented in the helper's JSDoc but not fixed
here — parseJsValue's trailing-content guard already converts that
failure mode to return-null, so urgency is low.

No behavior change. No PARSER_VERSION bump.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
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
- One commit on the branch (Task 1).
- Two files in the diff: `lib/calicotab/parseTabs.ts` (~-9 LOC net) and `tests/calicotab.findBalancedJsRegion.test.ts` (+40 LOC new).
- Tests: 462 pass.
- Lint: 2 warnings, 0 errors.
- Typecheck: clean.

- [ ] **Step 2: Stop and ask the user about push / PR / merge**

Push and PR are user-visible / shared-state actions per the harness rules. Do not run `git push` or `gh pr create` without explicit user confirmation. Present the standard `superpowers:finishing-a-development-branch` options:

1. Merge to `main` locally.
2. Push + open a PR.
3. Keep the branch as-is.
4. Discard.

- [ ] **Step 3 (deferred manual verification)**

Optional but cheap: re-ingest a tournament in dev to confirm `extractVueData` still locates the embedded data correctly. The helper is byte-equivalent to the deleted inline scanners, so any difference would indicate either a transcription error or a latent issue uncovered by the lifting.

---

## Self-review

**1. Spec coverage.** Walking through each section of the spec:

- ✅ "In scope" item 1 (add `findBalancedJsRegion` near the top of `parseTabs.ts`): Step 3.
- ✅ "In scope" item 2 (replace 3 inline scanners): Steps 6, 7, 8.
- ✅ "In scope" item 3 (remove `// TODO(dedupe-brace-counters)` 3-line block): Step 9.
- ✅ "In scope" item 4 (add unit-test file): Step 1, verified at Step 5.
- ✅ "Explicitly out of scope" — single-quoted strings not handled; helper's JSDoc documents the limitation (Step 3 helper body).
- ✅ `__test__` re-export per the `fetch.ts` convention: Step 4.
- ✅ Spec's 9-row test plan table maps 1:1 to the 9 `it` blocks in Step 1's test file.
- ✅ Single commit: Step 12.
- ✅ No PARSER_VERSION bump (not touched anywhere).
- ✅ Verification at every gate (Step 11 full suite, Step 1 of post-flight).

No spec section is missing a task.

**2. Placeholder scan.** Searched the plan for TBD / TODO (as a placeholder, not the in-code annotation being removed) / "fill in" / "add appropriate" / "similar to". No matches.

**3. Type consistency.** Cross-checked names and signatures:

- `findBalancedJsRegion(text: string): number` — defined in Step 3, used identically in Steps 6, 7, 8 (`findBalancedJsRegion(rest)` at each call site), tested via `__test__.findBalancedJsRegion` in Step 1.
- `__test__` symbol — exported at Step 4 with `{ findBalancedJsRegion }`, imported and destructured at Step 1's test file (`const { findBalancedJsRegion } = __test__`).
- Return semantics — `number`, with `-1` sentinel for not found; consistent across helper, tests, and three call sites.

No drift.
