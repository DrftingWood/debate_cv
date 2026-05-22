# Replace `new Function` Server-Side Eval — Design Spec

**Date:** 2026-05-22
**Status:** Approved, ready for plan-writing
**Type:** Security fix (refactor — no schema, no PARSER_VERSION bump)
**Subsystem:** `lib/calicotab/parseTabs.ts`

## Goal

Replace the `new Function('return ' + slice)()` server-side eval in `lib/calicotab/parseTabs.ts:33` with a safe AST-walking materializer built on `acorn`. Preserve the same observable contract — accept the same set of real-world Tabbycat slices that historically required the eval fallback, while categorically rejecting any input that would have executed code.

## Motivation

`evalJsLiteral` in `parseTabs.ts:29-34` evaluates a string extracted from third-party Tabbycat HTML inside a `new Function` body, with the eslint `no-implied-eval` rule explicitly silenced. The function is reached as a fallback when `JSON.parse` rejects the slice (commit `d3c96de`, 2026-04-25: "Tabbycat embeds window.vueData as a JavaScript object literal with unquoted keys, not strict JSON").

The historical justification is real — Tabbycat does emit a JS object literal with unquoted keys, sparse arrays, and occasional `undefined`/`Infinity` in popover/sort fields (cited in `d3c96de` + `da74b83`). But the fix shape — `new Function` — runs whatever the source emits inside the Node.js server. Tabbycat installs are arbitrary third parties sitting behind Cloudflare proxies; the input is not under our control. Replacing the eval with an AST materializer keeps the parse permissive enough for real Tabbycat data while making execution structurally impossible.

## In scope

1. **Add `lib/calicotab/parseJsValue.ts`** — new helper exporting `parseJsValue(slice: string): unknown`. Uses `acorn.parseExpressionAt(slice, 0, { ecmaVersion: 'latest' })` to parse the slice as a JS expression AST, then walks via a `materialize(node)` function. Throws on parse failure, non-literal nodes, or unknown identifiers.
2. **Swap `parseSlice` fallback** at `lib/calicotab/parseTabs.ts:48-53` from `evalJsLiteral(slice)` to `parseJsValue(slice)`. Same try/catch + null-on-failure contract; only the function call and the `console.warn` tag change.
3. **Delete `evalJsLiteral`** (`parseTabs.ts:29-34`) and its `// eslint-disable-next-line @typescript-eslint/no-implied-eval` directive in the same commit as the swap. Removing the directive resolves the pre-existing lint warning at `parseTabs.ts:32` as a side effect.
4. **Move `acorn` from transitive to direct dependency** in `package.json`. Currently in `node_modules` via Next.js / Babel; declaring it directly prevents an upstream update from silently breaking us.
5. **Add `tests/calicotab.parseJsValue.test.ts`** — pins the materializer contract end-to-end (accepts, rejects, integration sanity).

## Explicitly out of scope

- **Dedupe of the three brace-counter scanners** in `parseTabs.ts` (`extractJsonAt`, `extractTablesDataDirectly`, `diagnoseVueData`'s inline scanner). Tracked via a `// TODO(dedupe-brace-counters)` comment near `extractJsonAt`. Mild scope creep on a security-focused change; lift into its own sub-project.
- **No changes to `extractVueData`** or the four marker probe strategies, or to `parseSlice`'s JSON.parse-first fast path.
- **No `PARSER_VERSION` bump.** Parsing OUTPUT shape unchanged; only implementation differs.
- **No emergency kill-switch / feature flag for `new Function` fallback.** Deleting outright; if the new path fails on real data we revert the commit. The codebase has no flag precedent of this shape and adding one would be exactly the "feature I might want" smell the original diagnosis called out.
- **No new Sentry capture points.** Existing `console.warn` is already surfaced through Vercel function logs / Sentry's `captureConsole` integration (if enabled).

## File layout

| File | Change |
|---|---|
| `lib/calicotab/parseJsValue.ts` | **+ NEW.** Exports `parseJsValue(slice: string): unknown`. ~40 LOC including JSDoc + the materializer switch. |
| `lib/calicotab/parseTabs.ts` | `parseSlice` swaps `evalJsLiteral(slice)` → `parseJsValue(slice)`. `evalJsLiteral` + its doc comment + eslint-disable directive deleted (lines 23-34, ~12 lines removed). Import of `parseJsValue` added near the top with the other imports. One `// TODO(dedupe-brace-counters)` comment added near `extractJsonAt`. |
| `tests/calicotab.parseJsValue.test.ts` | **+ NEW.** ~70 LOC of behaviour pins. |
| `package.json` | Add `"acorn": "^8.15.0"` to `dependencies` (pinned to currently-resolved version). |

## Canonical helper API

```typescript
// lib/calicotab/parseJsValue.ts
/**
 * Parse a JavaScript expression literal — object, array, primitive — into a
 * plain JS value WITHOUT execution. Used as a fallback after JSON.parse for
 * the Tabbycat `window.vueData` payload, which embeds a JS object literal
 * (unquoted keys, occasional `undefined`/`Infinity` per d3c96de + da74b83)
 * rather than strict JSON.
 *
 * Replaces the previous `new Function('return ' + slice)()` eval. The acorn
 * AST walker is strictly limited to literal-shaped expressions: anything
 * involving function calls, member access, computed keys, template literals,
 * binary expressions, or arbitrary identifiers throws. There is no execution
 * context, no scope, no globals.
 *
 * Throws on parse failure, on input that contains non-literal expressions,
 * or on input that doesn't parse as a single expression. Callers should
 * catch and treat the throw as "couldn't parse" (matches the previous
 * evalJsLiteral try/catch contract in parseSlice).
 */
export function parseJsValue(slice: string): unknown;
```

## AST node allowlist (materializer contract)

| AST node type | Becomes |
|---|---|
| `Literal` (number, string, boolean, null, regex) | the `.value` |
| `ObjectExpression` | `{}` from `Property` children; key is `.key.name` (Identifier) or `.key.value` (Literal); `computed: true` properties throw |
| `ArrayExpression` | `[]`; elided slots (`[1, , 2]`) materialize as `null`; each element recurses |
| `Identifier` | `undefined` only if name is `'undefined'`, `Infinity`, or `NaN`. Any other identifier throws. |
| `UnaryExpression` | only `-` and `+` operators on a numeric or Identifier argument (handles `-Infinity`, `-3.14`, `+5`). Other operators throw. |
| Anything else | throws |

Anything else explicitly includes `CallExpression`, `MemberExpression`, `TemplateLiteral`, `ArrowFunctionExpression`, `FunctionExpression`, `BinaryExpression`, `LogicalExpression`, `ConditionalExpression`, `SpreadElement`, `NewExpression`, `SequenceExpression`, `AssignmentExpression`, `TaggedTemplateExpression`, `ClassExpression`, `YieldExpression`, `AwaitExpression`, `ImportExpression`.

No constant-folding is performed even on benign-looking shapes like `1 + 2`. The allowlist is "pure data only" by construction.

## Commit sequence (two commits)

| # | Commit message | Scope |
|---|---|---|
| 1 | `feat: add parseJsValue safe AST materializer (no call sites yet)` | New `lib/calicotab/parseJsValue.ts` file + new `tests/calicotab.parseJsValue.test.ts` + `acorn` added to `package.json` `dependencies` + `package-lock.json` regeneration. No call site changes. |
| 2 | `refactor: replace new Function eval in parseSlice with parseJsValue; delete evalJsLiteral` | `parseSlice` swap + `evalJsLiteral` deletion + eslint-disable directive removal + one TODO comment. |

Every commit must leave `npm test`, `npm run lint`, and `npm run typecheck` green.

## Test strategy

`tests/calicotab.parseJsValue.test.ts` is the primary safety guarantee. The materializer is new code carrying load-bearing security responsibility; the tests prove that the allowlist is enforced.

### Accepts — pure data shapes parse to the expected JS value

- Empty literals: `'{}'` → `{}`; `'[]'` → `[]`
- JSON-style object with quoted keys: `'{ "a": 1 }'` → `{ a: 1 }`
- Unquoted keys (the documented Tabbycat case): `'{ a: 1, b: "two" }'` → `{ a: 1, b: 'two' }`
- Single-quoted strings: `"{ a: 'two' }"` → `{ a: 'two' }`
- Arrays: `'[1, 2, 3]'` → `[1, 2, 3]`
- Primitives: `'{ x: null, y: true, z: false }'` → `{ x: null, y: true, z: false }`
- Nested: `'{ rows: [{ a: 1 }, { a: 2 }] }'`
- Numbers: integer, float (`3.14`), negative (`-3.14`), explicit positive (`+5`), large
- Strings with embedded escapes, embedded single and double quotes, unicode
- `'undefined'` → `undefined`
- `'Infinity'` → `Infinity`
- `'-Infinity'` → `-Infinity`
- `'NaN'` → `NaN`
- Sparse arrays: `'[1, , 3]'` → `[1, null, 3]`
- Mixed quoted/unquoted keys: `'{ a: 1, "b-with-dash": 2 }'`
- Trailing commas: `'{ a: 1, }'` and `'[1, 2,]'` (acorn accepts natively)

### Rejects — anything outside the allowlist throws

- Function calls: `'foo()'`, `'JSON.parse("x")'`
- Member access: `'process.env'`, `'globalThis.x'`, `'{}.constructor'`
- Template literals: `` "`hello ${x}`" ``
- Arrow / function expressions: `'() => 1'`, `'function() { return 1 }'`
- Binary expressions: `'1 + 2'`, `'"a" + "b"'` (no constant folding — strict)
- Logical: `'true && 1'`
- Conditional: `'a ? b : c'` (also rejects because `a` is an unknown Identifier, but the test exercises the conditional path explicitly)
- Spread: `'{ ...x }'`, `'[...y]'`
- Computed keys: `'{ [x]: 1 }'`
- Identifiers other than the three allowlisted: `'{ a: process }'`
- Class / new: `'new Map()'`, `'class X {}'`
- Multiple-expression sequence: `'1, 2'` (SequenceExpression)

### Integration sanity — a real Tabbycat-shaped fixture

- Small fixture with the documented shape: `'{ tablesData: [{ head: [{ key: "a" }], data: [[{ text: "x" }]] }], otherField: undefined }'` parses to the expected nested structure with `undefined` in the right slot.

### Failure-mode contract

- `parseJsValue` throws on every reject case; the message is informative enough that the `console.warn` in `parseSlice` produces a useful diagnostic.
- `parseSlice` continues to return `null` on `parseJsValue` throw (caller contract preserved).

## Error handling

### Caller (`parseSlice`)

```typescript
// lib/calicotab/parseTabs.ts — current
try {
  parsed = evalJsLiteral(slice);
} catch (e) {
  console.warn('[parseTabs] evalJsLiteral failed:', String(e).slice(0, 120));
  return null;
}

// After:
try {
  parsed = parseJsValue(slice);
} catch (e) {
  console.warn('[parseTabs] parseJsValue failed:', String(e).slice(0, 120));
  return null;
}
```

### Observability

No new Sentry capture points. Failure surfaces via:
- Existing `console.warn` (visible in Vercel function logs).
- Sentry's default `captureConsole` integration if enabled in the deployment.
- `diagnoseVueData` continues to produce its detailed diagnostic on the 0-rows ingest path.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| acorn rejects a real Tabbycat slice the old eval accepted | (a) `JSON.parse` fast path catches the 95% case; (b) allowlist covers everything documented in `d3c96de` + `da74b83`; (c) failure mode identical (null + warn). Surface via Sentry/logs if it happens. |
| acorn version drift breaks the API surface we depend on | Pin via `"acorn": "^8.15.0"`. `parseExpressionAt` + node types are stable. |
| Materializer has a bug that returns wrong data | Test suite asserts exact materialized values for every accept case; every reject case asserts throw. Green tests = correct on covered cases. |
| Performance regression vs JIT-compiled eval | Single-shot per ingest; single-digit ms difference. Irrelevant in practice. Note in commit message. |
| Lint warnings change shape | The pre-existing "unused eslint-disable directive" warning at `parseTabs.ts:32` disappears as a side effect of the deletion. No new warnings introduced. |

## Rollback

Each of the two commits is independently revertable. If commit 2 (the swap) misbehaves on real production traffic, `git revert <sha>` restores `evalJsLiteral` and the old behaviour. Commit 1 alone is a pure addition — no behaviour change to revert.

## Verification

- `npm test` green after every commit.
- `npm run lint` green after every commit; pre-existing "unused eslint-disable" warning at `parseTabs.ts:32` is resolved as a side effect.
- `npm run typecheck` green after every commit.
- Manual: re-ingest a tournament in dev whose `window.vueData` historically required the eval path. If no specific tournament is known, broad manual verification is "no observed parse regression for tournaments in dev test set."

## Cross-references

- Diagnosis: in-conversation review (2026-05-22), no committed artifact.
- Previous sub-project: `docs/superpowers/specs/2026-05-22-canonical-mappings-design.md` (merged to main, 8 commits ahead of origin).
- Future sub-project (deferred): dedupe the three brace-counter scanners in `parseTabs.ts`; introduce structured Sentry capture for parse failures.
- CLAUDE.md rules honored: no `PARSER_VERSION` bump, no queue lock-order changes, no introduction of state-management / ORM / test framework. Adding `acorn` as a direct dep is moving a transitive dep to direct — not introducing a new package class.
