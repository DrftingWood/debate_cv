# Dedupe Brace-Counter Scanners in `parseTabs.ts` — Design Spec

**Date:** 2026-05-22
**Status:** Approved, ready for plan-writing
**Type:** Pure refactor (no behavior change, no schema change, no PARSER_VERSION bump)
**Subsystem:** `lib/calicotab/parseTabs.ts`

## Goal

Extract the three byte-equivalent balanced-brace + string-escape scanners in `lib/calicotab/parseTabs.ts` into a single non-exported helper `findBalancedJsRegion(text: string): number`. Replace all three call sites. Remove the `TODO(dedupe-brace-counters)` annotation landed in the previous sub-project. No behavior change.

## Motivation

The diagnosis-driven refactor sequence's previous sub-project (replace-new-function-eval) flagged this duplication and parked it via a `// TODO(dedupe-brace-counters)` comment near `extractJsonAt`. Three near-identical scanners — same algorithm (depth + inString + escaped flags), same iteration shape, same `{`/`[`/`}`/`]` handling, same `"` and `\` handling — exist at:

1. `lib/calicotab/parseTabs.ts:67-84` — inline in `extractJsonAt`
2. `lib/calicotab/parseTabs.ts:102-119` — inline in `extractTablesDataDirectly`
3. `lib/calicotab/parseTabs.ts:149-158` — inline in `diagnoseVueData` (with minor variable renames `inStr`/`esc` vs `inString`/`escaped`)

Three places to keep in sync if the scanner needs to change. One source of truth removes that risk.

## In scope

1. **Add `findBalancedJsRegion(text: string): number`** as a non-exported helper near the top of `lib/calicotab/parseTabs.ts` (alongside other internal utilities).
2. **Replace the three inline scanners** with calls to the new helper. The helper returns the same `endIdx` semantic each caller currently uses — position immediately after the balanced region, or -1 when no balanced region is found.
3. **Remove the `// TODO(dedupe-brace-counters)` comment block** (3 lines) above `extractJsonAt`.
4. **Add `tests/calicotab.findBalancedJsRegion.test.ts`** — small unit-test file pinning the helper's contract independently of integration coverage.

## Explicitly out of scope

- **Single-quoted string support.** The current scanners only treat `"..."` as opaque; a Tabbycat payload containing a single-quoted string with an unmatched brace inside would still trip the depth count. This is a pre-existing latent issue, NOT introduced here. Downstream, the `parseJsValue` trailing-content guard (added in sub-project 2) converts the failure mode from "silently wrong output" into "returns null", so production exposure is bounded. The helper's JSDoc explicitly notes the limitation but does NOT fix it.
- **Any other `parseTabs.ts` cleanup** — selector matching, header-needle behavior, etc. Stay focused.
- **No `PARSER_VERSION` bump** — parsing OUTPUT shape unchanged.

## File layout

| File | Change |
|---|---|
| `lib/calicotab/parseTabs.ts` | **+** `findBalancedJsRegion` helper (~20 LOC with JSDoc). **+** `__test__` re-export (~4 LOC). **+** Three one-line call-site replacements (~6 LOC). **−** Inline scanner in `extractJsonAt` (~13 LOC). **−** Inline scanner in `extractTablesDataDirectly` (~13 LOC). **−** Inline scanner in `diagnoseVueData` (~10 LOC). **−** `// TODO(dedupe-brace-counters)` 3-line comment. Net: roughly −9 LOC in parseTabs.ts. |
| `tests/calicotab.findBalancedJsRegion.test.ts` | **+ NEW.** ~8 unit tests, ~40 LOC. |

Total branch delta: roughly +30 LOC overall (mostly the new test file). The point of the refactor is shape, not line count — moving from three copies to one source of truth.

## Helper API

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

The body is the inline scanner verbatim, lifted into a function. No behavior change.

### Call-site replacements

Each existing inline-scanner block becomes one line:

```typescript
// extractJsonAt — was lines 67-86:
const rest = html.slice(idx + marker.length);
const endIdx = findBalancedJsRegion(rest);
if (endIdx < 0) return null;
return parseSlice(rest.slice(0, endIdx));
```

```typescript
// extractTablesDataDirectly — was lines 102-121:
const rest = html.slice(arrayStart);
const endIdx = findBalancedJsRegion(rest);
if (endIdx < 0) return null;
return parseSlice(rest.slice(0, endIdx));
```

```typescript
// diagnoseVueData — was lines 148-158, kept inside the existing `if (hasMarker)` block:
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
```

The diagnoseVueData call site uses the same helper and preserves the existing "endIdx not found" diagnostic.

## Test strategy

`tests/calicotab.findBalancedJsRegion.test.ts` — ~8 unit cases pinning the helper's contract:

| Case | Input | Expected `endIdx` |
|---|---|---|
| Empty object literal | `'{}'` | 2 |
| Empty array literal | `'[]'` | 2 |
| Object with content | `'{a:1}'` | 5 |
| Nested object/array | `'{a:[1,2]}'` | 9 |
| Double-quoted string containing `}` is opaque | `'{a:"x}y"}'` | 9 |
| Escaped quote inside string | `'{a:"x\\"y"}'` | 10 |
| Unbalanced (missing close) | `'{a:1'` | -1 |
| Empty input | `''` | -1 |
| Whitespace only | `'   '` | -1 |

Existing integration tests in `tests/parseTabs.*.test.ts` and `tests/parseNav.*.test.ts` (which exercise `extractJsonAt`, `extractTablesDataDirectly`, and `diagnoseVueData` through `extractVueData`) are the integration regression check — if they all stay green after the call-site replacements, behavior is empirically preserved.

The helper is internal (non-exported), so the unit-test file imports the test export. Two options:

1. Export the helper for tests via a `__test__` symbol (matches the existing `lib/calicotab/fetch.ts` convention at the bottom of that file — `export const __test__ = { ... }`).
2. Promote the helper to a named export (deviates slightly from "non-exported helper" but is more idiomatic).

The plan should use option 1 (`__test__` symbol) to match the existing codebase convention from `fetch.ts`.

## Commit sequence

**Single commit:** `refactor: dedupe brace-counter scanners in parseTabs into shared helper`. Adds the helper + its `__test__` re-export + the new test file + replaces all three call sites + removes the TODO comment. Atomic; one logical operation.

Commit message body should note the previous sub-project's TODO is now resolved and confirm the single-quote limitation is preserved (and now documented in the helper's JSDoc).

## Verification

- `npm test` — 454 + ~8 = 462 tests pass.
- `npm run lint` — 2 warnings, 0 errors (unchanged from current main).
- `npm run typecheck` — clean.
- Integration: existing `parseTabs.*`, `parseNav.*`, and `parseJsValue.*` test suites all continue to pass — that's the empirical proof of behavior preservation.

## Risk

**Very low.** The helper body is the inline scanner verbatim, lifted into a function. The three call sites' wrapping logic (slice setup, post-call handling) is preserved character-for-character. The unit tests pin the helper's contract; the existing integration suite proves end-to-end behavior is unchanged.

## Rollback

Single-commit; `git revert <sha>` cleanly restores the inline scanners. No schema changes, no dependency changes, no migrations.

## Cross-references

- Previous sub-projects: `docs/superpowers/specs/2026-05-22-canonical-mappings-design.md`, `docs/superpowers/specs/2026-05-22-replace-new-function-eval-design.md`.
- This dedup is the explicit follow-up the previous sub-project deferred via its `// TODO(dedupe-brace-counters)` annotation.
- CLAUDE.md rules honored: no `PARSER_VERSION` bump, no schema change, no new dependencies, no introduction of new state-management / ORM / test framework, no queue lock-order changes.
