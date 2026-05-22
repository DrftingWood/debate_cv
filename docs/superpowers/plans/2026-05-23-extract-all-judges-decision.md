# Delete Dormant `EXTRACT_ALL_JUDGES` Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the dormant `EXTRACT_ALL_JUDGES` env-flag-gated code path in `lib/calicotab/ingest.ts` and its 119-LOC writer function, plus the corresponding documentation block in `.env.example`. No behavior change in production (the flag has been off in deployed env since the function was introduced).

**Architecture:** Single branch, single commit. Three deletions: (1) the comment+if-gate block at `ingest.ts:809-821`, (2) the `recordAllJudgeAssignmentsFromRoundResults` function at `ingest.ts:1543-1661`, (3) the `EXTRACT_ALL_JUDGES` documentation block at `.env.example:38-44`. All other writers, schema fields, and cleanup logic stay intact.

**Tech Stack:** TypeScript 5.7 strict, Vitest 2 (Node env), npm canonical. Path alias `@/*` → repo root.

**Spec:** `docs/superpowers/specs/2026-05-23-extract-all-judges-decision-design.md`

---

## Pre-flight: branch setup & baseline

- [ ] **Step 1: Create the feature branch**

```bash
git checkout main
git status
git checkout -b refactor/delete-extract-all-judges
git status
```

Expected: clean working tree on `refactor/delete-extract-all-judges`. The only untracked file should be `.claude/settings.local.json` (harness-local).

- [ ] **Step 2: Confirm baseline is green**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: **466 tests pass**, 45 files (the smoke test file is present but skipped without `RUN_LIVE_SMOKE`).
- `npm run lint`: **2 warnings, 0 errors** (pre-existing `parseTabs.ts:1112` and `scripts/test-scrape.mjs:16`).
- `npm run typecheck`: exit 0, no output.

If any fails on freshly-branched main, stop and flag.

---

## Task 1: Delete the gate, the function, and the env.example block

**Files:**
- Modify: `lib/calicotab/ingest.ts` (delete L809-821 gate block; delete L1543-1661 function body)
- Modify: `.env.example` (delete L38-44 documentation block)

Single commit at the end.

- [ ] **Step 1: Verify the exact target lines before editing**

Run these greps to confirm the line numbers haven't drifted (they're correct as of the spec but file edits could have shifted them):

```bash
grep -n "EXTRACT_ALL_JUDGES" lib/calicotab/ingest.ts
grep -n "async function recordAllJudgeAssignmentsFromRoundResults" lib/calicotab/ingest.ts
grep -n "EXTRACT_ALL_JUDGES" .env.example
```

Expected:
- `lib/calicotab/ingest.ts:815` shows `if (process.env.EXTRACT_ALL_JUDGES === 'true') {`
- `lib/calicotab/ingest.ts:1543` shows `async function recordAllJudgeAssignmentsFromRoundResults(`
- `.env.example:44` shows `# EXTRACT_ALL_JUDGES=true`

If any line is in a different position, recalculate the line numbers in the steps below before editing.

- [ ] **Step 2: Delete the gate block in `ingest.ts`**

Open `lib/calicotab/ingest.ts`. Find and delete this exact block (currently lines 809-821):

```typescript
  // Optional: extract round-results judge assignments for EVERY judge that
  // appeared on a panel, not just the URL owner. Lets users who never had a
  // private URL for a tournament still get their judging history populated
  // when a teammate's URL is ingested. Off by default — enabling at scale
  // means many more JudgeAssignment rows per tournament; gate until verified
  // on real data.
  if (process.env.EXTRACT_ALL_JUDGES === 'true') {
    await recordAllJudgeAssignmentsFromRoundResults(
      rounds,
      tournamentId,
      personIdByNormalized,
    );
  }
```

Adjacent context to preserve (do NOT delete these — they're the lines immediately before and after):

Before (the previous block's closing brace):
```typescript
      if (fromResults.diagnostic) fetchWarnings.push(fromResults.diagnostic);
    }
  }
```

After (the next comment about DiscoveredUrl):
```typescript
  // Mark the DiscoveredUrl as ingested + link to tournament (registrationPersonId set inside linkRegistrationPerson).
  await prisma.discoveredUrl.updateMany({
```

After deletion, the gap between the previous block's `}` and the `// Mark the DiscoveredUrl` comment should be a single blank line. If two consecutive blank lines remain, delete one.

- [ ] **Step 3: Delete the function body in `ingest.ts`**

Still in `lib/calicotab/ingest.ts`. Find the `recordAllJudgeAssignmentsFromRoundResults` function. Its signature and full body span from line 1543 to line 1661. The function starts with:

```typescript
async function recordAllJudgeAssignmentsFromRoundResults(
  rounds: ReturnType<typeof parseRoundResults>[],
  tournamentId: bigint,
  personIdByNormalized: Map<string, bigint>,
): Promise<void> {
```

And ends with the closing brace on line 1661:

```typescript
      update: {},
      create: { tournamentParticipantId: tp.id, role: 'judge' },
    });
  }
}
```

Delete the entire function — from the `async function recordAllJudgeAssignmentsFromRoundResults(` line through the final closing `}` brace on line 1661. There should be a blank line above the function (separating it from whatever ends at L1542) — that blank line can stay; if deletion leaves two consecutive blank lines, collapse them to one.

Also check the line immediately after L1661 — if the function is the last function in the file (followed only by EOF), nothing further is needed. If another function follows, ensure single blank-line separation.

- [ ] **Step 4: Delete the `.env.example` block**

Open `.env.example`. Find and delete lines 38-44 (the `# --- Ingest feature flags ---` section header through the `# EXTRACT_ALL_JUDGES=true` example):

```
# --- Ingest feature flags ---
# When set to "true", every judge assignment parsed from round-results
# pages is persisted (not just the URL owner's panel rows). Lets users
# who never had a private URL for a tournament still pick up their
# judging history when a teammate ingests one. Off by default; the
# extra rows scale with (judges × rounds) per tournament.
# EXTRACT_ALL_JUDGES=true
```

Adjacent context:

Before (the ADMIN_EMAIL line, currently L36):
```
ADMIN_EMAIL=
```

After (the scraper proxy section, currently L46):
```
# --- Scraper proxy (optional, for persistent Cloudflare 403s) ---
```

After deletion, leave a single blank line between `ADMIN_EMAIL=` and the next section header.

- [ ] **Step 5: Sweep for residual references**

Confirm nothing else in the repo references the deleted names:

```bash
grep -rn "EXTRACT_ALL_JUDGES\|recordAllJudgeAssignmentsFromRoundResults" --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.md" --include="*.example" --include="*.json" 2>&1 | grep -v "node_modules\|docs/superpowers/specs\|docs/superpowers/plans"
```

Expected: **zero matches**. (References inside `docs/superpowers/specs/` and `docs/superpowers/plans/` are intentional — those are the design spec and this plan; they discuss the deletion historically.)

If any match appears outside the excluded paths, investigate — it may indicate the deletion was incomplete, OR there's a doc/CLAUDE.md reference the spec missed that also needs cleaning.

- [ ] **Step 6: Run full test suite, lint, and typecheck**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: **466 tests pass** (unchanged — no test exercised the deleted code).
- `npm run lint`: **2 warnings, 0 errors** (unchanged from baseline; deleting code shouldn't introduce new lint warnings).
- `npm run typecheck`: clean.

If `npm run lint` shows a new "unused variable" or "unused import" warning, the deletion may have left an orphan. Inspect.

If `npm run typecheck` complains about an undefined function reference, the call site at the old L815 wasn't deleted properly — re-do Step 2.

- [ ] **Step 7: Sanity check — file size shrank as expected**

```bash
wc -l lib/calicotab/ingest.ts
```

Expected: roughly **−132 LOC** from baseline. The previous size was approximately 1710 lines; the new size should be approximately 1578 lines. Off by ~5 lines either way is fine (depending on exact blank-line handling).

- [ ] **Step 8: Commit**

```bash
git add lib/calicotab/ingest.ts .env.example
git commit -m "$(cat <<'EOF'
refactor: delete dormant EXTRACT_ALL_JUDGES flag and recordAllJudgeAssignmentsFromRoundResults

The EXTRACT_ALL_JUDGES env flag has gated `recordAllJudgeAssignmentsFromRoundResults`
since the function was introduced. The flag has been off in deployed Vercel
env; no test exercises the path; no real-world verification was ever done.
Original session diagnosis flagged it as a "feature I might want" smell.

The function would have credited judges named on panels parsed from
round-results pages — i.e., when user X ingests a URL where X was the
registration person, Y appears as a judge on one of X's debates, and we
want Y's judge history populated even though Y hasn't ingested their own
URL yet. The infrastructure to support this is preserved at the schema
level (JudgeAssignment.source field) — only the writer and its activation
toggle are removed. If we ever want this feature back, the rebuild is a
new writer function with verification baked in from day one rather than
promoting unverified code.

Three deletions:
- lib/calicotab/ingest.ts:809-821 — the `if (process.env.EXTRACT_ALL_JUDGES
  === 'true')` gate plus its explanatory comment block.
- lib/calicotab/ingest.ts:1543-1661 — the `recordAllJudgeAssignmentsFromRoundResults`
  function body (~119 LOC).
- .env.example:38-44 — the documentation block for the flag.

What explicitly stays:
- JudgeAssignment.source schema field — still written by
  recordJudgeRoundsFromLanding ('landing') and recordJudgeRoundsFromRoundResults
  ('round_results' for the URL owner's own panels parsed from round pages).
- prepareTournamentWideRefresh's where: { source: 'round_results' } cleanup at
  ingest.ts:1089 — still load-bearing for the URL-owner round-results path.
- ParserRun table — entirely untouched. Verified load-bearing for cache
  invalidation (isLatestParserRun), the admin parser-health dashboard
  (app/admin/page.tsx), and the user-facing /cv/verify page. The original
  session diagnosis was wrong to flag it as write-only.

No PARSER_VERSION bump — gated code never ran in production; parser output
cardinality unchanged. Re-parsing a cached snapshot produces identical
output before and after.

Reversible by `git revert` if a forgotten Vercel preview env var turns out
to have been setting EXTRACT_ALL_JUDGES=true somewhere.

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
- Two files in the diff: `lib/calicotab/ingest.ts` (~−132 LOC) and `.env.example` (~−7 LOC).
- 466 tests pass.
- Lint: 2 warnings, 0 errors.
- Typecheck: clean.

- [ ] **Step 2: Stop and ask the user about push / PR / merge**

Push and PR are user-visible / shared-state actions per the harness rules. Do not run `git push` or `gh pr create` without explicit user confirmation. Present the standard `superpowers:finishing-a-development-branch` options:

1. Merge to `main` locally (same pattern as previous sub-projects).
2. Push + open a PR.
3. Keep the branch as-is.
4. Discard.

- [ ] **Step 3 (deferred manual verification — optional)**

After merging, check the Vercel project's env vars panel (Vercel dashboard → debate_cv → Settings → Environment Variables) and confirm `EXTRACT_ALL_JUDGES` is NOT set in any environment (production, preview, development). If by some chance it WAS set, the deletion means the next ingest after deploy will stop creating those rows — which is the intended behavior, but worth knowing about. This step doesn't gate the merge; it's informational.

---

## Self-review

**1. Spec coverage.** Walking through each section of the spec:

- ✅ "In scope" item 1 (delete the gate at L808-821 plus comment): Step 2.
- ✅ "In scope" item 2 (delete `recordAllJudgeAssignmentsFromRoundResults` at L1543-1661): Step 3.
- ✅ "In scope" item 3 (grep-sweep for residuals): Step 5 PLUS the `.env.example` cleanup at Step 4 (the sweep done during planning surfaced one residual — the `.env.example` block — which is now handled by an explicit step rather than left to discovery).
- ✅ "Explicitly out of scope" — JudgeAssignment.source field, prepareTournamentWideRefresh, recordJudgeRoundsFromRoundResults, ParserRun table — none of these are touched by any step.
- ✅ No `PARSER_VERSION` bump: not modified.
- ✅ Single commit (Step 8).
- ✅ Verification at every gate (Step 6 full suite, Step 7 LOC sanity check, post-flight Step 1).

**2. Placeholder scan.** Searched the plan for TBD / "fill in" / "add appropriate" / "similar to". No matches. Every code step has a verbatim code block.

**3. Type consistency.** No new types or functions introduced — this is a pure deletion. The function being deleted (`recordAllJudgeAssignmentsFromRoundResults`) is referenced only at its sole call site (the gate at L815), which is also being deleted in the same step group. No dangling references possible.

**4. Spec amendment noted in plan.** The spec said "grep-sweep before commit" for residuals. The pre-plan grep already found one (`.env.example`), so the plan upgrades that from a discovery sweep to an explicit deletion step (Step 4). This is plan-level refinement, not a spec change — same intent, just front-loaded the work.
