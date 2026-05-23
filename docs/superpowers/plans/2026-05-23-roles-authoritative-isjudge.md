# Roles-Authoritative `isJudge` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans / superpowers:subagent-driven-development. Steps use `- [ ]` syntax.

**Goal:** Migrate `ParticipantRole.role='judge'` to be authoritative for `isJudge`. Backfill legacy data, simplify `isJudgeParticipant`, bump `PARSER_VERSION`.

**Architecture:** One migration (idempotent INSERT…WHERE NOT EXISTS); one function simplification in `lib/cv/roleClassification.ts`; one constant bump in `lib/calicotab/version.ts`; rewrite the existing `tests/cv.isJudgeParticipant.test.ts` to test only the new single-signal contract. Single commit at end.

**Tech Stack:** Prisma 6 (Postgres migrations), TypeScript 5.7, Vitest 2.

**Spec:** `docs/superpowers/specs/2026-05-23-roles-authoritative-isjudge-design.md`

---

## Pre-flight

- [ ] Branch + baseline:
  ```bash
  git checkout main && git checkout -b refactor/roles-authoritative-isjudge
  npm test 2>&1 | tail -3
  ```
  Expected: 485 passing.

---

## Task 1: Migration

**File:** Create `prisma/migrations/20260523130000_roles_authoritative_isjudge/migration.sql`

Contents (verbatim):

```sql
-- Sub-project 9b: backfill ParticipantRole 'judge' rows for legacy
-- participants who had judge signals (judgeTypeTag, chairedPrelimRounds,
-- lastOutroundChaired, lastOutroundPaneled) but no role row. After this
-- migration applies, the role row is authoritative for isJudge and the
-- 5-signal OR in lib/cv/roleClassification.ts is replaced by a single
-- role check (see same-commit code change).
--
-- INSERT ... WHERE NOT EXISTS is idempotent — re-running the migration
-- (e.g. on a freshly-cloned dev DB) doesn't duplicate rows.

INSERT INTO "ParticipantRole" ("tournamentParticipantId", "role")
SELECT tp.id, 'judge'
FROM "TournamentParticipant" tp
WHERE (
  tp."judgeTypeTag" IS NOT NULL
  OR tp."chairedPrelimRounds" > 0
  OR tp."lastOutroundChaired" IS NOT NULL
  OR tp."lastOutroundPaneled" IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1 FROM "ParticipantRole" pr
  WHERE pr."tournamentParticipantId" = tp.id AND pr.role = 'judge'
);
```

No schema change in `prisma/schema.prisma` — the migration is pure data backfill on existing tables.

---

## Task 2: Simplify `isJudgeParticipant`

**File:** `lib/cv/roleClassification.ts`

Replace the entire current contents (~29 LOC) with:

```typescript
/**
 * Decide whether a `TournamentParticipant` row represents the user
 * playing the judge role in that tournament. Reads `ParticipantRole`
 * as the single source of truth.
 *
 * After sub-project 9b's backfill migration applies, every legacy
 * participant that previously satisfied the 5-signal OR (judgeTypeTag,
 * chairedPrelimRounds, lastOutroundChaired, lastOutroundPaneled, or an
 * existing 'judge' role row) has a 'judge' role row written for them.
 * New ingests already write the role row via writeJudgeParticipantRole.
 * So a single role-row check is sufficient.
 *
 * The dropped OR signals are still useful for CV display (chair counts,
 * deepest outrounds) — only their role in classification changes.
 */
export function isJudgeParticipant(p: {
  roles: ReadonlyArray<{ role: string }>;
}): boolean {
  return p.roles.some((r) => r.role === 'judge');
}
```

The signature drops the four unused fields. Callers in `lib/cv/buildCvData.ts` pass full participant objects with `roles` included; the signature change is structurally narrowing (caller's object has MORE fields than the parameter type requires, which TypeScript accepts via structural subtyping).

---

## Task 3: Bump `PARSER_VERSION`

**File:** `lib/calicotab/version.ts`

Change line 8 from:

```typescript
export const PARSER_VERSION = '20260501.3';
```

to:

```typescript
export const PARSER_VERSION = '20260523.0';
```

---

## Task 4: Rewrite `tests/cv.isJudgeParticipant.test.ts`

**File:** `tests/cv.isJudgeParticipant.test.ts`

Replace the entire file's contents with:

```typescript
import { describe, expect, test } from 'vitest';
import { isJudgeParticipant } from '@/lib/cv/roleClassification';

describe('isJudgeParticipant', () => {
  test('returns true when roles contains a judge role row', () => {
    expect(isJudgeParticipant({ roles: [{ role: 'judge' }] })).toBe(true);
  });

  test('returns true when roles contains judge among other roles', () => {
    expect(
      isJudgeParticipant({ roles: [{ role: 'speaker' }, { role: 'judge' }] }),
    ).toBe(true);
  });

  test('returns false when roles is empty', () => {
    expect(isJudgeParticipant({ roles: [] })).toBe(false);
  });

  test('returns false when roles contains only non-judge roles', () => {
    expect(isJudgeParticipant({ roles: [{ role: 'speaker' }] })).toBe(false);
  });

  test('treats role names case-sensitively (lowercase only)', () => {
    // Tabbycat consistently writes 'judge' lowercase; we don't normalise.
    expect(isJudgeParticipant({ roles: [{ role: 'Judge' }] })).toBe(false);
    expect(isJudgeParticipant({ roles: [{ role: 'JUDGE' }] })).toBe(false);
  });
});
```

The previous 9 tests covered the dropped 5-signal OR variants (judgeTypeTag-only, chairedPrelimRounds-only, etc.). Those signals no longer matter for classification — the new tests pin the single role-row check.

---

## Task 5: Verify + commit

- [ ] Run gates:

  ```bash
  npm test 2>&1 | tail -5
  npm run lint 2>&1 | tail -3
  npm run typecheck 2>&1 | tail -3
  ```

  Expected:
  - `npm test`: passing count = (485 - 9 deleted from cv.isJudgeParticipant.test.ts + 5 new = **481**), 4 skipped.
  - `npm run lint`: 0 errors, 1 warning (baseline).
  - `npm run typecheck`: clean.

  If `typecheck` fails on a `buildCvData.ts` call site complaining that the participant object can't be assigned to `{ roles: ... }`, the issue is that the existing call already passes a full participant object with extra fields — TypeScript should accept this via structural subtyping. If it doesn't, check whether the call passed the four removed fields as required (it shouldn't have since they were just on the type).

- [ ] Single commit:

  ```bash
  git add prisma/migrations/20260523130000_roles_authoritative_isjudge/migration.sql lib/cv/roleClassification.ts lib/calicotab/version.ts tests/cv.isJudgeParticipant.test.ts
  git commit -m "$(cat <<'EOF'
  refactor: make ParticipantRole 'judge' authoritative for isJudge (sub-project 9b)

  Sub-project 9 added writeJudgeParticipantRole, which writes a 'judge'
  ParticipantRole row alongside the participant's judge-signal fields
  (judgeTypeTag, chairedPrelimRounds, lastOutroundChaired,
  lastOutroundPaneled) for every new ingest. This commit makes the role
  row authoritative for isJudge:

  - Migration 20260523130000_roles_authoritative_isjudge backfills
    'judge' role rows for legacy participants who had judge signals but
    no role row. INSERT ... WHERE NOT EXISTS is idempotent.

  - isJudgeParticipant simplifies from a 5-signal OR to a single
    `p.roles.some(r => r.role === 'judge')` check. Signature drops the
    four unused fields; the function's only requirement is now { roles:
    ReadonlyArray<{ role: string }> }.

  - PARSER_VERSION bumps from 20260501.3 to 20260523.0 to invalidate
    cached parses so the next CV view per user re-ingests against the
    new code path.

  - tests/cv.isJudgeParticipant.test.ts rewritten to test the
    single-signal contract (5 cases). The 9 previous cases tested the
    5-signal OR variants which no longer apply.

  Behavior preservation: any participant currently is-judge-by-OR
  either already has a 'judge' role row (no-op) or gets one from the
  backfill. Net same classification result post-migration.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Post-flight

- [ ] Confirm:
  ```bash
  git log --oneline main..HEAD
  git diff --stat main..HEAD
  ```
  Expected: 1 commit, 4 files (1 new migration + 3 modified).

- [ ] Ask user about push/PR/merge.
