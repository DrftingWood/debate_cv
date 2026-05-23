# Persist Derived Speaker Rank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the speaker-rank-by-total fallback derivation from the read path (`buildCvData.ts:262–291`) into ingest-time persistence. Adds a nullable `speakerRankOpenDerived` column on `TournamentParticipant`, populated by a single window-function `UPDATE` inside the tournament-write transaction. The migration backfills legacy rows in one shot.

**Architecture:** One schema column, one migration with embedded backfill SQL, one `tx.$executeRaw` call inside the existing speaker-write transaction in `ingest.ts`, and a 3-line simplification in `buildCvData.ts`. Single commit at the end.

**Tech Stack:** Prisma 6 (Postgres window functions), TypeScript 5.7 strict, Vitest 2 (Node env, mock-only — no integration tests against a real DB), npm canonical. Path alias `@/*` → repo root.

**Spec:** `docs/superpowers/specs/2026-05-23-persist-speaker-rank-derived-design.md`

**Spec deviation called out up front:** The spec's "In scope" item 5 calls for `tests/ingest.speakerRankDerived.test.ts` that seeds a tournament with three speakers and asserts the persisted ranks are 1/2/3. The codebase has no infrastructure for tests against a real Postgres — every existing test uses `prismaMock` from `tests/setup/api-test-utils.ts` or tests pure helpers in isolation. Spinning up a real-DB test harness is out of scope for this sub-project (and is the kind of "new test framework" CLAUDE.md tells us not to introduce). This plan substitutes:

- The read-path equivalence case in `tests/cv.test.ts` (matches existing pattern; verifies the read consumes the persisted column correctly).
- A manual verification step in post-flight (query the dev DB after migration apply, confirm derived ranks are correct on a real tournament).

The SQL itself is small, deterministic, and verifiable by reading. If integration coverage of ingest becomes valuable later, that's its own sub-project.

---

## Pre-flight: branch setup & baseline

- [ ] **Step 1: Create the feature branch**

```bash
git checkout main
git status
git checkout -b refactor/persist-speaker-rank-derived
git status
```

Expected: clean working tree on `refactor/persist-speaker-rank-derived`, only `.claude/settings.local.json` untracked.

- [ ] **Step 2: Confirm baseline is green**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: full suite passes (last green baseline was 466 tests on the previous sub-project; that count may differ now after intervening commits — record whatever number is current and call any regression).
- `npm run lint`: 0 errors (warnings tolerated, baseline is 2).
- `npm run typecheck`: clean.

If anything fails on freshly-branched `main`, stop and flag.

---

## Task 1: Schema column + migration with backfill

**Files:**
- Modify: `prisma/schema.prisma` (one line added in the `TournamentParticipant` model around L253)
- Create: `prisma/migrations/20260523120000_speaker_rank_open_derived/migration.sql`

- [ ] **Step 1: Add the column to `prisma/schema.prisma`**

Find the `TournamentParticipant` model around L245. Current shape (relevant fragment):

```prisma
model TournamentParticipant {
  id                  BigInt   @id @default(autoincrement())
  tournamentId        BigInt
  personId            BigInt
  teamName            String?
  speakerScoreTotal   Decimal?
  speakerRankOpen     Int?
  speakerRankEsl      Int?
  speakerRankEfl      Int?
  teamBreakRank       Int?
```

Insert one new field directly after `speakerRankEfl`:

```prisma
model TournamentParticipant {
  id                  BigInt   @id @default(autoincrement())
  tournamentId        BigInt
  personId            BigInt
  teamName            String?
  speakerScoreTotal   Decimal?
  speakerRankOpen     Int?
  speakerRankEsl      Int?
  speakerRankEfl      Int?
  speakerRankOpenDerived Int?
  teamBreakRank       Int?
```

Indent matches the surrounding fields (Prisma is whitespace-tolerant but the file uses consistent column-style alignment — preserve it).

- [ ] **Step 2: Create the migration directory and file**

The repo's migration timestamps are `YYYYMMDDhhmmss`. Use `20260523120000` to land cleanly after the previous migration's `20260501000000` timestamps and avoid collisions:

```bash
mkdir -p prisma/migrations/20260523120000_speaker_rank_open_derived
```

Create the file `prisma/migrations/20260523120000_speaker_rank_open_derived/migration.sql` with the following exact contents:

```sql
-- Persist the read-time speaker-rank-by-total derivation (previously
-- computed on every CV page view in buildCvData.ts:262-291) as a
-- nullable column on TournamentParticipant. Same column gets
-- recomputed per-tournament inside the ingest write transaction;
-- this migration handles existing rows in one shot.
--
-- Backfill uses ROW_NUMBER() over (tournamentId, speakerScoreTotal DESC)
-- restricted to participant rows that have a 'speaker' role and a
-- non-null speakerScoreTotal — same predicate as the deleted JS
-- block's findMany.where clause. Secondary sort by id ASC gives a
-- deterministic tiebreak (the JS loop's order on ties depended on
-- Postgres row order, which is unordered on ties).

ALTER TABLE "TournamentParticipant"
  ADD COLUMN "speakerRankOpenDerived" INTEGER;

UPDATE "TournamentParticipant" tp
SET "speakerRankOpenDerived" = sub.r
FROM (
  SELECT
    tp2.id,
    ROW_NUMBER() OVER (
      PARTITION BY tp2."tournamentId"
      ORDER BY tp2."speakerScoreTotal" DESC, tp2.id ASC
    ) AS r
  FROM "TournamentParticipant" tp2
  WHERE tp2."speakerScoreTotal" IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "ParticipantRole" pr
      WHERE pr."tournamentParticipantId" = tp2.id AND pr.role = 'speaker'
    )
) sub
WHERE tp.id = sub.id;
```

- [ ] **Step 3: Regenerate the Prisma client so TypeScript knows about the column**

```bash
npx prisma generate
```

Expected output:
```
✔ Generated Prisma Client (v6.x.x) to ./node_modules/@prisma/client in <ms>
```

No errors. After this, `TournamentParticipant` in the generated client has an optional `speakerRankOpenDerived: number | null` field.

- [ ] **Step 4: (Optional) Apply the migration locally if a dev DB is configured**

If `POSTGRES_PRISMA_URL` (or whichever local URL the engineer uses) is set in `.env.local`:

```bash
npx prisma migrate dev --skip-generate --skip-seed
```

Expected: "Applying migration `20260523120000_speaker_rank_open_derived`". If no dev DB is configured (empty `.env.local`), skip this step — the migration will apply on Vercel deploy via `scripts/migrate-if-configured.mjs`.

- [ ] **Step 5: Sanity grep**

```bash
grep -n "speakerRankOpenDerived" prisma/schema.prisma
grep -nE "speakerRankOpenDerived|ROW_NUMBER" prisma/migrations/20260523120000_speaker_rank_open_derived/migration.sql
```

Expected:
- First grep: one line in `schema.prisma` showing the new field.
- Second grep: shows the `ADD COLUMN` line, the `SET "speakerRankOpenDerived"` line, and the `ROW_NUMBER() OVER` line.

If either grep returns 0 lines, redo the relevant step.

---

## Task 2: Read-path equivalence test (TDD-style)

**Files:**
- Modify: `tests/cv.test.ts` (add one new case under a new or existing `describe` block)

This task is intentionally first in the code-modification phase so the test exists and fails before the read path is changed.

- [ ] **Step 1: Add the failing test case to `tests/cv.test.ts`**

Open `tests/cv.test.ts`. After the existing `describe('buildCvData — discoveredUrl filter (audit #7)', ...)` block (currently ends around L114), add a new describe block:

```typescript
describe('buildCvData — speakerRankOpenDerived fallback (sub-project 7)', () => {
  test('uses persisted speakerRankOpenDerived when speakerRankOpen is null', async () => {
    // Minimal fixture: one user, one claimed person, one ingested tournament
    // with one URL pointing at it, one TournamentParticipant whose parsed
    // speakerRankOpen is null but whose persisted derived rank is 7. Expect
    // the resulting CvSpeakerRow.speakerRankOpen to surface 7.
    const userId = 'user-1';
    const tournamentId = 100n;
    const personId = 200n;

    prismaMock.user.findUnique.mockResolvedValue({
      name: 'Test', email: 't@e.com', image: null,
    });
    prismaMock.discoveredUrl.findMany.mockResolvedValue([
      {
        url: 'https://example.calicotab.com/abc/private/xyz/',
        tournamentId,
        ingestedAt: new Date('2026-01-01'),
        registrationName: 'Test User',
        tournament: {
          id: tournamentId,
          name: 'Example Open',
          year: 2026,
          format: 'BP',
          totalTeams: 50,
          sourceUrlRaw: 'https://example.calicotab.com/abc/',
          prelimRoundCount: 6,
        },
      },
    ]);
    prismaMock.person.findMany.mockResolvedValue([
      { id: personId, displayName: 'Test User', normalizedName: 'test user' },
    ]);
    prismaMock.tournamentParticipant.findMany.mockResolvedValue([
      {
        tournamentId,
        personId,
        teamName: 'Team A',
        speakerScoreTotal: decimal('450.0'),
        speakerRankOpen: null,            // parser missed it
        speakerRankOpenDerived: 7,        // persisted at ingest time
        speakerRankEsl: null,
        speakerRankEfl: null,
        teamBreakRank: null,
        judgeTypeTag: null,
        chairedPrelimRounds: null,
        lastOutroundChaired: null,
        lastOutroundPaneled: null,
        wins: null,
        eliminationReached: null,
        roles: [{ role: 'speaker' }],
        speakerRoundScores: [],
      },
    ]);
    prismaMock.tournament.findMany.mockResolvedValue([
      { id: tournamentId, prelimRoundCount: 6 },
    ]);
    prismaMock.teamResult.groupBy.mockResolvedValue([]);
    prismaMock.teamResult.findMany.mockResolvedValue([]);
    prismaMock.judgeAssignment.findMany.mockResolvedValue([]);
    prismaMock.eliminationResult.findMany.mockResolvedValue([]);
    prismaMock.cvErrorReport.findMany.mockResolvedValue([]);

    const data = await buildCvData(userId);

    expect(data.speakerRows).toHaveLength(1);
    expect(data.speakerRows[0]!.speakerRankOpen).toBe(7);
  });

  test('prefers parsed speakerRankOpen over speakerRankOpenDerived when both exist', async () => {
    const userId = 'user-2';
    const tournamentId = 101n;
    const personId = 201n;

    prismaMock.user.findUnique.mockResolvedValue({
      name: 'Test', email: 't@e.com', image: null,
    });
    prismaMock.discoveredUrl.findMany.mockResolvedValue([
      {
        url: 'https://example.calicotab.com/def/private/xyz/',
        tournamentId,
        ingestedAt: new Date('2026-01-02'),
        registrationName: 'Test User',
        tournament: {
          id: tournamentId,
          name: 'Other Open',
          year: 2026,
          format: 'BP',
          totalTeams: 60,
          sourceUrlRaw: 'https://example.calicotab.com/def/',
          prelimRoundCount: 6,
        },
      },
    ]);
    prismaMock.person.findMany.mockResolvedValue([
      { id: personId, displayName: 'Test User', normalizedName: 'test user' },
    ]);
    prismaMock.tournamentParticipant.findMany.mockResolvedValue([
      {
        tournamentId,
        personId,
        teamName: 'Team B',
        speakerScoreTotal: decimal('500.0'),
        speakerRankOpen: 3,               // parsed from the tab
        speakerRankOpenDerived: 7,        // derivation differs (e.g. break category quirk)
        speakerRankEsl: null,
        speakerRankEfl: null,
        teamBreakRank: null,
        judgeTypeTag: null,
        chairedPrelimRounds: null,
        lastOutroundChaired: null,
        lastOutroundPaneled: null,
        wins: null,
        eliminationReached: null,
        roles: [{ role: 'speaker' }],
        speakerRoundScores: [],
      },
    ]);
    prismaMock.tournament.findMany.mockResolvedValue([
      { id: tournamentId, prelimRoundCount: 6 },
    ]);
    prismaMock.teamResult.groupBy.mockResolvedValue([]);
    prismaMock.teamResult.findMany.mockResolvedValue([]);
    prismaMock.judgeAssignment.findMany.mockResolvedValue([]);
    prismaMock.eliminationResult.findMany.mockResolvedValue([]);
    prismaMock.cvErrorReport.findMany.mockResolvedValue([]);

    const data = await buildCvData(userId);

    expect(data.speakerRows[0]!.speakerRankOpen).toBe(3);
  });
});
```

Note: this assumes the existing `prismaMock` is sufficient (it is — `tournamentParticipant.findMany` is already mocked in `tests/setup/api-test-utils.ts`). The `decimal` helper at the top of `cv.test.ts` (`const decimal = (value: string) => ({ toString: () => value });`) is reused. The `roles` shape and `speakerRoundScores` shape on the participant fixture match what `buildCvData` includes in its real `findMany` call.

- [ ] **Step 2: Run only the new test cases to confirm they fail**

```bash
npx vitest run tests/cv.test.ts -t "speakerRankOpenDerived fallback"
```

Expected: **2 failing tests**, both because the production code in `buildCvData.ts` either doesn't include `speakerRankOpenDerived` in its `select` (so the property is `undefined` at consumption time and `p.speakerRankOpen ?? p.speakerRankOpenDerived` short-circuits to `null`, not `7`) or the current code still references the deleted `derivedRankByTournament` map. The first test should expect `7` and receive `null` or `undefined`.

If the tests pass at this stage, something is wrong — `buildCvData` shouldn't be reading the column yet. Re-check the schema diff and `prisma generate` step.

---

## Task 3: Update `buildCvData.ts` to consume the persisted column

**Files:**
- Modify: `lib/cv/buildCvData.ts` (3 distinct changes)

- [ ] **Step 1: Add `speakerRankOpenDerived` to the `myParticipations` select**

Find the `myParticipations` query around L199–212. Current shape:

```typescript
const myParticipations = tournamentIds.length
  ? await prisma.tournamentParticipant.findMany({
      where: {
        tournamentId: { in: tournamentIds },
        person: { claimedByUserId: userId },
      },
      include: {
        roles: true,
        speakerRoundScores: {
          select: { roundNumber: true, positionLabel: true, score: true },
        },
      },
    })
  : [];
```

This uses `include` (which pulls every column on the participant by default — so `speakerRankOpenDerived` is already there once the Prisma client regenerates). No code change is strictly required here, **but** to make the intent explicit and lock it in against future schema changes that might switch to an explicit `select`, add an inline comment above the query:

```typescript
const myParticipations = tournamentIds.length
  ? await prisma.tournamentParticipant.findMany({
      where: {
        tournamentId: { in: tournamentIds },
        person: { claimedByUserId: userId },
      },
      // Pulls every column including speakerRankOpenDerived (the persisted
      // ROW_NUMBER fallback written at ingest time — see sub-project 7).
      // If this ever switches to `select`, speakerRankOpenDerived must be
      // explicitly listed or the rank read at L560 silently degrades.
      include: {
        roles: true,
        speakerRoundScores: {
          select: { roundNumber: true, positionLabel: true, score: true },
        },
      },
    })
  : [];
```

(Only the comment is new. No structural change.)

- [ ] **Step 2: Delete the read-time `derivedRankByTournament` block**

In `lib/cv/buildCvData.ts`, locate L262–291 — the entire `derivedRankByTournament` block. Current text (verify by line numbers; if drift has occurred, anchor on the leading comment "Derived speaker rank by total score —"):

```typescript
  // Derived speaker rank by total score — covers tournaments whose speaker
  // tab didn't expose a recognisable rank column, or where the cell was
  // blank. Sort all known-total speakers per tournament by descending
  // speakerScoreTotal and assign 1-based positions; same approach Tabbycat
  // itself uses to compute ranks in the first place. Used as a fallback
  // only when `speakerRankOpen` is null on the participant row.
  const derivedRankByTournament = new Map<bigint, Map<bigint, number>>();
  if (tournamentIds.length > 0) {
    const speakers = await prisma.tournamentParticipant.findMany({
      where: {
        tournamentId: { in: tournamentIds },
        speakerScoreTotal: { not: null },
        roles: { some: { role: 'speaker' } },
      },
      select: { tournamentId: true, personId: true, speakerScoreTotal: true },
      orderBy: [{ tournamentId: 'asc' }, { speakerScoreTotal: 'desc' }],
    });
    let lastTid: bigint | null = null;
    let position = 0;
    for (const sp of speakers) {
      if (sp.tournamentId !== lastTid) {
        lastTid = sp.tournamentId;
        position = 0;
      }
      position += 1;
      const inner = derivedRankByTournament.get(sp.tournamentId) ?? new Map();
      inner.set(sp.personId, position);
      derivedRankByTournament.set(sp.tournamentId, inner);
    }
  }

```

Delete all 30 lines (the comment, the `Map` declaration, the `if` block, the trailing blank line if present). The next surviving line should be the `const [teammateRows, teamResultRows, ...]` `Promise.all` that previously came right after this block.

- [ ] **Step 3: Simplify the rank read at the speaker-row construction site**

Find the speaker-row construction around L541–581 (look for the `speakerRows.push({` block). Inside it, locate the `speakerRankOpen` field. Current code (around L560–563):

```typescript
      // Open rank: prefer the parser's value; fall back to a position
      // derived from speakerScoreTotal sort within the tournament. Covers
      // BP/AP tabs whose rank header doesn't match the canonical
      // "Rank/#" patterns and whose cell parses to null.
      speakerRankOpen:
        p.speakerRankOpen ??
        derivedRankByTournament.get(tid)?.get(p.personId) ??
        null,
```

Replace with:

```typescript
      // Open rank: prefer the parser's value; fall back to the ingest-time
      // ROW_NUMBER(...) over speakerScoreTotal persisted at ingest as
      // speakerRankOpenDerived. Covers BP/AP tabs whose rank header doesn't
      // match the canonical "Rank/#" patterns and whose cell parses to null.
      speakerRankOpen: p.speakerRankOpen ?? p.speakerRankOpenDerived ?? null,
```

(Comment updated, three-line expression collapsed to one. No other field in the `speakerRows.push({ ... })` block changes.)

- [ ] **Step 4: Run the cv.test.ts cases — they should now pass**

```bash
npx vitest run tests/cv.test.ts -t "speakerRankOpenDerived fallback"
```

Expected: both new tests PASS.

If `speakerRankOpen` comes back as `undefined` instead of the expected number, the most likely cause is that the participant `findMany` is using `select` somewhere (not `include`) and `speakerRankOpenDerived` is being filtered out. Re-check Step 1 of this task and trace what `select`/`include` is in effect.

- [ ] **Step 5: Run the full `tests/cv.test.ts` file**

```bash
npx vitest run tests/cv.test.ts
```

Expected: all cases PASS (the other tests in this file were unaffected — they test `buildTeamRankLookup`, `mergeSpeakerCvSignals`, and the discoveredUrl filter, none of which depend on `speakerRankOpenDerived`).

---

## Task 4: Add ingest-time derivation update

**Files:**
- Modify: `lib/calicotab/ingest.ts` (inside the speaker-write transaction, immediately after the speaker upsert loop)

- [ ] **Step 1: Locate the insertion point**

In `lib/calicotab/ingest.ts`, find the speaker upsert loop. Anchor on `speakerParticipantIds.push(participant.id);` (currently around L652) — that's inside the body of the loop that writes one `TournamentParticipant` row per speaker via `tx.tournamentParticipant.upsert`. The loop closes around L665 (just before the comment "Adjudicator ROSTER (who's in the tournament) comes from the participants list:").

Read 5 lines of context to confirm the structure before editing:

```bash
sed -n '660,675p' lib/calicotab/ingest.ts
```

Expected lines around L665: the closing `}` of the `for (const sp of ...)` loop, followed by a blank line, then the `// Adjudicator ROSTER` comment block.

- [ ] **Step 2: Insert the recompute `tx.$executeRaw` immediately after the speaker loop closes**

The insertion goes between the speaker loop's closing `}` and the adjudicator-roster comment. The current shape (illustrative):

```typescript
      speakerRoundScoreCreates.push({
        tournamentParticipantId: participant.id,
        roundNumber: rn,
        positionLabel: rs.positionLabel ?? '',
        score: rs.score as unknown as undefined,
      });
    }
  }

  // Adjudicator ROSTER (who's in the tournament) comes from the participants
```

Insert a new block between the closing `}` of the speaker loop and the adjudicator comment:

```typescript
      speakerRoundScoreCreates.push({
        tournamentParticipantId: participant.id,
        roundNumber: rn,
        positionLabel: rs.positionLabel ?? '',
        score: rs.score as unknown as undefined,
      });
    }
  }

  // Persist the derived speaker rank (ROW_NUMBER over speakerScoreTotal DESC)
  // for this tournament. Replaces the per-CV-view derivation that used to
  // live in buildCvData.ts:262-291 — see sub-project 7. Tournament-scoped
  // WHERE is critical: dropping it would recompute ranks across the entire
  // table inside this transaction. Runs after every speaker upsert in this
  // ingest is complete so the ROW_NUMBER input set is consistent. Idempotent
  // across reingest: the same input rows produce the same output ranks.
  await tx.$executeRaw`
    UPDATE "TournamentParticipant" tp
    SET "speakerRankOpenDerived" = sub.r
    FROM (
      SELECT
        tp2.id,
        ROW_NUMBER() OVER (
          PARTITION BY tp2."tournamentId"
          ORDER BY tp2."speakerScoreTotal" DESC, tp2.id ASC
        ) AS r
      FROM "TournamentParticipant" tp2
      WHERE tp2."tournamentId" = ${t.id}
        AND tp2."speakerScoreTotal" IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM "ParticipantRole" pr
          WHERE pr."tournamentParticipantId" = tp2.id AND pr.role = 'speaker'
        )
    ) sub
    WHERE tp.id = sub.id
  `;

  // Adjudicator ROSTER (who's in the tournament) comes from the participants
```

Critical: the `${t.id}` interpolation in a Prisma tagged template literal is parameterized by Prisma (not concatenated into the SQL string), so this is safe against bigint injection. If you ever refactor this to use `tx.$executeRawUnsafe`, the `${t.id}` becomes a string concat and you need explicit parameterization — don't do that.

- [ ] **Step 3: Sanity grep that the UPDATE is scoped, the import surface is unchanged, and no second copy was added**

```bash
grep -n "speakerRankOpenDerived" lib/calicotab/ingest.ts
grep -n "WHERE tp2.\"tournamentId\" = " lib/calicotab/ingest.ts
grep -nE "tx\.\\\$executeRaw|prisma\.\\\$executeRaw" lib/calicotab/ingest.ts
```

Expected:
- First grep: 1 line (the `SET "speakerRankOpenDerived"` inside the new block).
- Second grep: 1 line (the `WHERE tp2."tournamentId" = ${t.id}` inside the new block) — if you see 2, you accidentally pasted twice; if 0, the `WHERE` clause is missing and the UPDATE would rank across the whole table.
- Third grep: 1 line (the new `tx.$executeRaw`) plus whatever pre-existing `$executeRaw` calls exist. If ingest.ts had no `$executeRaw` before, expect exactly 1.

- [ ] **Step 4: Run the full test suite + lint + typecheck**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: every test passes, including the 2 new `cv.test.ts` cases from Task 2. The `tx.$executeRaw` in `ingest.ts` is not exercised by any test (the codebase has no ingest-end-to-end tests), and the `prismaMock.$transaction` already passes the mock through as `tx`, so any test that does invoke ingest paths would call into `prismaMock.$executeRaw` which is a `vi.fn()` no-op — no spurious failures.
- `npm run lint`: 0 errors (warnings tolerated).
- `npm run typecheck`: clean. The tagged-template `${t.id}` is typed as `bigint` and `tx.$executeRaw` accepts it.

If `typecheck` complains about `speakerRankOpenDerived` being unknown on the participant row, the most likely cause is that `prisma generate` was not re-run after the schema edit (Task 1 Step 3). Re-run it.

---

## Task 5: Single commit

- [ ] **Step 1: Inspect the staged diff before committing**

```bash
git status
git diff --stat
```

Expected files modified or added:
- `M  prisma/schema.prisma` (+1 line)
- `??  prisma/migrations/20260523120000_speaker_rank_open_derived/migration.sql` (new, ~25 lines)
- `M  lib/calicotab/ingest.ts` (+~25 lines for the new block including the comment)
- `M  lib/cv/buildCvData.ts` (-30 lines deleted block, +1 comment line, -2 +1 = -1 net in the speaker-row construction → ~−31 LOC net)
- `M  tests/cv.test.ts` (+~120 lines for the 2 new cases)

If any file you didn't intend appears (especially anything under `.claude/` or `node_modules/`), stop and investigate.

- [ ] **Step 2: Stage the intended files explicitly**

```bash
git add prisma/schema.prisma
git add prisma/migrations/20260523120000_speaker_rank_open_derived/migration.sql
git add lib/calicotab/ingest.ts
git add lib/cv/buildCvData.ts
git add tests/cv.test.ts
git status
```

Expected: 5 files staged, nothing else (other than the untracked `.claude/settings.local.json` which stays untracked).

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor: persist derived speaker rank instead of computing per CV view

The speaker-rank-by-total fallback that lived at buildCvData.ts:262-291
re-ran on every /cv page view, /u/<slug> page view, and CSV export —
once per request, with a tournament-scope SELECT and an in-memory sort
+ position assignment. The result was purely a function of participant
rows already written at ingest time, so the per-read recompute was
wasted work.

Moves the derivation to ingest. Adds a nullable
TournamentParticipant.speakerRankOpenDerived column populated by a
single window-function UPDATE inside the existing speaker-write
transaction in ingest.ts. The migration backfills legacy rows in one
shot using the same predicate and sort the deleted JS block used,
with a deterministic id-ASC tiebreak (the JS loop's tiebreak depended
on Postgres row order, which is unordered on ties).

buildCvData consumes the persisted column via a 2-step `??` chain:
  speakerRankOpen: p.speakerRankOpen ?? p.speakerRankOpenDerived ?? null

The 30-line block at L262-291 is deleted entirely. Net -31 LOC in
buildCvData.ts; +1 column on TournamentParticipant; +25 lines (mostly
SQL string) in ingest.ts.

Behavior preservation: for any user with existing data, the resulting
CvSpeakerRow.speakerRankOpen value is identical to pre-change for
every row — same predicate, same sort, same 1-based ranks. The only
observable difference is deterministic order on ties (strict
improvement, no current consumer compares ranks across reads).

Tests:
- Two new cases in tests/cv.test.ts cover (a) persisted derived rank
  surfaces through the fallback chain when parsed is null, and (b)
  parsed rank still wins when both are present.
- No ingest-side test added: the codebase has no integration-test
  infrastructure for ingest end-to-end (every existing test uses
  prismaMock or pure helpers). The SQL itself is small and verifiable
  by reading; the migration runs once on deploy and is verified by
  the post-deploy DB query in the spec.

Scope per spec was deliberately narrowed to this single deferred item;
the cheap cousins (effective prelimRoundCount, wonTournament boolean,
EUDC eliminationReachedByCategory, highlights) stay in the read path.

No PARSER_VERSION bump (derivation logic identical).
No queue lock-order change.
No new dependency.

Sub-project 7 of the session's diagnosis backlog. Deferred from the
canonical-mappings spec (2026-05-22).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: one commit lands. `git log --oneline -1` shows the new SHA + the title line.

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
- 5 files changed in the diff (`prisma/schema.prisma`, new migration SQL, `lib/calicotab/ingest.ts`, `lib/cv/buildCvData.ts`, `tests/cv.test.ts`).
- Tests: full suite passes (existing count + 2 new = baseline + 2).
- Lint: 0 errors.
- Typecheck: clean.

- [ ] **Step 2: Manual DB verification (run after merge + Vercel deploy, before declaring sub-project done)**

After the migration applies in production, connect to the Neon prod DB (or any dev DB with real ingested data) and run:

```sql
-- Pick a tournament that has speakers — any small one with > 1 speaker works.
WITH t AS (SELECT id FROM "Tournament" ORDER BY id ASC LIMIT 1)
SELECT
  tp.id,
  tp."speakerScoreTotal",
  tp."speakerRankOpen",
  tp."speakerRankOpenDerived"
FROM "TournamentParticipant" tp
JOIN t ON tp."tournamentId" = t.id
JOIN "ParticipantRole" pr ON pr."tournamentParticipantId" = tp.id AND pr.role = 'speaker'
WHERE tp."speakerScoreTotal" IS NOT NULL
ORDER BY tp."speakerScoreTotal" DESC
LIMIT 20;
```

Expected: the `speakerRankOpenDerived` column starts at 1 for the highest `speakerScoreTotal` row and increments by 1 down the result set (with no gaps, no duplicates, no nulls in the rows shown).

If `speakerRankOpenDerived` is null for rows that have a non-null `speakerScoreTotal` and a `speaker` role, the migration backfill didn't run — check `scripts/migrate-if-configured.mjs` logs in the deploy output and re-apply via `npm run prisma:migrate` if needed.

- [ ] **Step 3: Stop and ask the user about push / PR / merge**

Push and PR are user-visible / shared-state actions per the harness rules. Do not run `git push` or `gh pr create` without explicit user confirmation. Present the standard `superpowers:finishing-a-development-branch` options:

1. Merge to `main` locally (the pattern used for the prior 7 sub-projects).
2. Push the branch + open a PR.
3. Keep the branch as-is for further review.
4. Discard.

---

## Self-review

**1. Spec coverage.** Walking through each section of `docs/superpowers/specs/2026-05-23-persist-speaker-rank-derived-design.md`:

- ✅ "In scope" item 1 (schema column on `TournamentParticipant`): Task 1, Step 1.
- ✅ "In scope" item 2 (migration with backfill SQL using ROW_NUMBER window function): Task 1, Step 2.
- ✅ "In scope" item 3 (ingest-side `tx.$executeRaw` UPDATE inside the speaker-write transaction, scoped by `WHERE "tournamentId" = ${t.id}`): Task 4, Step 2.
- ✅ "In scope" item 4 (read-path simplification: select column, delete L262–291 block, simplify rank read at L560–563): Task 3, Steps 1–3.
- ⚠️ "In scope" item 5 (tests): partially covered. The `cv.test.ts` read-path cases (item 5b) are Task 2. The `tests/ingest.speakerRankDerived.test.ts` (item 5a) is explicitly **not implemented** for the reasons in the "Spec deviation called out up front" note at the top of the plan: the codebase has no integration-test infrastructure and the spec's seed-tournament test would require introducing one (out of scope per CLAUDE.md). Substituted with manual DB verification in post-flight Step 2.
- ✅ "Explicitly out of scope" — none touched. No PARSER_VERSION bump, no cousins persisted, no aggregators deleted, no new dependency, no CV-side query change beyond the now-implicit column inclusion.
- ✅ "Behavior preservation" — covered by the read-path test cases (both parsed-wins and derived-wins paths) and the matching predicate/sort in the migration SQL.
- ✅ "Verification" — covered by full suite green (Task 4 Step 4), lint, typecheck, and the manual DB query (post-flight Step 2).
- ✅ "Risk" — the WHERE-clause-required risk is mitigated by Task 4 Step 3's grep that explicitly checks for it.

**2. Placeholder scan.** Searched the plan for TBD / TODO / "fill in" / "add appropriate error handling" / "similar to Task N". No matches. Every code step has a complete, verbatim code block.

**3. Type consistency.** Cross-checked names and signatures:
- Column name `speakerRankOpenDerived` — used identically in schema, migration SQL, ingest UPDATE, `buildCvData` read, and both test cases.
- SQL shape (the inner `SELECT ... ROW_NUMBER() OVER (PARTITION BY tp2."tournamentId" ORDER BY tp2."speakerScoreTotal" DESC, tp2.id ASC) AS r FROM "TournamentParticipant" tp2 WHERE ...`) — identical between Task 1's migration backfill and Task 4's per-tournament recompute, except for the additional `WHERE tp2."tournamentId" = ${t.id}` clause in the recompute version (this is the entire point of scoping it to one tournament).
- `tx.$executeRaw` (lowercase `tx`, the transaction client passed to the speaker write block) — that's the in-scope binding in ingest.ts; verified by reading the surrounding `tx.tournamentParticipant.upsert` calls at L621 and L677.
- Test fixture shape — `roles: [{ role: 'speaker' }]`, `speakerRoundScores: []`, decimal `speakerScoreTotal` — matches what `buildCvData`'s real `findMany.include` shape produces (verified by reading lines 199–212 of `buildCvData.ts`).

No drift.
