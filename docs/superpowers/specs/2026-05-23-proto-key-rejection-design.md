# Reject `__proto__` Keys in parseJsValue — Design Spec

**Date:** 2026-05-23
**Status:** Approved, ready for plan-writing
**Type:** Safety hardening (no behavior change for legitimate inputs; no schema change; no PARSER_VERSION bump)
**Subsystem:** `lib/calicotab/parseJsValue.ts`

## Goal

Tighten `parseJsValue`'s `ObjectExpression` case to reject `__proto__` as an object key. Eliminates a prototype-pollution vector on materialized objects, matching the helper's "pure data only" contract.

## Motivation

The materializer added in sub-project 2 currently accepts `__proto__` as an ordinary key. The original code-quality review noted this but concluded the assignment `obj['__proto__'] = X` would create a data property rather than set the prototype — that conclusion was wrong. Empirical verification:

```javascript
const obj = {};
obj['__proto__'] = { polluted: true };
Object.getPrototypeOf(obj);  // { polluted: true } — prototype mutated
obj.polluted;                 // true — pollution observable
```

`Object.prototype` has a `__proto__` accessor that fires on plain assignment (only `Object.defineProperty(obj, '__proto__', ...)` bypasses the setter and creates a data property — that was the path the original reviewer was thinking of).

Pollution is bounded to the specific materialized object (it doesn't escape to global `Object.prototype`), but it still corrupts the parsed object's shape — `for...in` iteration over the result would surface the polluted prototype's enumerable properties, and any property lookup that falls through to the prototype chain would return polluted values. Consumers in this codebase (`parseSlice` → `extractVueData` → field-by-field reads) don't currently expose the bug as a live exploit, but tightening the allowlist removes the latent risk.

`constructor` and `prototype` are **regular own properties** on plain object instances — they have no setter behavior and present no comparable threat. They remain accepted.

## In scope

1. **Add a `key === '__proto__'` check** inside the `ObjectExpression` case of `materialize()` (in `lib/calicotab/parseJsValue.ts`), placed after key resolution and before `obj[key] = materialize(...)`. The check throws an informative error.
2. **Update the JSDoc** above the public `parseJsValue` function. The existing rejection list currently reads `"anything involving function calls, member access, computed keys, template literals, binary expressions, or arbitrary identifiers throws"`. Add `__proto__` to it so callers see the full set without reading the implementation. The inline comment inside the `ObjectExpression` case (shown in "Code change" below) carries the detailed *why*; the JSDoc carries the one-line *what*.
3. **Add 3 test cases** to the existing "rejects" describe block in `tests/calicotab.parseJsValue.test.ts`: identifier-form `__proto__`, quoted-literal-form `"__proto__"`, and nested-recursion form.

## Explicitly out of scope

- **`constructor` and `prototype` keys** — not threats on plain object instances. Rejecting them would be theater and risks rejecting future legitimate Tabbycat field names. YAGNI.
- **`Object.create(null)` materialization** — alternative defense that creates the result object without `Object.prototype` inheritance. Cleaner in theory, but changes the return shape (no `hasOwnProperty`/etc. on the result) which could surprise consumers. Not worth the blast radius for this fix.
- **No `PARSER_VERSION` bump** — `parseJsValue`'s public contract is unchanged: it still returns `unknown`, still throws on unsupported input. The throw set widens by one input shape.
- **No call site changes** — `parseSlice`'s existing try/catch around `parseJsValue` continues to handle the throw the same way it handles every other rejected input.

## File layout

| File | Change |
|---|---|
| `lib/calicotab/parseJsValue.ts` | Add `__proto__` check in `ObjectExpression` case (~4 LOC including comment). Update JSDoc near the case (~2 LOC). |
| `tests/calicotab.parseJsValue.test.ts` | Add 3 `it` blocks in the "rejects" describe (~12 LOC). |

Net branch delta: ~+18 LOC, all in two files. Single commit.

## Code change

In `lib/calicotab/parseJsValue.ts`, inside the `ObjectExpression` case of `materialize()`, place this check **immediately after** the `key` resolution block (after the `else throw new Error('unsupported object key type: ...')` line) and **before** `obj[key] = materialize(prop.value as Expression)`:

```typescript
        // `__proto__` is the one key that triggers the prototype setter
        // inherited from Object.prototype when assigned to a plain object
        // literal. obj['__proto__'] = X mutates obj's prototype, which
        // would let a Tabbycat payload like `{ __proto__: { isAdmin: true } }`
        // pollute the materialized object. `constructor` and `prototype`
        // are regular own properties on plain objects and don't need
        // rejection here.
        if (key === '__proto__') {
          throw new Error('__proto__ keys are not supported');
        }
```

## Test additions

Add to the existing `describe('parseJsValue — rejects anything outside the literal allowlist', ...)` block in `tests/calicotab.parseJsValue.test.ts`:

```typescript
  it('rejects __proto__ keys (identifier form)', () => {
    expect(() => parseJsValue('{ __proto__: { polluted: true } }')).toThrow();
  });

  it('rejects __proto__ keys (quoted-string literal form)', () => {
    expect(() => parseJsValue('{ "__proto__": { polluted: true } }')).toThrow();
  });

  it('rejects __proto__ keys nested inside an object', () => {
    // The materializer recurses into nested objects, so this exercises
    // the rejection path through a recursive call.
    expect(() => parseJsValue('{ a: { __proto__: {} } }')).toThrow();
  });
```

Identifier-form vs quoted-literal-form both reach the same key-resolution branch and hit the same rejection. The nested case verifies the recursion-through-materialize path also catches it.

## Commit shape

**Single commit:** `fix: reject __proto__ keys in parseJsValue to prevent prototype pollution`. Combines the code change, the JSDoc update, and the three new test cases. Atomic.

## Verification

- `npm test`: 463 + 3 = 466 tests pass.
- `npm run lint`: 2 warnings, 0 errors (unchanged).
- `npm run typecheck`: clean.
- Existing tests in `tests/calicotab.parseJsValue.test.ts` (32 cases) all continue to pass — the new rejection narrows the accept set by exactly one input shape that the existing tests didn't exercise.

## Risk

**Negligible.** Adding one rejection to an already-strict allowlist. The new throw uses the same shape as the existing `SpreadElement`, `computed`, and unsupported-key-type rejections one block above. Real-world Tabbycat payloads do not use `__proto__` as a data key (it would be an unusual choice in any system); if one ever did, the parse would fail explicitly rather than silently corrupting the result.

## Rollback

Single-commit; `git revert <sha>` restores the previous behavior. No schema changes, no dependency changes.

## Cross-references

- Previous sub-projects: `docs/superpowers/specs/2026-05-22-canonical-mappings-design.md`, `docs/superpowers/specs/2026-05-22-replace-new-function-eval-design.md`, `docs/superpowers/specs/2026-05-22-dedupe-brace-counters-design.md`.
- Code-quality review of sub-project 2 raised this concern (`8715dfc`'s parent review thread) but concluded — incorrectly — that the assignment path created a data property. Empirical verification shows the inherited setter fires; this spec corrects the analysis and closes the loop.
- CLAUDE.md rules honored: no `PARSER_VERSION` bump, no new dependencies, no schema changes, no introduction of state-management / ORM / test framework, no queue lock-order changes.
