# `ingest.ts` Pipeline Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two behavior-preserving refactors in one branch, two commits: (1) extract a shared `computeJudgeAggregates` + `writeJudgeParticipantRole` helper into a new `lib/calicotab/judgeAggregates.ts` and refactor both judge writers to use it; (2) decompose the 820-LOC `ingestPrivateUrl` orchestrator into a ~30-line top-level function plus 8 typed phase functions defined below it.

**Architecture:** Commit 1 lands the judge dedup foundation independently (helper + tests + both writer refactors). Commit 2 lands the orchestrator decomposition — each of the 8 phase functions extracted from the current monolith in sequence, with the test suite verified green after each extraction.

**Tech Stack:** TypeScript 5.7 strict, Prisma 6, Vitest 2 (Node env, mock-driven), npm canonical. Path alias `@/*` → repo root.

**Spec:** `docs/superpowers/specs/2026-05-23-ingest-pipeline-decomposition-design.md`

---

## Pre-flight: branch setup & baseline

- [ ] **Step 1: Create the feature branch**

```bash
git checkout main
git status
git checkout -b refactor/ingest-pipeline-decomposition
git status
```

Expected: clean tree on `refactor/ingest-pipeline-decomposition`, only `.claude/settings.local.json` untracked.

- [ ] **Step 2: Confirm baseline is green**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: **478 tests pass**, 4 skipped (current main after sub-project 8 landed).
- `npm run lint`: **1 warning, 0 errors** (baseline: `scripts/test-scrape.mjs:16` `ROOT`).
- `npm run typecheck`: clean.

If anything regresses on freshly-branched `main`, stop and flag.

---

## Task 1: judgeAggregates helper + tests (commit 1, part 1 of 3)

**Files:**
- Create: `lib/calicotab/judgeAggregates.ts`
- Create: `tests/calicotab.judgeAggregates.test.ts`

TDD-ordered: tests first, then implementation.

- [ ] **Step 1: Write the failing tests file**

Create `tests/calicotab.judgeAggregates.test.ts` with the following exact content:

```typescript
import { describe, expect, test } from 'vitest';
import {
  computeJudgeAggregates,
  type JudgeRound,
} from '@/lib/calicotab/judgeAggregates';

describe('computeJudgeAggregates', () => {
  test('returns zeros and nulls for empty rounds', () => {
    const result = computeJudgeAggregates([]);
    expect(result).toEqual({
      chairedPrelims: 0,
      deepestChaired: null,
      deepestPaneled: null,
    });
  });

  test('counts prelim rounds chaired (roundNumber != null, role=chair)', () => {
    const rounds: JudgeRound[] = [
      { stage: 'Round 1', role: 'chair', roundNumber: 1 },
      { stage: 'Round 2', role: 'chair', roundNumber: 2 },
      { stage: 'Round 3', role: 'panellist', roundNumber: 3 },
    ];
    const result = computeJudgeAggregates(rounds);
    expect(result.chairedPrelims).toBe(2);
    expect(result.deepestChaired).toBeNull();
    expect(result.deepestPaneled).toBeNull();
  });

  test('picks deepest chaired outround by outroundRankStrict', () => {
    const rounds: JudgeRound[] = [
      { stage: 'Quarterfinals', role: 'chair', roundNumber: null },
      { stage: 'Semifinals', role: 'chair', roundNumber: null },
      { stage: 'Octofinals', role: 'chair', roundNumber: null },
    ];
    const result = computeJudgeAggregates(rounds);
    expect(result.deepestChaired).toBe('Semifinals');
  });

  test('picks deepest paneled outround (panellist OR trainee count)', () => {
    const rounds: JudgeRound[] = [
      { stage: 'Octofinals', role: 'panellist', roundNumber: null },
      { stage: 'Semifinals', role: 'trainee', roundNumber: null },
    ];
    const result = computeJudgeAggregates(rounds);
    expect(result.deepestPaneled).toBe('Semifinals');
  });

  test('separates chaired and paneled — chair role never lands in deepestPaneled', () => {
    const rounds: JudgeRound[] = [
      { stage: 'Grand Final', role: 'chair', roundNumber: null },
      { stage: 'Quarterfinals', role: 'panellist', roundNumber: null },
    ];
    const result = computeJudgeAggregates(rounds);
    expect(result.deepestChaired).toBe('Grand Final');
    expect(result.deepestPaneled).toBe('Quarterfinals');
  });

  test('ignores outrounds whose stage outroundRankStrict cannot rank', () => {
    const rounds: JudgeRound[] = [
      { stage: 'Mystery Round', role: 'chair', roundNumber: null },
      { stage: 'Finals', role: 'chair', roundNumber: null },
    ];
    const result = computeJudgeAggregates(rounds);
    // Mystery Round won't rank; Finals will. deepestChaired is 'Finals'.
    expect(result.deepestChaired).toBe('Finals');
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
npx vitest run tests/calicotab.judgeAggregates.test.ts
```

Expected: All cases FAIL with `Failed to resolve import "@/lib/calicotab/judgeAggregates"`. The helper file doesn't exist yet.

- [ ] **Step 3: Create `lib/calicotab/judgeAggregates.ts`**

Create the file with the following exact content:

```typescript
import type { Prisma, PrismaClient } from '@prisma/client';
import { getInroundsChairedCount, outroundRankStrict } from './judgeStats';

/**
 * Input shape for the judge aggregate computation. Both Tabbycat data
 * sources (landing-page Debates card via extractAdjudicatorRounds and
 * round-results panel scrape via parseRoundResults) normalize to this
 * shape before calling computeJudgeAggregates, so the aggregate semantics
 * live in one place instead of being re-implemented at each site.
 *
 * roundNumber === null indicates an outround (named stage); != null is an
 * in-round (numeric or per-tournament-classified prelim).
 */
export type JudgeRound = {
  stage: string;
  role: 'chair' | 'panellist' | 'trainee';
  roundNumber: number | null;
};

export type JudgeAggregates = {
  chairedPrelims: number;
  deepestChaired: string | null;
  deepestPaneled: string | null;
};

/**
 * Pure aggregate computation. Counts how many prelims the judge chaired
 * (via getInroundsChairedCount, which classifies each round's stage label
 * to handle non-numeric prelim labels some installs use). Finds the
 * deepest chaired outround and the deepest non-chair outround (panellist
 * or trainee — they're grouped because the Debates-card-derived "trainee"
 * role still represents a real outround appearance for CV purposes).
 *
 * Outrounds are ranked via outroundRankStrict — anything that doesn't
 * rank (unknown stage label) is dropped from the deepest-of computation.
 */
export function computeJudgeAggregates(rounds: JudgeRound[]): JudgeAggregates {
  const chairedPrelims = getInroundsChairedCount(
    rounds.map((r) => ({ stage: r.stage, panelRole: r.role })),
  );
  const outrounds = rounds.filter((r) => r.roundNumber == null);
  const ranked = outrounds
    .map((r) => ({ r, rank: outroundRankStrict(r.stage) }))
    .filter((x): x is { r: typeof x.r; rank: number } => x.rank != null)
    .sort((a, b) => b.rank - a.rank);
  return {
    chairedPrelims,
    deepestChaired: ranked.find((x) => x.r.role === 'chair')?.r.stage ?? null,
    deepestPaneled:
      ranked.find((x) => x.r.role === 'panellist' || x.r.role === 'trainee')?.r.stage ?? null,
  };
}

/**
 * Merge mode for writeJudgeParticipantRole:
 *   - 'overwrite': always set chairedPrelimRounds / lastOutroundChaired /
 *     lastOutroundPaneled to the values in `aggregates`. Used by the
 *     landing-page Debates card path (authoritative when present).
 *   - 'fillNullsOnly': read the existing row first; only set a field if
 *     the existing value is null. Used by the round-results panel path
 *     (which runs after landing and shouldn't overwrite the more
 *     authoritative landing-derived values).
 *
 * Both modes upsert the ParticipantRole 'judge' row so the participant is
 * counted as a judge regardless of which path populated the aggregates.
 */
export type JudgeWriteMode = 'overwrite' | 'fillNullsOnly';

/**
 * Type alias for the Prisma transaction client (the value passed to a
 * $transaction callback). We accept either the transaction client or the
 * top-level prisma instance — the round-results path runs OUTSIDE the
 * main transaction, so it passes the global prisma; the landing path
 * runs INSIDE its own short transaction and passes tx.
 */
type PrismaTxOrClient = Prisma.TransactionClient | PrismaClient;

export async function writeJudgeParticipantRole(
  client: PrismaTxOrClient,
  tournamentId: bigint,
  personId: bigint,
  aggregates: JudgeAggregates,
  mode: JudgeWriteMode,
): Promise<void> {
  const { chairedPrelims, deepestChaired, deepestPaneled } = aggregates;

  type UpdateShape = {
    judgeTypeTag: 'Adjudicator';
    chairedPrelimRounds?: number | null;
    lastOutroundChaired?: string | null;
    lastOutroundPaneled?: string | null;
  };

  let update: UpdateShape;
  if (mode === 'overwrite') {
    update = {
      judgeTypeTag: 'Adjudicator',
      chairedPrelimRounds: chairedPrelims || null,
      lastOutroundChaired: deepestChaired,
      lastOutroundPaneled: deepestPaneled,
    };
  } else {
    // fillNullsOnly: read existing and only set fields where existing is null.
    const existing = await client.tournamentParticipant.findUnique({
      where: { tournamentId_personId: { tournamentId, personId } },
      select: {
        chairedPrelimRounds: true,
        lastOutroundChaired: true,
        lastOutroundPaneled: true,
      },
    });
    update = { judgeTypeTag: 'Adjudicator' };
    if (chairedPrelims > 0 && (existing?.chairedPrelimRounds ?? null) == null) {
      update.chairedPrelimRounds = chairedPrelims;
    }
    if (deepestChaired && !existing?.lastOutroundChaired) {
      update.lastOutroundChaired = deepestChaired;
    }
    if (deepestPaneled && !existing?.lastOutroundPaneled) {
      update.lastOutroundPaneled = deepestPaneled;
    }
  }

  const tp = await client.tournamentParticipant.upsert({
    where: { tournamentId_personId: { tournamentId, personId } },
    update,
    create: {
      tournamentId,
      personId,
      judgeTypeTag: 'Adjudicator',
      chairedPrelimRounds: chairedPrelims || null,
      lastOutroundChaired: deepestChaired,
      lastOutroundPaneled: deepestPaneled,
    },
  });
  await client.participantRole.upsert({
    where: {
      tournamentParticipantId_role: {
        tournamentParticipantId: tp.id,
        role: 'judge',
      },
    },
    update: {},
    create: { tournamentParticipantId: tp.id, role: 'judge' },
  });
}
```

- [ ] **Step 4: Run the helper tests — they should now pass**

```bash
npx vitest run tests/calicotab.judgeAggregates.test.ts
```

Expected: all 6 cases PASS.

If `chairedPrelims` count is wrong (e.g., expected 2, got 0), check that `getInroundsChairedCount` is imported correctly from `./judgeStats` and that the role mapping passes `panelRole: r.role` (not `r.panelRole`).

- [ ] **Step 5: Run the full test suite + lint + typecheck**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: **484 passing**, 4 skipped (baseline 478 + 6 new).
- `npm run lint`: 1 warning, 0 errors.
- `npm run typecheck`: clean. The new `judgeAggregates.ts` typechecks against the existing `Prisma.TransactionClient` type.

Do NOT commit yet. Task 2 finishes commit 1 by refactoring both writers.

---

## Task 2: Refactor `recordJudgeRoundsFromLanding` (commit 1, part 2 of 3)

**Files:**
- Modify: `lib/calicotab/ingest.ts:1212-1307` (the `recordJudgeRoundsFromLanding` function body)

- [ ] **Step 1: Add the helper imports at the top of `lib/calicotab/ingest.ts`**

Current imports include (around L29):

```typescript
import { getInroundsChairedCount, outroundRankStrict } from './judgeStats';
```

Add the new judgeAggregates import below it. After this task and Task 3, the inline imports of `getInroundsChairedCount` and `outroundRankStrict` will no longer be used in `ingest.ts` directly — but they're still imported by `judgeAggregates.ts`, so they don't need to be removed from `ingest.ts` yet (do that as part of the Task 3 cleanup).

Update the imports block:

```typescript
import { getInroundsChairedCount, outroundRankStrict } from './judgeStats';
import {
  computeJudgeAggregates,
  writeJudgeParticipantRole,
  type JudgeRound,
} from './judgeAggregates';
```

- [ ] **Step 2: Replace the inline aggregate computation and write in `recordJudgeRoundsFromLanding`**

Find `recordJudgeRoundsFromLanding` at `lib/calicotab/ingest.ts:1212`. Current body (relevant section L1243-1305):

```typescript
  // Aggregate stats for the participant row. getInroundsChairedCount classifies
  // each round via classifyRoundLabel (numeric → inround, named → outround) so
  // that prelims tagged with non-numeric labels in some Tabbycat installs
  // still count, and never inflate the count from outround chairs.
  const chairedPrelims = getInroundsChairedCount(
    adjRounds.map((r) => ({ stage: r.stage, panelRole: r.role })),
  );
  const outrounds = adjRounds.filter((r) => r.roundNumber == null);
  const ranked = outrounds
    .map((r) => ({ r, rank: outroundRankStrict(r.stage) }))
    .filter((x): x is { r: typeof x.r; rank: number } => x.rank != null)
    .sort((a, b) => b.rank - a.rank);
  const deepestChaired = ranked.find((x) => x.r.role === 'chair')?.r.stage ?? null;
  const deepestPaneled =
    ranked.find((x) => x.r.role === 'panellist' || x.r.role === 'trainee')?.r.stage ?? null;

  const uniqueRounds = new Map<string, (typeof adjRounds)[number]>();
  for (const r of adjRounds) {
    uniqueRounds.set(`${r.stage}|${r.role}|${r.roundNumber ?? ''}`, r);
  }

  await prisma.$transaction(async (tx) => {
    await tx.judgeAssignment.deleteMany({ where: { tournamentId, personId } });
    for (const r of uniqueRounds.values()) {
      await tx.judgeAssignment.create({
        data: {
          tournamentId,
          personId,
          stage: r.stage,
          panelRole: r.role,
          roundNumber: r.roundNumber,
          source: 'landing',
        },
      });
    }
    const tp = await tx.tournamentParticipant.upsert({
      where: { tournamentId_personId: { tournamentId, personId } },
      update: {
        judgeTypeTag: 'Adjudicator',
        chairedPrelimRounds: chairedPrelims || null,
        lastOutroundChaired: deepestChaired,
        lastOutroundPaneled: deepestPaneled,
      },
      create: {
        tournamentId,
        personId,
        judgeTypeTag: 'Adjudicator',
        chairedPrelimRounds: chairedPrelims || null,
        lastOutroundChaired: deepestChaired,
        lastOutroundPaneled: deepestPaneled,
      },
    });
    await tx.participantRole.upsert({
      where: {
        tournamentParticipantId_role: {
          tournamentParticipantId: tp.id,
          role: 'judge',
        },
      },
      update: {},
      create: { tournamentParticipantId: tp.id, role: 'judge' },
    });
  });
  return { written: uniqueRounds.size, chairedPrelims, diagnostic: null };
}
```

Replace with (uses `computeJudgeAggregates` + `writeJudgeParticipantRole`):

```typescript
  // Compute aggregates (chairedPrelims + deepest chair/panel outrounds) via
  // the shared helper. See lib/calicotab/judgeAggregates.ts for the rules
  // — same semantics this writer used inline before sub-project 9 dedup.
  const aggregates = computeJudgeAggregates(
    adjRounds.map(
      (r): JudgeRound => ({ stage: r.stage, role: r.role, roundNumber: r.roundNumber }),
    ),
  );

  const uniqueRounds = new Map<string, (typeof adjRounds)[number]>();
  for (const r of adjRounds) {
    uniqueRounds.set(`${r.stage}|${r.role}|${r.roundNumber ?? ''}`, r);
  }

  await prisma.$transaction(async (tx) => {
    await tx.judgeAssignment.deleteMany({ where: { tournamentId, personId } });
    for (const r of uniqueRounds.values()) {
      await tx.judgeAssignment.create({
        data: {
          tournamentId,
          personId,
          stage: r.stage,
          panelRole: r.role,
          roundNumber: r.roundNumber,
          source: 'landing',
        },
      });
    }
    // Landing path is authoritative when present — overwrite mode.
    await writeJudgeParticipantRole(tx, tournamentId, personId, aggregates, 'overwrite');
  });
  return {
    written: uniqueRounds.size,
    chairedPrelims: aggregates.chairedPrelims,
    diagnostic: null,
  };
}
```

- [ ] **Step 3: Run the landing-specific tests to confirm no behavior regression**

```bash
npx vitest run tests/calicotab.parseNav.adjudicator.test.ts tests/calicotab.parseNav.test.ts tests/calicotab.parseNav.won.test.ts
```

Expected: every existing case still passes.

If the participant write behavior changed (e.g., `chairedPrelimRounds` is `0` instead of `null` because `chairedPrelims || null` was lost in translation), re-check Step 2 and confirm the helper still applies the `chairedPrelims || null` coercion. The helper's `overwrite` branch sets `chairedPrelimRounds: chairedPrelims || null` — that line matches the original.

---

## Task 3: Refactor `recordJudgeRoundsFromRoundResults` (commit 1, part 3 of 3)

**Files:**
- Modify: `lib/calicotab/ingest.ts:1412-1550` (the `recordJudgeRoundsFromRoundResults` function body)

- [ ] **Step 1: Replace the inline aggregate computation and write in `recordJudgeRoundsFromRoundResults`**

Find `recordJudgeRoundsFromRoundResults` at `lib/calicotab/ingest.ts:1412`. The bottom portion of the function (after the `hits` array is built, roughly L1484-1548) is:

```typescript
  // Aggregate stats for the participant row. Same logic as the landing-page
  // path so /cv produces identical numbers regardless of which source the
  // data came from.
  const chairedPrelims = getInroundsChairedCount(
    hits.map((h) => ({ stage: h.stage, panelRole: h.role })),
  );
  const outrounds = hits.filter((h) => h.roundNumber == null);
  const ranked = outrounds
    .map((h) => ({ h, rank: outroundRankStrict(h.stage) }))
    .filter((x): x is { h: typeof x.h; rank: number } => x.rank != null)
    .sort((a, b) => b.rank - a.rank);
  const deepestChaired = ranked.find((x) => x.h.role === 'chair')?.h.stage ?? null;
  const deepestPaneled = ranked.find((x) => x.h.role === 'panellist')?.h.stage ?? null;

  // Merge with whatever the Debates card path already wrote: only fill in
  // null fields, never overwrite. Debates card data is more authoritative
  // (URL owner is explicitly bolded there) so when it ran successfully its
  // values stand.
  const existing = await prisma.tournamentParticipant.findUnique({
    where: { tournamentId_personId: { tournamentId, personId } },
    select: {
      chairedPrelimRounds: true,
      lastOutroundChaired: true,
      lastOutroundPaneled: true,
    },
  });
  const update: {
    judgeTypeTag: 'Adjudicator';
    chairedPrelimRounds?: number;
    lastOutroundChaired?: string;
    lastOutroundPaneled?: string;
  } = { judgeTypeTag: 'Adjudicator' };
  if (chairedPrelims > 0 && (existing?.chairedPrelimRounds ?? null) == null) {
    update.chairedPrelimRounds = chairedPrelims;
  }
  if (deepestChaired && !existing?.lastOutroundChaired) {
    update.lastOutroundChaired = deepestChaired;
  }
  if (deepestPaneled && !existing?.lastOutroundPaneled) {
    update.lastOutroundPaneled = deepestPaneled;
  }

  const tp = await prisma.tournamentParticipant.upsert({
    where: { tournamentId_personId: { tournamentId, personId } },
    update,
    create: {
      tournamentId,
      personId,
      judgeTypeTag: 'Adjudicator',
      chairedPrelimRounds: chairedPrelims || null,
      lastOutroundChaired: deepestChaired,
      lastOutroundPaneled: deepestPaneled,
    },
  });
  await prisma.participantRole.upsert({
    where: {
      tournamentParticipantId_role: {
        tournamentParticipantId: tp.id,
        role: 'judge',
      },
    },
    update: {},
    create: { tournamentParticipantId: tp.id, role: 'judge' },
  });

  return { written, matched: hits.length, diagnostic: null };
}
```

Replace with:

```typescript
  // Compute aggregates (same semantics as the landing-path writer; both
  // sites share lib/calicotab/judgeAggregates.ts). Round-results hits use
  // role: 'chair' | 'panellist' — no trainee role here. The aggregate
  // helper accepts 'trainee' as a possibility but the filter is a no-op
  // for this input shape.
  const aggregates = computeJudgeAggregates(
    hits.map(
      (h): JudgeRound => ({ stage: h.stage, role: h.role, roundNumber: h.roundNumber }),
    ),
  );

  // Merge with whatever the Debates card path already wrote: only fill in
  // null fields, never overwrite. Debates card data is more authoritative
  // (URL owner is explicitly bolded there) so when it ran successfully its
  // values stand.
  await writeJudgeParticipantRole(
    prisma,
    tournamentId,
    personId,
    aggregates,
    'fillNullsOnly',
  );

  return { written, matched: hits.length, diagnostic: null };
}
```

- [ ] **Step 2: Remove the now-unused `getInroundsChairedCount` and `outroundRankStrict` imports from `ingest.ts`**

The imports at the top of `lib/calicotab/ingest.ts:29` previously were:

```typescript
import { getInroundsChairedCount, outroundRankStrict } from './judgeStats';
```

Grep to confirm both symbols are no longer used in `ingest.ts`:

```bash
grep -n "getInroundsChairedCount\|outroundRankStrict" lib/calicotab/ingest.ts
```

Expected: only the one import line matches; no other references. If you see references elsewhere in `ingest.ts`, leave the import; the dedup didn't remove every consumer.

Assuming no other references: delete the import line entirely. The full import block at the top of `ingest.ts` no longer needs `judgeStats` (unless other symbols from `judgeStats` are imported — check by grepping the import block).

If `judgeStats` is no longer imported at all by `ingest.ts`, delete the `import` line. If other symbols are still imported (unlikely given the diff), keep the line but drop the two unused identifiers from the destructuring.

- [ ] **Step 3: Run the full test suite + lint + typecheck**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: **484 passing**, 4 skipped (still — no new tests in Tasks 2 and 3).
- `npm run lint`: 1 warning, 0 errors.
- `npm run typecheck`: clean.

If any test in `tests/calicotab.parseNav.*` fails, check that the `fillNullsOnly` mode in `writeJudgeParticipantRole` correctly reads the existing row and only overwrites null fields. The original code at L1502-1524 used `existing?.chairedPrelimRounds ?? null) == null` (i.e., both undefined and null treated as "absent") — the helper's `(existing?.chairedPrelimRounds ?? null) == null` does the same.

- [ ] **Step 4: Commit 1**

```bash
git add lib/calicotab/judgeAggregates.ts lib/calicotab/ingest.ts tests/calicotab.judgeAggregates.test.ts
git commit -m "$(cat <<'EOF'
refactor: extract shared judge aggregate logic into judgeAggregates.ts

Sub-project 9 part 1. The two judge writers in ingest.ts
(recordJudgeRoundsFromLanding, recordJudgeRoundsFromRoundResults)
previously each computed the same three aggregates inline:
chairedPrelims (via getInroundsChairedCount), deepestChaired, and
deepestPaneled (via outroundRankStrict + sort). Same logic, two
implementations — bug fixes had to land in both places.

New lib/calicotab/judgeAggregates.ts:
  - computeJudgeAggregates(rounds): pure function; same logic both
    writers used inline.
  - writeJudgeParticipantRole(client, tournamentId, personId,
    aggregates, mode): does the participant + 'judge' role upsert.
    mode='overwrite' (landing path, authoritative) always sets the
    three fields; mode='fillNullsOnly' (round-results path, runs
    after landing) reads the existing row and only writes where
    existing is null.

Both writers now call computeJudgeAggregates + writeJudgeParticipantRole.
~50 LOC of duplicated aggregate code deleted from ingest.ts; ~150 LOC
of new helper + tests added. Net codebase delta ≈ +100 LOC — the value
is single-source-of-truth + dedicated test coverage, not byte savings.

6 new tests in tests/calicotab.judgeAggregates.test.ts pin the
contract (empty rounds, prelim-only, deepest-of-N picking, chair vs
panellist separation, trainee groups with panellist, unrankable
stages skipped). Existing 478 parseNav tests pass unchanged.

No PARSER_VERSION bump — refactor is behavior-preserving.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Define phase function types (commit 2, part 1 of 7)

**Files:**
- Modify: `lib/calicotab/ingest.ts` — add type aliases near the existing `IngestResult` declaration (around L38-48)

The orchestrator decomposition extracts 8 phase functions. Each takes a typed input and returns a typed output. Defining the types first means each subsequent extraction has a place to attach.

- [ ] **Step 1: Add the inter-phase type definitions**

Find the existing `IngestResult` type at `lib/calicotab/ingest.ts:38-48`:

```typescript
type IngestResult = {
  tournamentId: bigint;
  fingerprint: string;
  cached: boolean;
  claimedPersonId: bigint | null;
  claimedPersonName: string | null;
  parserVersion: string;
  totalTeams: number | null;
  totalParticipants: number | null;
  warnings: string[];
};
```

Add the following type aliases immediately after `IngestResult`'s closing brace (so they're co-located with the orchestrator's return type and visible to all phase functions defined below the orchestrator):

```typescript
// ─── Phase function types ─────────────────────────────────────────────────
//
// The orchestrator (ingestPrivateUrl) is a thin wrapper that threads typed
// state through ~8 phase functions. Each phase takes a typed input
// (usually a previous phase's output plus the original userId/options)
// and returns its own typed output. The fetchWarnings buffer is the one
// exception: it's a mutable string[] that crosses phase boundaries by
// reference (every .push() site is preserved unchanged). Keeping it
// mutable is the lower-risk choice — fully functional warnings threading
// would require touching every existing push site.

type LoadedState = {
  normalized: string;
  urlVariants: string[];
  parsedUrl: URL;
  tournamentSlug: string | null;
  fetchSession: FetchSession;
  landingDoc: Awaited<ReturnType<typeof fetchHtmlWithProvenance>>;
  landingHtml: string;
  snapshot: ReturnType<typeof parsePrivateUrlPage>;
  fetchWarnings: string[]; // mutable buffer — accumulates across phases 1-3
  landingWarnings: string[];
  privateUrlSentAt: Date | null;
  tournamentFingerprint: string;
  existing: Awaited<ReturnType<typeof prisma.tournament.findUnique>>;
  parseStart: number;
  year: number | null;
};

type CacheCheckResult =
  | { kind: 'cache-hit'; result: IngestResult }
  | { kind: 'miss' };

type FetchedTabs = {
  teamRows: ReturnType<typeof parseTeamTab>;
  speakerRows: ReturnType<typeof parseSpeakerTab>;
  mergedParticipantRows: ReturnType<typeof parseParticipantsList>;
  rounds: ReturnType<typeof parseRoundResults>[];
  breakRows: ReturnType<typeof parseBreakPage>;
  tournamentName: string;
  totalParticipants: number | null;
  totalTeams: number | null;
  prelimRoundCount: number | null;
  format: ReturnType<typeof inferTournamentFormat>;
  teamBreakRankByTeam: Map<string, number>;
  fetchLevelFailures: string[];
};

type RegressionGuardResult =
  | { kind: 'regression-blocked'; result: IngestResult }
  | { kind: 'proceed' };

type PersonContext = {
  personIdByNormalized: Map<string, bigint>;
  lookupPersonId: (name: string) => bigint | null;
};

type TxResult = {
  tournamentId: bigint;
  speakerRoundScoreCreates: Prisma.SpeakerRoundScoreCreateManyInput[];
  speakerParticipantIds: bigint[];
};
```

(`PersonContext` doesn't expose `personMatchIndex` since `lookupPersonId` is the closure that captures it — passing the closure is sufficient for downstream phases that need lookup; no phase outside `preCommitPeopleAndBuildIndex` needs the index directly.)

- [ ] **Step 2: Verify typecheck stays clean**

```bash
npm run typecheck
```

Expected: clean. The new types reference existing imports (`FetchSession`, `prisma`, `Prisma`, parse functions, `inferTournamentFormat`) — all already in scope.

If `inferTournamentFormat` is referenced in `FetchedTabs` before its declaration (because `inferTournamentFormat` lives at L874 — below the orchestrator), TypeScript forward-reference rules allow this for `typeof` expressions referencing function declarations. No reordering needed.

- [ ] **Step 3: Run the full test suite to confirm no behavior change**

```bash
npm test
```

Expected: 484 passing — type-only additions don't change runtime.

Do NOT commit yet. Tasks 5-10 extract the phase functions; the commit comes at the end (Task 11).

---

## Task 5: Extract phase 1 (`loadLandingAndFingerprint`) (commit 2, part 2 of 7)

**Files:**
- Modify: `lib/calicotab/ingest.ts` — move lines 55-113 of the orchestrator into a new private function below the orchestrator; replace those lines with a call to the new function.

The original code spans the URL setup, FetchSession creation, landing fetch, snapshot parse, fingerprint resolution, and existing-tournament lookup. Throws on landing HTTP failure.

- [ ] **Step 1: Add the new phase function after the orchestrator's closing brace**

The orchestrator ends at `lib/calicotab/ingest.ts:860`. Immediately after the closing `}` of `ingestPrivateUrl`, add a section header comment and the new function:

```typescript
// ─── Phase functions for ingestPrivateUrl ─────────────────────────────────
// See spec at docs/superpowers/specs/2026-05-23-ingest-pipeline-decomposition-design.md.
// Each phase function is private (not exported) and takes typed input from
// the orchestrator. The orchestrator threads typed state through these
// phases; data flow is explicit rather than via a shared mutable context.

async function loadLandingAndFingerprint(
  url: string,
  userId: string,
): Promise<LoadedState> {
  const normalized = normalizePrivateUrl(url);
  const urlVariants = privateUrlVariants(url);
  const parsedUrl = new URL(normalized);
  const tournamentSlug = parsedUrl.pathname.split('/').filter(Boolean)[0] ?? null;
  const discovered = await prisma.discoveredUrl.findFirst({
    where: { userId, url: { in: urlVariants } },
    orderBy: { messageDate: 'asc' },
    select: { messageDate: true },
  });
  const privateUrlSentAt = discovered?.messageDate ?? null;

  // Per-ingest fetch session — bundles cookie jar + per-host throttle so
  // Cloudflare clearance cookies set on the landing page replay on the
  // subsequent tab fetches, without leaking state to other concurrent users.
  const fetchSession = new FetchSession();

  // Landing page fetch — with provenance so every parse has a stable source.
  const landingResult = await fetchHtmlWithProvenance(normalized, { session: fetchSession });
  if (!landingResult.ok) {
    // Surface the HTTP failure as the job's error so it shows up on the
    // dashboard and in ParserRun history. `bodyPreview` gives the operator
    // a hint when the upstream serves an HTML error page (e.g. Cloudflare).
    throw new Error(
      `fetch landing ${normalized} → HTTP ${landingResult.status}: ${landingResult.bodyPreview
        .replace(/\s+/g, ' ')
        .slice(0, 180)}`,
    );
  }
  const landingDoc = landingResult;
  const landingHtml = landingDoc.html;
  // Collected across the whole ingest and attached to the landing ParserRun.
  const fetchWarnings: string[] = [];

  const parseStart = Date.now();
  const snapshot = parsePrivateUrlPage(landingHtml, normalized);
  const landingWarnings = collectRegistrationWarnings(snapshot, { privateUrlSentAt });

  const explicitYear = extractYearFromName(snapshot.tournamentName);
  const year = inferTournamentYear(snapshot.tournamentName, privateUrlSentAt);
  const inferredFingerprint = computeFingerprint({
    host: parsedUrl.host,
    tournamentSlug,
    tournamentName: snapshot.tournamentName,
    year,
  });
  const legacyFingerprint =
    year != null && explicitYear == null
      ? computeFingerprint({
          host: parsedUrl.host,
          tournamentSlug,
          tournamentName: snapshot.tournamentName,
          year: null,
        })
      : null;
  let existing = await prisma.tournament.findUnique({ where: { fingerprint: inferredFingerprint } });
  if (!existing && legacyFingerprint && legacyFingerprint !== inferredFingerprint) {
    existing = await prisma.tournament.findUnique({ where: { fingerprint: legacyFingerprint } });
  }
  const tournamentFingerprint = existing?.fingerprint ?? inferredFingerprint;

  return {
    normalized,
    urlVariants,
    parsedUrl,
    tournamentSlug,
    fetchSession,
    landingDoc,
    landingHtml,
    snapshot,
    fetchWarnings,
    landingWarnings,
    privateUrlSentAt,
    tournamentFingerprint,
    existing,
    parseStart,
    year,
  };
}
```

- [ ] **Step 2: Replace the corresponding lines in the orchestrator with a call**

In `ingestPrivateUrl`, delete the entire block from `const normalized = normalizePrivateUrl(url);` (currently L55) through (and including) the line that sets `tournamentFingerprint` (currently L113). That's L55-113 inclusive — 59 lines.

Replace with one line:

```typescript
  const loaded = await loadLandingAndFingerprint(url, userId);
```

The downstream orchestrator code currently references the individual variables (`normalized`, `urlVariants`, `landingDoc`, `landingHtml`, `snapshot`, `fetchWarnings`, `landingWarnings`, `privateUrlSentAt`, `tournamentFingerprint`, `existing`, `parseStart`, `year`, `parsedUrl`, `tournamentSlug`, `fetchSession`). For now, **destructure all of them from `loaded` immediately after the call** so the rest of the orchestrator continues to compile unchanged:

```typescript
  const loaded = await loadLandingAndFingerprint(url, userId);
  const {
    normalized,
    urlVariants,
    parsedUrl,
    tournamentSlug,
    fetchSession,
    landingDoc,
    landingHtml,
    snapshot,
    fetchWarnings,
    landingWarnings,
    privateUrlSentAt,
    tournamentFingerprint,
    existing,
    parseStart,
    year,
  } = loaded;
```

(Subsequent phase extractions will progressively remove these destructured variables as more downstream code moves into its own phase function. After Task 10, only `loaded` will remain — the destructuring is purely a transitional scaffold during extraction.)

- [ ] **Step 3: Run the full test suite + typecheck**

```bash
npm test
npm run typecheck
```

Expected: 484 passing, typecheck clean. Behavior is identical — the only change is that the code now calls a function instead of executing those statements inline.

If the test suite fails: most likely cause is that the destructured `existing` variable type lost its narrowing. The phase function returns `existing: Tournament | null`; the orchestrator's subsequent code may have assumed `existing` was just `Tournament`. Check downstream `existing!` non-null assertions and `existing.foo` accesses; either re-narrow with a guard or fix the type.

---

## Task 6: Extract phase 2 (`checkCacheFreshness`) (commit 2, part 3 of 7)

**Files:**
- Modify: `lib/calicotab/ingest.ts` — extract the cache-fresh-path block (currently L114-181 of the orchestrator after Task 5's edits) into a new phase function.

- [ ] **Step 1: Add the new phase function below `loadLandingAndFingerprint`**

```typescript
async function checkCacheFreshness(
  loaded: LoadedState,
  userId: string,
  options: { force?: boolean },
): Promise<CacheCheckResult> {
  const { landingDoc, landingHtml, snapshot, existing, urlVariants, tournamentFingerprint, parseStart, landingWarnings } = loaded;
  if (!existing || options.force) return { kind: 'miss' };

  const ageMs = Date.now() - existing.scrapedAt.getTime();
  const fresh = ageMs < FRESH_WINDOW_MS;
  // Reparse invalidation: if PARSER_VERSION bumped since the last successful
  // parser run for this tournament's landing page, skip the cache and re-ingest.
  const parserUpToDate = await isLatestParserRun(landingDoc.sourceDocumentId);
  // Smart cache bust: if the landing nav advertises more rounds than we
  // have stored TeamResult rows for, the tournament has progressed since
  // the last ingest — fall through to a full refresh instead of serving
  // a cached result that's missing rounds.
  let cacheStale = false;
  const navRoundCount = snapshot.navigation.resultsRounds.length;
  if (navRoundCount > 0) {
    const storedRounds = await prisma.teamResult.findMany({
      where: { tournamentId: existing.id, roundNumber: { gt: 0 } },
      select: { roundNumber: true },
      distinct: ['roundNumber'],
    });
    cacheStale = navRoundCount > storedRounds.length;
  }
  if (!fresh || !parserUpToDate || cacheStale) return { kind: 'miss' };

  await recordParserRun({
    sourceDocumentId: landingDoc.sourceDocumentId,
    parserName: 'parseNav',
    success: true,
    warnings: landingWarnings,
    durationMs: Date.now() - parseStart,
  });
  const linked = await withDeadlockRetry(() =>
    linkRegistrationPerson(existing.id, snapshot.registration.personName, userId, urlVariants),
  );
  if (linked) {
    // Per-round data is attached to the registration Person regardless of
    // claim status so it's ready when that person eventually claims.
    // Speaker registrations don't surface the empty-Debates-card
    // diagnostic — see the post-tx call site below for full rationale.
    const isLikelySpeaker = !!snapshot.registration.teamName;
    const r = await recordJudgeRoundsFromLanding(
      landingHtml,
      existing.id,
      linked.personId,
      snapshot.registration.personName,
    );
    if (r.diagnostic && !isLikelySpeaker) landingWarnings.push(r.diagnostic);
    await recordSpeakerRoundsFromLanding(
      landingHtml,
      existing.id,
      linked.personId,
      snapshot.registration.teamName,
    );
  }
  await prisma.discoveredUrl.updateMany({
    where: { userId, url: { in: urlVariants } },
    data: { tournamentId: existing.id, ingestedAt: new Date() },
  });
  return {
    kind: 'cache-hit',
    result: {
      tournamentId: existing.id,
      fingerprint: tournamentFingerprint,
      cached: true,
      claimedPersonId: linked?.claimed ? linked.personId : null,
      claimedPersonName: linked?.claimed ? (snapshot.registration.personName ?? null) : null,
      parserVersion: PARSER_VERSION,
      totalTeams: existing.totalTeams,
      totalParticipants: existing.totalParticipants,
      warnings: landingWarnings,
    },
  };
}
```

- [ ] **Step 2: Replace the corresponding orchestrator block with a call + early return**

After Task 5's edits, the orchestrator contains the cache-fresh-path `if (existing && !options.force) { ... }` block (currently the lines from `if (existing && !options.force) {` through the closing `}` of the block — formerly L114-181, now shifted up by 59 lines minus 16 of replacement = around L72-138).

Delete that entire block and replace with:

```typescript
  const cacheCheck = await checkCacheFreshness(loaded, userId, options);
  if (cacheCheck.kind === 'cache-hit') return cacheCheck.result;
```

- [ ] **Step 3: Run tests + typecheck**

```bash
npm test
npm run typecheck
```

Expected: 484 passing, typecheck clean.

---

## Task 7: Extract phase 3 (`fetchAndParseTabs`) + phase 4 (`recordPipelineParserRun`) + fetch-failure throw (commit 2, part 4 of 7)

**Files:**
- Modify: `lib/calicotab/ingest.ts` — extract the tab-fetch + tab-parse + landing-merge + derivation block (currently L183-318) into a new phase function. The `recordParserRun` call at L320-332 becomes its own phase. The fetch-failure throw at L334-346 stays in the orchestrator.

- [ ] **Step 1: Add `fetchAndParseTabs` below the previous phase**

```typescript
async function fetchAndParseTabs(loaded: LoadedState): Promise<FetchedTabs> {
  const { normalized, fetchSession, snapshot, landingHtml, fetchWarnings } = loaded;
  const nav = snapshot.navigation;

  // Build a shared fetch helper for this ingest that records failures into
  // the fetchWarnings buffer so the landing ParserRun tells the operator
  // exactly which tabs upstream refused to serve.
  const fetchTab = async (targetUrl: string, label: string): Promise<string | null> => {
    const r = await fetchHtmlWithProvenance(targetUrl, { referer: normalized, session: fetchSession });
    if (r.ok) return r.html;
    const hint =
      r.status === 403 && !process.env.SCRAPER_API_KEY
        ? ' (set SCRAPER_API_KEY to bypass Cloudflare blocking)'
        : '';
    fetchWarnings.push(
      `fetch: ${label} HTTP ${r.status}${hint}${r.bodyPreview ? ` — ${r.bodyPreview.replace(/\s+/g, ' ').slice(0, 80)}` : ''}`,
    );
    return null;
  };
  const fetchRound = async (
    targetUrl: string,
  ): Promise<{ url: string; html: string } | null> => {
    const r = await fetchRoundWithProvenance(targetUrl, { referer: normalized, session: fetchSession });
    if (r.ok) return { url: r.url, html: r.html };
    fetchWarnings.push(`fetch: round ${targetUrl} HTTP ${r.status}`);
    return null;
  };

  const [teamHtml, speakerHtml, participantsHtml] = await Promise.all([
    nav.teamTab ? fetchTab(nav.teamTab, 'teamTab') : Promise.resolve(null),
    nav.speakerTab ? fetchTab(nav.speakerTab, 'speakerTab') : Promise.resolve(null),
    nav.participants ? fetchTab(nav.participants, 'participants') : Promise.resolve(null),
  ]);
  // Round results: prefer the by-debate view so each row is one debate and
  // adjudicators are scoped to their own debate (sidesteps double-counting
  // that the by-team pivot can introduce).
  const roundHtmls = await Promise.all(nav.resultsRounds.map((u) => fetchRound(u)));
  const breakHtmls = await Promise.all(
    nav.breakTabs.map(async (u) => {
      const html = await fetchTab(u, 'break');
      return html ? { url: u, html } : null;
    }),
  );

  const teamRows = teamHtml ? parseTeamTab(teamHtml) : [];
  if (teamRows.length === 0 && teamHtml) {
    fetchWarnings.push(`parse: teamTab → 0 rows — ${diagnoseVueData(teamHtml, ['team'])}`);
  }

  const speakerRows = speakerHtml ? parseSpeakerTab(speakerHtml) : [];
  if (speakerRows.length === 0 && speakerHtml) {
    fetchWarnings.push(`parse: speakerTab → 0 rows — ${diagnoseVueData(speakerHtml, ['name', 'speaker'])}`);
  }

  const participantRows = participantsHtml ? parseParticipantsList(participantsHtml) : [];
  if (participantRows.length === 0 && participantsHtml) {
    fetchWarnings.push(`parse: participants → 0 rows — ${diagnoseVueData(participantsHtml, ['name'])}`);
  }

  // Private URL landing pages can include a registration card whose role label
  // (e.g. "Independent adjudicator") is the only reliable signal for some
  // tournaments. Merge those rows in so role classification doesn't depend
  // solely on /participants table availability/shape.
  const landingParticipantRows = parseParticipantsList(landingHtml);
  const participantByName = new Map<string, (typeof participantRows)[number]>();
  for (const r of participantRows) participantByName.set(normalizePersonName(r.name), r);
  for (const r of landingParticipantRows) {
    const key = normalizePersonName(r.name);
    const existing = participantByName.get(key);
    if (!existing) {
      participantByName.set(key, r);
      continue;
    }
    // Prefer adjudicator classification from landing cards over weaker
    // speaker defaults from table heuristics.
    if (existing.role !== 'adjudicator' && r.role === 'adjudicator') {
      existing.role = 'adjudicator';
      existing.judgeTag = r.judgeTag;
    }
    if (!existing.institution && r.institution) existing.institution = r.institution;
  }
  const mergedParticipantRows = [...participantByName.values()];

  const rounds = roundHtmls
    .filter((x): x is { url: string; html: string } => !!x)
    .map(({ url: u, html }) => {
      // Pass the landing-page nav's link text for this URL — it's the
      // authoritative round label ("Quarterfinals" not "SIDO 2026") and
      // protects classifyRoundLabel / outroundRankStrict from a generic
      // page heading.
      const navLabel = nav.resultsRoundLabels?.[u];
      const r = parseRoundResults(html, u, navLabel);
      if (r.teamResults.length === 0) {
        fetchWarnings.push(`parse: round ${u} → 0 results — ${diagnoseVueData(html, ['team'])}`);
      }
      return r;
    });
  const breakRows = breakHtmls
    .filter((x): x is { url: string; html: string } => !!x)
    .flatMap(({ url: u, html }) => parseBreakPage(html, u));
  const tournamentName = snapshot.tournamentName ?? loaded.tournamentSlug ?? 'Unknown tournament';
  const totalParticipants = mergedParticipantRows.length || speakerRows.length || null;
  const totalTeams = teamRows.length || null;

  // Authoritative prelim round count: how many of the parsed rounds turned
  // out to be in-rounds (not outround). Stored on Tournament so the CV
  // builder can use it as the speaker-average divisor when the speaker tab
  // gives us only totals (common on AP installs that strip per-round
  // columns from the public speaker tab).
  //
  // Two-tier source:
  //   1. Parsed rounds — the count of rounds we actually fetched + parsed
  //      and classified as non-outround. Most accurate signal because the
  //      classification used the page heading + URL pattern, not the URL
  //      list alone.
  //   2. Nav-list fallback — when parsing failed or fetched zero rounds
  //      (e.g., Tabbycat 403'd every per-round results URL), fall back to
  //      the count of round-results URLs the landing page linked to.
  //      This over-counts by the number of outrounds (typically 1–3) on
  //      tournaments where both prelims and outrounds appear in the nav
  //      but no fetch succeeded.
  const parsedPrelimCount = rounds.filter(
    (r) => !r.isOutround && r.roundNumber != null,
  ).length;
  const prelimRoundCount =
    parsedPrelimCount > 0 ? parsedPrelimCount : nav.resultsRounds.length || null;
  const format = inferTournamentFormat({
    tournamentName,
    teamRows,
    speakerRows,
    registrationSpeakers: snapshot.registration.speakers,
  });
  // Multi-category breaks (BP-style: Open + ESL + EFL): one team can appear
  // in more than one break tab. Pick by category priority (Open > ESL >
  // EFL > other) so a team that broke Open keeps the Open rank — see
  // lib/calicotab/breakCategoryResolve.ts for the priority table + tests.
  const { rankByTeam: teamBreakRankByTeam } = resolveTeamBreaks(breakRows);

  const fetchLevelFailures = fetchWarnings.filter((w) => w.startsWith('fetch:'));

  return {
    teamRows,
    speakerRows,
    mergedParticipantRows,
    rounds,
    breakRows,
    tournamentName,
    totalParticipants,
    totalTeams,
    prelimRoundCount,
    format,
    teamBreakRankByTeam,
    fetchLevelFailures,
  };
}
```

- [ ] **Step 2: Add `recordPipelineParserRun` below it**

```typescript
async function recordPipelineParserRun(
  loaded: LoadedState,
  fetched: FetchedTabs,
): Promise<void> {
  await recordParserRun({
    sourceDocumentId: loaded.landingDoc.sourceDocumentId,
    parserName: 'parseNav',
    success:
      (!!loaded.snapshot.tournamentName ||
        loaded.snapshot.navigation.resultsRounds.length > 0) &&
      fetched.fetchLevelFailures.length === 0,
    warnings: [...loaded.landingWarnings, ...loaded.fetchWarnings],
    durationMs: Date.now() - loaded.parseStart,
  });
}
```

- [ ] **Step 3: Replace the orchestrator block with calls**

After Task 6's edits, the orchestrator has the tab-fetch + parse block followed by the `recordParserRun` call and the fetch-failure throw. Delete all of that (the lines starting at `// Fetch and parse tabs in parallel` through the closing `}` of the fetch-failure throw) and replace with:

```typescript
  const fetched = await fetchAndParseTabs(loaded);
  await recordPipelineParserRun(loaded, fetched);

  // Partial ingest is worse than no ingest: if any tab fetch failed (HTTP
  // 403, timeout) we'd be about to commit a tournament with missing speaker
  // / team / round data, then mark its DiscoveredUrl as ingested — which
  // hides the failure forever. Abort instead so the queue retries the job
  // (drain/cron handlers reschedule on throw, up to MAX_ATTEMPTS=3). The
  // ParserRun above already recorded the failure for /cv/verify.
  if (fetched.fetchLevelFailures.length > 0) {
    throw new Error(
      `Aborting ingest: ${fetched.fetchLevelFailures.length} tab fetch(es) failed — ` +
        fetched.fetchLevelFailures.map((w) => w.slice(0, 120)).join('; '),
    );
  }
```

Also update the orchestrator's `const { ... } = loaded;` destructure block (from Task 5) — most of those identifiers (`fetchSession`, `landingHtml`, `snapshot.navigation`, etc.) are no longer used by the orchestrator directly. Keep only the ones still referenced downstream: `existing`, `tournamentFingerprint`, `snapshot`, `landingHtml`, `urlVariants`, `fetchWarnings`. Audit by deleting the destructure entirely and letting typecheck flag what's actually still needed.

- [ ] **Step 4: Run tests + typecheck**

```bash
npm test
npm run typecheck
```

Expected: 484 passing, typecheck clean.

---

## Task 8: Extract phase 5 (`checkRegressionGuard`) + phase 6 (`preCommitPeopleAndBuildIndex`) (commit 2, part 5 of 7)

**Files:**
- Modify: `lib/calicotab/ingest.ts` — extract two more phases.

- [ ] **Step 1: Add `checkRegressionGuard` below `recordPipelineParserRun`**

```typescript
async function checkRegressionGuard(
  loaded: LoadedState,
  fetched: FetchedTabs,
  userId: string,
  options: { force?: boolean },
): Promise<RegressionGuardResult> {
  const { existing, snapshot, tournamentFingerprint, urlVariants, fetchWarnings } = loaded;
  if (!existing || options.force) return { kind: 'proceed' };

  const oldTeams = existing.totalTeams ?? 0;
  const oldParticipants = existing.totalParticipants ?? 0;
  const newTeams = fetched.totalTeams ?? 0;
  const newParticipants = fetched.totalParticipants ?? 0;
  const teamsDropped = oldTeams > 5 && newTeams < oldTeams * 0.5;
  const participantsDropped = oldParticipants > 5 && newParticipants < oldParticipants * 0.5;

  // Speaker-rank regression: count old participants with a known rank vs
  // how many of this parse's speakerRows actually carry a rank.
  const oldRankCount = await prisma.tournamentParticipant.count({
    where: { tournamentId: existing.id, speakerRankOpen: { not: null } },
  });
  const newRankCount = fetched.speakerRows.filter((r) => r.rank != null).length;
  const ranksDropped = oldRankCount > 5 && newRankCount < oldRankCount * 0.5;

  if (!teamsDropped && !participantsDropped && !ranksDropped) {
    return { kind: 'proceed' };
  }

  const msg =
    `Regression guard: re-ingest would drop data — ` +
    `teams ${oldTeams}→${newTeams}, participants ${oldParticipants}→${newParticipants}, ` +
    `ranks ${oldRankCount}→${newRankCount}`;
  Sentry.captureMessage(msg, { level: 'warning', tags: { fingerprint: tournamentFingerprint } });
  const linked = await withDeadlockRetry(() =>
    linkRegistrationPerson(existing.id, snapshot.registration.personName, userId, urlVariants),
  );
  await prisma.discoveredUrl.updateMany({
    where: { userId, url: { in: urlVariants } },
    data: { tournamentId: existing.id, ingestedAt: new Date() },
  });
  return {
    kind: 'regression-blocked',
    result: {
      tournamentId: existing.id,
      fingerprint: tournamentFingerprint,
      cached: true,
      claimedPersonId: linked?.claimed ? linked.personId : null,
      claimedPersonName: linked?.claimed ? (snapshot.registration.personName ?? null) : null,
      parserVersion: PARSER_VERSION,
      totalTeams: existing.totalTeams,
      totalParticipants: existing.totalParticipants,
      warnings: [...fetchWarnings, 'regression-guard: overwrite blocked'],
    },
  };
}
```

- [ ] **Step 2: Add `preCommitPeopleAndBuildIndex` below `checkRegressionGuard`**

```typescript
async function preCommitPeopleAndBuildIndex(
  loaded: LoadedState,
  fetched: FetchedTabs,
): Promise<PersonContext> {
  const allPersonNames = new Set<string>();
  for (const sp of fetched.speakerRows) allPersonNames.add(sp.speakerName);
  for (const p of fetched.mergedParticipantRows) {
    if (p.role === 'adjudicator') allPersonNames.add(p.name);
  }
  for (const round of fetched.rounds) {
    for (const j of round.judgeAssignments) allPersonNames.add(j.personName);
  }
  // Pre-commit the URL owner's registration name even when no other table
  // surfaces it. Tabbycat lets the URL owner redact their own name from the
  // public speaker tab — their row stays in the table with a coded /
  // anonymous label, so the speaker upsert below can't match them by name.
  // Adding the registration name here means the team-anchored fallback
  // further down has an actual Person row to attribute the redacted row to.
  if (loaded.snapshot.registration.personName) {
    allPersonNames.add(loaded.snapshot.registration.personName);
  }
  const personIdByNormalized = await preCommitPersons(allPersonNames);
  // Pre-build the fuzzy-match index once so the speaker / participant /
  // round-results loops below can fall back from exact-name lookup to
  // substring + token-subset matching without per-row rebuilding.
  const personMatchIndex = buildPersonIndex(personIdByNormalized);
  const lookupPersonId = (name: string): bigint | null =>
    findPersonId(name, personIdByNormalized, personMatchIndex);

  return { personIdByNormalized, lookupPersonId };
}
```

- [ ] **Step 3: Replace the corresponding orchestrator blocks**

In the orchestrator, find the regression-guard `if (existing && !options.force) { ... }` block (after Task 7's edits). Delete it and replace with:

```typescript
  const guarded = await checkRegressionGuard(loaded, fetched, userId, options);
  if (guarded.kind === 'regression-blocked') return guarded.result;
```

Then find the pre-commit-persons block (the `const allPersonNames = new Set<string>()` block through the `lookupPersonId` closure). Delete it and replace with:

```typescript
  const persons = await preCommitPeopleAndBuildIndex(loaded, fetched);
  const { lookupPersonId } = persons;
```

- [ ] **Step 4: Tests + typecheck**

```bash
npm test
npm run typecheck
```

Expected: 484 passing, typecheck clean.

---

## Task 9: Extract phase 7 (`writeIngestTransaction`) (commit 2, part 6 of 7)

**Files:**
- Modify: `lib/calicotab/ingest.ts` — the biggest phase: extract the `prisma.$transaction(async (tx) => { … }, { maxWait, timeout })` block (currently ~360 LOC).

- [ ] **Step 1: Add `writeIngestTransaction` below `preCommitPeopleAndBuildIndex`**

Define the function signature and copy the entire current transaction body verbatim into it. The transaction body uses `loaded.*`, `fetched.*`, and `lookupPersonId`; reference them through the parameter.

```typescript
async function writeIngestTransaction(
  loaded: LoadedState,
  fetched: FetchedTabs,
  persons: PersonContext,
): Promise<TxResult> {
  const {
    normalized,
    tournamentFingerprint,
    snapshot,
    existing,
    fetchWarnings,
    year,
  } = loaded;
  const {
    teamRows,
    speakerRows,
    mergedParticipantRows,
    rounds,
    breakRows,
    tournamentName,
    totalParticipants,
    totalTeams,
    prelimRoundCount,
    format,
    teamBreakRankByTeam,
  } = fetched;
  const { lookupPersonId } = persons;

  return prisma.$transaction(
    async (tx) => {
      // [VERBATIM COPY of the current transaction body — L432-755 of
      // ingest.ts. Every Prisma call, every loop, every comment stays
      // exactly as-is. The only edit you make below is references to
      // closure-captured variables that no longer exist in this scope —
      // every such reference should resolve via the destructured locals
      // above.]
    },
    { maxWait: 10000, timeout: 45000 },
  );
}
```

For the actual body: copy the contents of the existing `prisma.$transaction(async (tx) => { … }, { … })` call's callback verbatim, paying attention to:

- `tx.$executeRaw\`SELECT pg_advisory_xact_lock(${fingerprintLockKey(tournamentFingerprint)})\`` — `tournamentFingerprint` is destructured above. Works unchanged.
- `tx.tournament.upsert({ where: { fingerprint: tournamentFingerprint }, update: { name: tournamentName, format, year, ... } })` — all destructured. Works unchanged.
- The references to `options` (`if (options.force || (existing && fetchWarnings.length === 0))`) — `options` is a parameter of `ingestPrivateUrl`, not destructured into `loaded`. Add `options` to the phase function signature:

  ```typescript
  async function writeIngestTransaction(
    loaded: LoadedState,
    fetched: FetchedTabs,
    persons: PersonContext,
    options: { force?: boolean },
  ): Promise<TxResult>
  ```

- All other captured variables (`speakerRows`, `teamRows`, `rounds`, `mergedParticipantRows`, `breakRows`, `teamBreakRankByTeam`, `lookupPersonId`, `snapshot`, etc.) are now destructured locals. The body needs no other edits.

The function returns `{ tournamentId: t.id, speakerRoundScoreCreates, speakerParticipantIds }` — same return shape as the existing `txResult`.

- [ ] **Step 2: Wrap the call site in `withDeadlockRetry`**

The current orchestrator wraps the transaction in `withDeadlockRetry` (look for the `await withDeadlockRetry(() => prisma.$transaction(...))` pattern at L432 — though it may actually be a direct call. Check the current code.)

Looking at the current `ingest.ts:432`:

```typescript
const txResult = await prisma.$transaction(async (tx) => { … }, { maxWait: 10000, timeout: 45000 });
```

The transaction is NOT currently wrapped in `withDeadlockRetry`. Preserve this — the phase function call also goes unwrapped.

In the orchestrator, replace the entire transaction block with:

```typescript
  const txResult = await writeIngestTransaction(loaded, fetched, persons, options);
  const tournamentId = txResult.tournamentId;
```

- [ ] **Step 3: Tests + typecheck**

```bash
npm test
npm run typecheck
```

Expected: 484 passing, typecheck clean.

This is the highest-risk extraction because of the volume of code moved. If a test fails, the most likely cause is a variable name that doesn't exist in the new scope — TypeScript catches these at compile time. If typecheck passes but a test fails at runtime, the most likely cause is a subtle behavior difference from the destructuring (e.g., `loaded.snapshot.registration` accessed via stale destructured `snapshot` instead of fresh `loaded.snapshot`). Verify the destructuring doesn't miss any accesses.

---

## Task 10: Extract phase 8 (`finalizePostTransaction`) (commit 2, part 7 of 7)

**Files:**
- Modify: `lib/calicotab/ingest.ts` — extract the post-tx writes (bulk speakerRoundScore createMany, recordJudgeRoundsFromLanding/Speaker/Results, discoveredUrl update, IngestResult assembly).

- [ ] **Step 1: Add `finalizePostTransaction` below `writeIngestTransaction`**

```typescript
async function finalizePostTransaction(
  loaded: LoadedState,
  fetched: FetchedTabs,
  txResult: TxResult,
  userId: string,
): Promise<IngestResult> {
  const { snapshot, urlVariants, landingHtml, fetchWarnings, tournamentFingerprint } = loaded;
  const { rounds } = fetched;
  const { tournamentId, speakerRoundScoreCreates, speakerParticipantIds } = txResult;

  // Bulk write speaker round scores OUTSIDE the main tx — keeps the main tx
  // small enough to fit WUDC-scale tournaments under the 60s function
  // budget. Scope the deleteMany to the participant IDs we're writing for
  // so we don't touch unrelated rows; createMany with skipDuplicates is
  // idempotent on the (participantId, roundNumber, positionLabel) unique
  // constraint.
  //
  // Wrap delete + create in their own short transaction so they succeed
  // together or roll back together. The previous two-statement form left
  // a window where the delete committed but the createMany failed (e.g.
  // a transient connection drop mid-bulk-insert), which silently destroyed
  // the user's per-round scores until the next successful re-ingest.
  if (speakerParticipantIds.length > 0 || speakerRoundScoreCreates.length > 0) {
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (speakerParticipantIds.length > 0) {
      ops.push(
        prisma.speakerRoundScore.deleteMany({
          where: { tournamentParticipantId: { in: speakerParticipantIds } },
        }),
      );
    }
    if (speakerRoundScoreCreates.length > 0) {
      ops.push(
        prisma.speakerRoundScore.createMany({
          data: speakerRoundScoreCreates,
          skipDuplicates: true,
        }),
      );
    }
    await prisma.$transaction(ops);
  }

  const linked = await withDeadlockRetry(() =>
    linkRegistrationPerson(tournamentId, snapshot.registration.personName, userId, urlVariants),
  );
  if (linked) {
    // Is the URL owner registered as a speaker on this tournament? The
    // landing page's registration card sets `teamName` for speakers and
    // leaves it null for adjudicator-only registrations. When they're a
    // speaker, the Debates card legitimately has no adjudicator rounds
    // and the round-results panel search legitimately matches no judges
    // — both helpers emit diagnostics that surface as red warnings on
    // the dashboard, which read as failures even though the system is
    // working correctly. Suppress those diagnostics for speaker
    // registrations; still call recordJudgeRoundsFromLanding (which
    // PR #90 made idempotent — it preserves prior data) so a user who
    // was a JUDGE in a past ingest and is now a speaker doesn't lose
    // their old data via a different code path.
    const isLikelySpeaker = !!snapshot.registration.teamName;
    const r = await recordJudgeRoundsFromLanding(
      landingHtml,
      tournamentId,
      linked.personId,
      snapshot.registration.personName,
    );
    if (r.diagnostic && !isLikelySpeaker) fetchWarnings.push(r.diagnostic);
    await recordSpeakerRoundsFromLanding(
      landingHtml,
      tournamentId,
      linked.personId,
      snapshot.registration.teamName,
    );
    // Round-results panel search: skip entirely for speakers — they're
    // never on a panel by definition. For judges this is the fallback
    // when the Debates card is empty (tournament finished, Tabbycat
    // replaced the per-round table with a current-round-only widget).
    if (!isLikelySpeaker) {
      const fromResults = await recordJudgeRoundsFromRoundResults(
        rounds,
        tournamentId,
        linked.personId,
        snapshot.registration.personName,
      );
      if (fromResults.diagnostic) fetchWarnings.push(fromResults.diagnostic);
    }
  }

  // Mark the DiscoveredUrl as ingested + link to tournament (registrationPersonId set inside linkRegistrationPerson).
  await prisma.discoveredUrl.updateMany({
    where: { userId, url: { in: urlVariants } },
    data: { tournamentId, ingestedAt: new Date() },
  });

  return {
    tournamentId,
    fingerprint: tournamentFingerprint,
    cached: false,
    claimedPersonId: linked?.claimed ? linked.personId : null,
    claimedPersonName: linked?.claimed ? (snapshot.registration.personName ?? null) : null,
    parserVersion: PARSER_VERSION,
    totalTeams: fetched.totalTeams ?? null,
    totalParticipants: fetched.totalParticipants ?? null,
    warnings: fetchWarnings,
  };
}
```

- [ ] **Step 2: Replace the corresponding orchestrator block**

After Task 9's edits, the orchestrator has the bulk-write block + linked-person handling + return statement. Delete all of it (from `// Bulk write speaker round scores OUTSIDE the main tx` through the final `return { tournamentId, fingerprint: tournamentFingerprint, ... };`) and replace with:

```typescript
  return finalizePostTransaction(loaded, fetched, txResult, userId);
```

- [ ] **Step 3: Verify the orchestrator is now the ~30-line target**

```bash
sed -n '50,/^}$/p' lib/calicotab/ingest.ts | head -50
```

Expected: `ingestPrivateUrl`'s body matches roughly:

```typescript
export async function ingestPrivateUrl(
  url: string,
  userId: string,
  options: { force?: boolean } = {},
): Promise<IngestResult> {
  const loaded = await loadLandingAndFingerprint(url, userId);
  const cacheCheck = await checkCacheFreshness(loaded, userId, options);
  if (cacheCheck.kind === 'cache-hit') return cacheCheck.result;

  const fetched = await fetchAndParseTabs(loaded);
  await recordPipelineParserRun(loaded, fetched);
  if (fetched.fetchLevelFailures.length > 0) {
    throw new Error(
      `Aborting ingest: ${fetched.fetchLevelFailures.length} tab fetch(es) failed — ` +
        fetched.fetchLevelFailures.map((w) => w.slice(0, 120)).join('; '),
    );
  }

  const guarded = await checkRegressionGuard(loaded, fetched, userId, options);
  if (guarded.kind === 'regression-blocked') return guarded.result;

  const persons = await preCommitPeopleAndBuildIndex(loaded, fetched);
  const txResult = await writeIngestTransaction(loaded, fetched, persons, options);
  return finalizePostTransaction(loaded, fetched, txResult, userId);
}
```

If the orchestrator still has stray destructured locals (`const { normalized, urlVariants, ... } = loaded;`) at the top, delete them — none of the remaining orchestrator code should reference those identifiers directly.

- [ ] **Step 4: Run tests + typecheck + lint**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: **484 passing**, 4 skipped (same as after commit 1).
- `npm run lint`: 1 warning, 0 errors. The `unused-vars` warning might appear if any destructured variable in a phase function is no longer used; either remove from destructure or prefix with `_`.
- `npm run typecheck`: clean.

---

## Task 11: Final commit + verification (commit 2)

- [ ] **Step 1: Confirm the diff scope**

```bash
git diff --stat HEAD~1
```

Expected:
- `lib/calicotab/ingest.ts` — large diff (~800 lines moved into phase functions, +30 lines for type definitions, net file size roughly unchanged). The orchestrator at the top should now be ~25 lines including signature.
- No other files touched in this commit.

- [ ] **Step 2: Sanity grep — orchestrator is slim, phases are defined**

```bash
grep -n "^export async function ingestPrivateUrl\|^async function \(loadLandingAndFingerprint\|checkCacheFreshness\|fetchAndParseTabs\|recordPipelineParserRun\|checkRegressionGuard\|preCommitPeopleAndBuildIndex\|writeIngestTransaction\|finalizePostTransaction\)" lib/calicotab/ingest.ts
```

Expected: 9 matches — `ingestPrivateUrl` + 8 phase functions.

```bash
awk '/^export async function ingestPrivateUrl/,/^}$/' lib/calicotab/ingest.ts | wc -l
```

Expected: roughly **25–35 lines** including signature and closing brace.

- [ ] **Step 3: Commit 2**

```bash
git add lib/calicotab/ingest.ts
git commit -m "$(cat <<'EOF'
refactor: decompose ingestPrivateUrl into 8 typed phase functions

Sub-project 9 part 2. The 820-LOC ingestPrivateUrl orchestrator was
the single biggest readability problem in lib/calicotab/ingest.ts —
six distinct phases (landing fetch, cache check, tab fetches+parsing,
the big write transaction, post-tx writes) all interleaved in one
function.

The top-level ingestPrivateUrl is now ~25 lines reading like the
pipeline's flowchart:
  - loadLandingAndFingerprint
  - checkCacheFreshness          (may early-return cache-hit)
  - fetchAndParseTabs
  - recordPipelineParserRun
  - (throw if fetch-level failures)
  - checkRegressionGuard         (may early-return regression-blocked)
  - preCommitPeopleAndBuildIndex
  - writeIngestTransaction
  - finalizePostTransaction

Each phase is a private async function defined below the orchestrator,
with typed inputs (LoadedState, FetchedTabs, PersonContext, TxResult)
and explicit returns. Cache-hit and regression-blocked paths use
discriminated unions ({ kind: 'cache-hit' | 'miss' }, etc.) so the
early-return logic is type-checked.

No code outside ingest.ts changed. ingest.ts net size roughly the
same (~1500 LOC); the win is structural ("30-line orchestrator + 8
named phase seams" vs one 820-line blob).

The fetchWarnings buffer crosses phase boundaries by reference —
lower-risk than refactoring every .push() call site. The
writeIngestTransaction phase still owns 360 LOC and a long
prisma.$transaction body; further sub-decomposition would require
passing tx through more layers and was judged not worth the locality
loss for v1.

Behavior preservation: all 484 tests (478 prior + 6 from commit 1's
judgeAggregates tests) pass unchanged. No PARSER_VERSION bump.

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
- Two commits on the branch (judge dedup + orchestrator decomp).
- Files in the diff: `lib/calicotab/judgeAggregates.ts` (new), `lib/calicotab/ingest.ts` (large diff but net-zero LOC), `tests/calicotab.judgeAggregates.test.ts` (new).
- **484 tests passing**, 4 skipped.
- Lint: 1 warning, 0 errors.
- Typecheck: clean.

- [ ] **Step 2: Manual live smoke test (optional but recommended)**

If the env-gated live Tabbycat smoke is configured:

```bash
LIVE_SMOKE_TABBYCAT_URL=<url> npx vitest run tests/__smoke.live.test.ts
```

Real end-to-end ingest against a real tournament URL. If any of the 8 phase functions broke their data hand-off, the smoke catches it — the ingest will fail with a TypeScript-runtime mismatch or a data-shape error.

- [ ] **Step 3: Stop and ask the user about push / PR / merge**

Push and PR are user-visible / shared-state actions per the harness rules. Do not run `git push` or `gh pr create` without explicit user confirmation. Present the standard `superpowers:finishing-a-development-branch` options:

1. Merge to `main` locally (the pattern used for the prior 8 sub-projects).
2. Push the branch + open a PR.
3. Keep the branch as-is.
4. Discard.

---

## Self-review

**1. Spec coverage.** Walking through each section of `docs/superpowers/specs/2026-05-23-ingest-pipeline-decomposition-design.md`:

- ✅ "In scope" item 1 (decompose ingestPrivateUrl into 8 phase functions): Tasks 4–10, one task per logical extraction.
- ✅ "In scope" item 2 (extract judge aggregate logic into judgeAggregates.ts): Tasks 1–3.
- ✅ "In scope" item 3 (refactor recordJudgeRoundsFromLanding to use the helper): Task 2.
- ✅ "In scope" item 4 (refactor recordJudgeRoundsFromRoundResults to use the helper): Task 3.
- ✅ "In scope" item 5 (new test file for judgeAggregates): Task 1, Step 1.
- ✅ "In scope" item 6 (8 phase functions: loadLandingAndFingerprint, checkCacheFreshness, fetchAndParseTabs, recordPipelineParserRun, checkRegressionGuard, preCommitPeopleAndBuildIndex, writeIngestTransaction, finalizePostTransaction): Tasks 5, 6, 7, 7, 8, 8, 9, 10 respectively.
- ✅ "Behavior preservation" — every phase extraction preserves the existing data flow + existing return shape; mode='overwrite' / 'fillNullsOnly' captures the existing semantic difference between the two writers.
- ✅ "Out of scope" — no PARSER_VERSION bump, no roles-table-authoritative isJudge, no schema change, no new dependency, single file (ingest.ts) not split into a directory.

**2. Placeholder scan.** Searched the plan for TBD / TODO / "fill in" / "add appropriate" / "similar to". Found one intentional placeholder marker in Task 9 Step 1: the comment `[VERBATIM COPY of the current transaction body — L432-755 of ingest.ts. Every Prisma call, every loop, every comment stays exactly as-is. ...]`. This is not a plan failure — it's an instruction to the implementer that the body is mechanically copied from a known-stable source location. Verbatim reproduction of 360 LOC inside the plan would be noise.

**3. Type consistency.** Cross-checked names across tasks:
- `LoadedState`, `CacheCheckResult`, `FetchedTabs`, `RegressionGuardResult`, `PersonContext`, `TxResult` — defined in Task 4, consumed by Tasks 5–10.
- `computeJudgeAggregates`, `writeJudgeParticipantRole`, `JudgeRound`, `JudgeAggregates`, `JudgeWriteMode` — defined in Task 1 Step 3, consumed in Tasks 2, 3.
- Phase function names — `loadLandingAndFingerprint` / `checkCacheFreshness` / `fetchAndParseTabs` / `recordPipelineParserRun` / `checkRegressionGuard` / `preCommitPeopleAndBuildIndex` / `writeIngestTransaction` / `finalizePostTransaction` — match the spec exactly.

No drift.
