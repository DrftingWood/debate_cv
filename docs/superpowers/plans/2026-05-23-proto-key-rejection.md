# Reject `__proto__` Keys in parseJsValue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `__proto__`-key rejection to `parseJsValue`'s `ObjectExpression` case to prevent prototype pollution on the materialized object, plus three test cases pinning the contract.

**Architecture:** Single branch, single commit. Insert a 4-line check in `lib/calicotab/parseJsValue.ts` immediately after the existing key-resolution block. Update the public JSDoc rejection list. Extend the existing `tests/calicotab.parseJsValue.test.ts` "rejects" describe block with three new cases. The change is the smallest sub-project so far; total LOC delta ≈ +18.

**Tech Stack:** TypeScript 5.7 strict, Vitest 2 (Node env), acorn ^8.16.0, npm canonical. Path alias `@/*` → repo root.

**Spec:** `docs/superpowers/specs/2026-05-23-proto-key-rejection-design.md`

---

## Pre-flight: branch setup & baseline

- [ ] **Step 1: Create the feature branch**

```bash
git checkout main
git status
git checkout -b refactor/proto-key-rejection
git status
```

Expected: clean working tree on `refactor/proto-key-rejection`, only `.claude/settings.local.json` as the harness-local untracked file.

- [ ] **Step 2: Confirm baseline is green**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: **463 tests pass**, 45 files.
- `npm run lint`: **2 warnings, 0 errors** (the pre-existing `parseTabs.ts:1112` `adjCoreCol` warning and `scripts/test-scrape.mjs:16` `ROOT` warning).
- `npm run typecheck`: exit 0, no output.

If any fails on a freshly-branched main, stop and flag.

---

## Task 1: Reject `__proto__` keys in parseJsValue + tests

**Files:**
- Modify: `lib/calicotab/parseJsValue.ts` (insert rejection check at line ~86; update JSDoc at lines 12-13)
- Modify: `tests/calicotab.parseJsValue.test.ts` (add 3 `it` blocks in the existing "rejects" describe)

Single commit at the end.

- [ ] **Step 1: Write the three failing tests**

Open `tests/calicotab.parseJsValue.test.ts`. Find the existing `describe('parseJsValue — rejects anything outside the literal allowlist', () => {` block (search for `rejects anything outside the literal allowlist`). Add these three `it` blocks anywhere inside that describe block — placing them near the other rejection cases (e.g., near the BigInt and regex rejections) keeps the file's organization coherent:

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

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- tests/calicotab.parseJsValue.test.ts
```

Expected: 3 NEW FAILURES — the three `__proto__` cases assert `toThrow()` but `parseJsValue` currently accepts these inputs and returns objects without throwing. All other 32 existing cases still pass.

The output should include lines like:
```
FAIL  tests/calicotab.parseJsValue.test.ts > parseJsValue — rejects anything outside the literal allowlist > rejects __proto__ keys (identifier form)
Error: expected [Function] to throw an error
```

If only some of the three fail, the placement may be in a different `describe` block — make sure they're in the "rejects" block, not the "accepts" one.

- [ ] **Step 3: Add the rejection check to `parseJsValue.ts`**

Open `lib/calicotab/parseJsValue.ts`. Find the `ObjectExpression` case in the `materialize` function (it starts around line 65). The current end of the key-resolution block looks like this (lines 83-90):

```typescript
        } else {
          throw new Error(`unsupported object key type: ${prop.key.type}`);
        }
        // Property.value is typed as Pattern | Expression in ESTree to
        // accommodate destructuring patterns. For object literals it's
        // always an Expression at runtime; if acorn somehow hands us a
        // Pattern, materialize will hit its default branch and throw.
        obj[key] = materialize(prop.value as Expression);
```

Insert the new check BETWEEN the closing `}` of the key-resolution if/else (line 85) AND the `// Property.value is typed as...` comment (line 86). The result should read:

```typescript
        } else {
          throw new Error(`unsupported object key type: ${prop.key.type}`);
        }
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
        // Property.value is typed as Pattern | Expression in ESTree to
        // accommodate destructuring patterns. For object literals it's
        // always an Expression at runtime; if acorn somehow hands us a
        // Pattern, materialize will hit its default branch and throw.
        obj[key] = materialize(prop.value as Expression);
```

- [ ] **Step 4: Update the public `parseJsValue` JSDoc**

Still in `lib/calicotab/parseJsValue.ts`. Find the JSDoc above `parseJsValue` (lines 3-23). The existing rejection-list paragraph reads (lines 10-14):

```typescript
 * Replaces the previous `new Function('return ' + slice)()` eval. The acorn
 * AST walker is strictly limited to literal-shaped expressions: anything
 * involving function calls, member access, computed keys, template literals,
 * binary expressions, or arbitrary identifiers throws. There is no execution
 * context, no scope, no globals.
```

Replace those five lines with this version, which adds `__proto__` keys to the rejection list:

```typescript
 * Replaces the previous `new Function('return ' + slice)()` eval. The acorn
 * AST walker is strictly limited to literal-shaped expressions: anything
 * involving function calls, member access, computed keys, template literals,
 * binary expressions, arbitrary identifiers, or `__proto__` as an object
 * key throws. There is no execution context, no scope, no globals.
```

Only the rejection-list sentence changes; surrounding paragraphs are untouched.

- [ ] **Step 5: Run the test file to verify the three new tests now pass**

```bash
npm test -- tests/calicotab.parseJsValue.test.ts
```

Expected: all 35 (was 32 + 3 new) tests in this file PASS.

- [ ] **Step 6: Run full test suite, lint, and typecheck**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: **466 tests pass**, 45 files.
- `npm run lint`: **2 warnings, 0 errors** (unchanged from baseline; no new lint issues).
- `npm run typecheck`: clean.

If lint flags anything new (e.g., an unused variable or a misplaced comment), inspect the diff — most likely the rejection-check insertion has an indentation or whitespace issue.

- [ ] **Step 7: Sanity check — confirm the rejection check is positioned correctly**

```bash
grep -nB1 -A2 "__proto__ keys are not supported" lib/calicotab/parseJsValue.ts
```

Expected: shows the `if (key === '__proto__')` line followed by the `throw new Error('__proto__ keys are not supported');` line. The line numbers should place this check AFTER the `} else { throw new Error('unsupported object key type:...')` block and BEFORE the `obj[key] = materialize(...)` line. If the grep shows the check in a different position, re-do Step 3 carefully.

- [ ] **Step 8: Commit**

```bash
git add lib/calicotab/parseJsValue.ts tests/calicotab.parseJsValue.test.ts
git commit -m "$(cat <<'EOF'
fix: reject __proto__ keys in parseJsValue to prevent prototype pollution

parseJsValue's ObjectExpression case previously accepted `__proto__` as
an ordinary key. obj['__proto__'] = X triggers the prototype setter
inherited from Object.prototype (only Object.defineProperty creates a
data property without firing the setter), so a Tabbycat payload like
`{ __proto__: { isAdmin: true } }` would silently mutate the
materialized object's prototype.

Pollution is bounded to the specific parsed object — it doesn't escape
to global Object.prototype — but `for...in` iteration and prototype-
chain property lookups would surface the polluted values. Current
consumers (parseSlice → extractVueData → field-by-field reads) don't
expose this as a live exploit, but tightening the allowlist removes the
latent risk and matches the helper's "pure data only" contract.

`constructor` and `prototype` keys remain accepted — they're regular
own properties on plain object instances with no setter behavior.

The original code-quality review of sub-project 2 noted this concern but
concluded the assignment path created a data property. That conclusion
was wrong: only Object.defineProperty creates a data property; plain
assignment fires the inherited setter (empirically verified).

Three new test cases pin the rejection (identifier-form key, quoted-
literal-form key, and nested-recursion path).

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
- One commit on the branch.
- Two files in the diff: `lib/calicotab/parseJsValue.ts` (~+13 LOC) and `tests/calicotab.parseJsValue.test.ts` (~+12 LOC).
- 466 tests pass.
- Lint: 2 warnings, 0 errors.
- Typecheck: clean.

- [ ] **Step 2: Stop and ask the user about push / PR / merge**

Push and PR are user-visible / shared-state actions per the harness rules. Do not run `git push` or `gh pr create` without explicit user confirmation. Present the standard `superpowers:finishing-a-development-branch` options:

1. Merge to `main` locally (same pattern as previous sub-projects).
2. Push + open a PR.
3. Keep the branch as-is.
4. Discard.

---

## Self-review

**1. Spec coverage.** Walking through each section of the spec:

- ✅ "In scope" item 1 (`key === '__proto__'` check inside `ObjectExpression` case): Step 3.
- ✅ "In scope" item 2 (update public `parseJsValue` JSDoc): Step 4.
- ✅ "In scope" item 3 (3 test cases — identifier, quoted-literal, nested): Step 1.
- ✅ "Explicitly out of scope" — `constructor`/`prototype` not rejected; code change explicitly comments on why those are safe.
- ✅ No `PARSER_VERSION` bump — not touched anywhere.
- ✅ Single commit (Step 8).
- ✅ Verification per the spec's success criteria (466 tests, 2 lint warnings, typecheck clean): Step 6.

**2. Placeholder scan.** No TBD / TODO (as placeholder) / "fill in" / "add appropriate" / "similar to". Every code step has a complete, verbatim code block.

**3. Type consistency.** Cross-checked names:

- `key` variable — already exists in the ObjectExpression case at line 75; the new `if (key === '__proto__')` check uses the existing variable.
- `parseJsValue` import — already exists in the test file from sub-project 2's tests; the three new `it` blocks call it the same way.
- Error message string `'__proto__ keys are not supported'` — used in Step 3 (implementation) and indirectly verified by Step 5's `.toThrow()` (which accepts any throw, not a specific message). Consistent.

No drift.
