# Person identity, option B: claims bind to participations, names bind to users (design)

Status: design; **the owner answered every open question on 2026-10-29 (section 10), and section 10 overrides the text above it where they differ.** Phase 1 (normaliser v2) is built on branch `preview/option-b-phase1`; phases 2-7 are not started. No schema or migration is changed by this document.

**Override note (2026-10-29), in short:** claims now reach the CV wherever they are, including tournaments with no private URL (shown with the "Added from public tab" mark), so the attendance rule in 3.3 and the CV-build row in section 5 change; legacy Person claims are **carried over**, not dropped (4.2 step 1, V5); a `close` name **never** auto-claims (3.4); four guardrails apply to every new claim; phase 7 runs after phases 1-6 with a short-list re-ingest.
Finding: H2 in `docs/DATABASE_REVIEW-2026-10-26.md` (detail in `docs/DATABASE_AUDIT-2026-10-26.md`, H2).
Owner's choice: option B, the proper fix (per-participation claims and/or an alias table), not the normaliser-only stop-gap.

## 1. Summary

Today a person is a globally unique, accent-stripped name, and a user owns a person by owning that name. So every "Rahul Sharma" in the database is one row, the first Rahul Sharma to claim it owns it, and the second one is locked out.

The design moves ownership off the name:

1. **A claim binds to a participation**: one row of `TournamentParticipant` (one name at one tournament). New columns `claimedByUserId`, `claimedAt`, `claimSource` on that table.
2. **A user's names live in a per-user alias table**: `UserNameAlias (userId, displayName, matchKey)`, unique per user, not across users. Two users can both hold the alias "Rahul Sharma".
3. **`Person` stays as a name bucket** that ingest uses to dedupe names and that suppression hangs off. It stops carrying identity. `Person.claimedByUserId` is dual-written, then dropped.
4. **A new normaliser (`matchKey`, v2)** folds accents and keeps non-Latin letters. It is used for aliases and matching. The bucket key `Person.normalizedName` keeps v1 until a later, separate phase (section 10, phase 7).

The only cross-tournament identity the product needs is "the participations of this user". Non-users have no profile page; every place a non-user's name appears is scoped to one tournament (teammates, field, participants search). So binding claims to participations fixes the namesake problem without having to tell 52k name buckets apart.

## 2. Current behaviour, with evidence

### 2.1 The key

- `Person.normalizedName String @unique`: `prisma/schema.prisma:274`.
- `normalizePersonName`: `lib/calicotab/fingerprint.ts:73-85`. Lower-cases, turns `-_./\` into spaces, then **deletes every character outside `[a-z0-9\s]`** (line 82). "José Silva" → `jos silva`. "李明" → `""`. "Иван Petrov" → `petrov`. The test pins it: `tests/calicotab.fingerprint.test.ts:58` (`"Méline O'Brien"` → `mline obrien`).
- An empty key means the name is dropped at ingest: `preCommitPersons` skips `!norm` (`lib/calicotab/ingest.ts:1893`), `linkRegistrationPerson` returns null (`ingest.ts:2026`). So a debater whose name is entirely non-Latin has no `Person`, no `TournamentParticipant`, and cannot have a CV. `lib/calicotab/names.ts:71` and `docs/HANDOFF.md:603` already note this.
- `lib/identity/nameProximity.ts:32-35` folds accents before calling the normaliser, so the decision-A check already does better than the key. Two normalisers disagree today.
- Scale: 121,376 participants, 52,114 distinct names in the corpus (`docs/SIZING-2026-10-25.md:11`). That is an average of 2.3 participations per name; a common name is shared by different people across tournaments as a matter of course.

### 2.2 Writers (every one upserts on the name)

| Writer | Where | What it does |
| --- | --- | --- |
| Ingest pre-commit | `lib/calicotab/ingest.ts:1886-1918` | `INSERT … ON CONFLICT ("normalizedName")` for every speaker, adjudicator and judge name; returns `Map<normalizedName, personId>` |
| Ingest lookup | `ingest.ts:1199-1209`, `lib/calicotab/personMatch.ts:43-66` | exact key, then substring / token-subset fuzzy match, within this tournament's names |
| Speaker rows | `ingest.ts:1531-1553` | `TournamentParticipant.upsert` on `(tournamentId, personId)` |
| Adjudicator rows | `ingest.ts:1617-1632` | same unique |
| Participant merge | `ingest.ts:965-982` | participant-list rows merged by `normalizePersonName`, so two same-name people at one tournament are one row before the DB is touched |
| Registration link + auto-claim | `ingest.ts:2014-2068` | upserts the URL owner's Person; sets `claimedByUserId` only if the user already claims that key (`2031-2035`); `COALESCE` keeps any existing claim (`2049`) |
| Onboarding confirm | `app/api/onboarding/confirm/route.ts:48-86` | upserts and claims each ticked name by key; no attendance or proximity check; unclaims picker names not ticked (`93-116`) |
| Claim button | `app/api/persons/[id]/claim/route.ts:57-136` | attendance (Person appears at a tournament the user ingested, `57-71`), identity (`personNameMatches` against the URL's registration name or the Google name, `101-109`), then `updateMany … OR claimedByUserId null/self` (`126-136`), else 409 `already_claimed_by_other` |
| Admin release / suppress | `app/api/admin/persons/[id]/release/route.ts:45-61`, `…/suppress/route.ts` | per Person |
| Refresh delete | `ingest.ts:1977-1985` | deletes participations whose **Person** is unclaimed (and not protected by a JudgeAssignment) before re-writing |
| Stand-in prune | `lib/calicotab/provenance.ts:80-88` | deletes placeholder Persons `WHERE "claimedByUserId" IS NULL` |
| Seeds | `scripts/seed-dev-data.mjs:271-290,447-455`, `scripts/seed-from-corpus.mjs:176-248` | create Persons by key |

There is no `app/api/persons/[id]/reject` route. `PersonRejection` (`schema.prisma:306-316`) has no writer in `app/` or `lib/`; it is only cleared by admin wipe (`app/api/admin/clear-data/route.ts:77`) and cascades. It is dead weight for this design and is left alone.

### 2.3 Readers of a claim

All key on `Person.claimedByUserId`:

- CV build: `lib/cv/buildCvData.ts:349-352` (claimed Persons), `378-386` (per-tournament display name via `normalizePersonName(registrationName)` in the claimed key set), `388-393` (my participations = claimed Person ∩ tournaments the user has an ingested URL for), `570` (judge assignments by claimed personIds), `781` (drop self from teammates), `846-848` (judge broke: break-page names by key).
- Pages that gate on "has any claim": `app/(app)/dashboard/page.tsx:57-59`, `cv/page.tsx:58`, `cv/stats/page.tsx:42`, `cv/motions/page.tsx:48`, `onboarding/page.tsx:39`, `settings/account/page.tsx:37`.
- Counts across **all** tournaments, not only the user's: `dashboard/page.tsx:85-90`, `app/api/ingest/url/route.ts:70-74`.
- `app/api/cv/status/route.ts:52-56`, `app/(app)/cv/verify/page.tsx:171,287,361`.
- Participants search (claim UI): `app/api/tournaments/[id]/participants/route.ts:105-160` hides participants whose Person another user claimed.
- Account export: `app/api/account/export/route.ts:62-73` exports the claimed Person **with every participation**, including tournaments the user never attended.
- Onboarding names / identity manager: `app/api/onboarding/names/route.ts:58-89`, `components/IdentityManager.tsx:53,84`, `components/OnboardingFlow.tsx:131,188,326-356` key the picker on `normalizedName`.
- Public CV, stats, CSV/XLSX export and `cv.json` all go through `buildCvData` (`app/u/[slug]/page.tsx:87`, `cv/stats/page.tsx:47`, `app/api/cv/export/route.ts:59,76`, `app/cv.json/route.ts:24`).

### 2.4 What goes wrong today

1. **Namesake lock-out.** User B named "Rahul Sharma" cannot claim: the claim route returns 409 (`claim/route.ts:134-136`), onboarding's `COALESCE` silently keeps A's claim (`confirm/route.ts:81`), and the participants search hides the row (`participants/route.ts:109-112`).
2. **Namesake absorption.** A's claim covers B's participations. The CV hides most of it because `buildCvData` intersects with A's URL tournaments (`buildCvData.ts:356-358,388-393`), but the account export (`export/route.ts:62-73`), the dashboard's linked-tournament set (`dashboard/page.tsx:85-90`) and the post-ingest count (`ingest/url/route.ts:70-74`) include B's tournaments.
3. **Accent and script loss.** "José" and "Jose" merge (often correct, sometimes not); "Jos" and "José" merge (wrong); fully non-Latin names vanish.
4. **Same-name pair at one tournament** collapses into one participation (`ingest.ts:965-982` and the `(tournamentId, personId)` unique, `schema.prisma:349`); the second speaker's scores overwrite the first's. Option B as scoped here does not fix this; see section 10, phase 7, and open question 1.
5. **Teammate keys** are `p<personId>` (`buildCvData.ts:790`), so the "partners" view in stats merges two different teammates who share a name across tournaments. Minor; same fix as 4.

## 3. Target model

### 3.1 Tables and columns

```prisma
model TournamentParticipant {
  // … existing columns …
  /// The name exactly as this tournament listed it. Null on rows written
  /// before this column existed until their tournament is re-ingested;
  /// readers fall back to person.displayName.
  listedName       String?
  /// Who has claimed THIS participation as themselves. Identity lives here,
  /// not on Person: a name is shared by many people across tournaments, a
  /// participation belongs to exactly one.
  claimedByUserId  String?
  claimedAt        DateTime?
  /// 'registration' | 'onboarding' | 'search' | 'admin' | 'backfill'
  claimSource      String?

  claimedByUser    User? @relation("ParticipationClaims", fields: [claimedByUserId], references: [id], onDelete: SetNull)

  @@index([claimedByUserId])   // partial in SQL: WHERE "claimedByUserId" IS NOT NULL
}

/// A name the user has said is theirs. Per user, never global: two people
/// called Rahul Sharma each hold their own row. Drives auto-claim at ingest
/// and the onboarding / identity picker.
model UserNameAlias {
  id          String   @id @default(cuid())
  userId      String
  displayName String
  /// normalizePersonNameV2(displayName): accents folded, letters of every
  /// script kept.
  matchKey    String
  /// 'onboarding' | 'claim' | 'registration' | 'backfill'
  source      String
  createdAt   DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, matchKey])
}

model Person {
  // … unchanged during phases 1-5 …
  /// v2 key, non-unique. Lets readers match across accent variants while the
  /// unique bucket key stays v1.
  matchKey    String?
  @@index([matchKey])
}
```

`Person.claimedByUserId` and `Person.claimedAt` remain through the dual-write window and are dropped in the contract phase.

### 3.2 Uniqueness

| Rule | Enforced by |
| --- | --- |
| A participation has at most one claimant | single column `TournamentParticipant.claimedByUserId` |
| A user holds a name once | `@@unique([userId, matchKey])` on `UserNameAlias` |
| Any number of users may hold the same name | no global unique on `matchKey` |
| A user may hold several participations at one tournament | deliberately **not** unique on `(tournamentId, claimedByUserId)`: spelling variants ("Abhishek A." and "Abhishek Acharya") can create two rows for one person at one event, and `buildCvData.ts:855-870` already picks the richest |
| Name bucket | `Person.normalizedName @unique` (v1) kept until phase 7 |

### 3.3 What a claim binds to

A claim is the pair (user, participation). It is created when **both** hold:

1. **Attendance.** The user has a `DiscoveredUrl` with that `tournamentId` (same rule as `claim/route.ts:57-71`, now evaluated per participation, not per Person). *Superseded in part by section 10: a claim at a tournament without a private URL is allowed for the legacy carry-over and, later, for Found ("Added from public tab"), under the section 10 guardrails.*
2. **Identity.** The participation's name (`listedName ?? person.displayName`) is `match` or `close` under `nameProximity` to at least one reference: the registration name on the user's URL for that tournament, the user's Google profile name, or one of the user's aliases.

Claim paths:

| Path | Trigger | Result |
| --- | --- | --- |
| Registration (ingest) | private URL ingested; registration name is `match`/`close` to a reference | claim the URL owner's participation, `claimSource='registration'`, add alias if absent |
| Onboarding / identity manager | user ticks a name | add alias; claim every participation at the user's URL tournaments whose name matches that alias and passes the identity rule |
| Search + claim button | user picks a row | claim that one participation, `claimSource='search'`, add alias |
| Admin | release / assign | `claimSource='admin'` |

Conflicts: claiming a participation already claimed by another user returns 409 as today (first claim wins; admin release exists, `release/route.ts`). A namesake is **not** a conflict any more: B claims B's participations, which are different rows from A's.

Unclaim: unticking a name in the identity manager deletes the alias and unclaims participations with that alias's `matchKey` that were claimed via `onboarding` or `registration`. `admin` claims are left.

### 3.4 How decision A fits

Decision A (`docs/superpowers/specs/2026-10-26-paste-a-url-threat-model.md:43,50`): a name close to the user's Google profile name is acceptable proof; for Gmail-found URLs the registration name must match or be close to the profile name, else the URL is held for confirmation.

- *Superseded by section 10 (owner rule, 2026-10-27, confirmed 2026-10-29): only `match` auto-claims; a `close` name is offered for one tap and never claimed on its own.*
- That rule becomes the identity half of the claim (3.3, rule 2) and the **auto-claim gate** at ingest. It replaces today's gate, "the user already claims this exact v1 key" (`ingest.ts:2031-2035`), which a namesake could never pass and which ignored accents.
- `nameProximity` is the single predicate for identity. The claim route stops using the looser `personNameMatches` (`claim/route.ts:109`), which accepts substring hits such as "Ann Lee" for "Ann Leeson" and which `nameProximity.ts:11-13` already calls too loose for credentials. `personNameMatches` stays where it belongs, matching names **within one tournament** at ingest.
- `different` → the URL is held: no claim, shown in the identity manager flagged, as `onboarding/names/route.ts:89` already does. The user can still tick it, which records an alias with `source='onboarding'`; that is the explicit-confirmation path decision A asks for, and the alias makes later tournaments under that name auto-claim.
- Because claims are per participation, decision A's risk is bounded to the tournaments the user holds a private URL for. A close-name match can no longer grab a namesake's career, which today's per-Person claim can.

### 3.5 Normaliser v2

```ts
export function normalizePersonNameV2(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')              // fold accents: José → Jose
    .toLowerCase()
    .replace(/[-_./\\]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')    // keep letters of every script
    .replace(/\s+/g, ' ')
    .trim();
}
```

Lives next to v1 in `lib/calicotab/fingerprint.ts`. `nameProximity.fold` (`nameProximity.ts:32-35`) switches to it so there is one folding rule. v1 is unchanged until phase 7, because it is the bucket key and every ingest upserts on it.

Note: `\p{L}` keeps CJK names as unspaced strings; token rules in `nameProximity` (first/last name) then see a single token and answer `different` unless exact. That is the safe direction (held for confirmation, never a wrong auto-claim).

## 4. Migration plan for 100% of existing production data

Constraints: Neon Free, 1 GB per project ([Neon changelog 2026-10-02](https://neon.com/docs/changelog/2026-10-02), [Neon blog](https://neon.com/blog/neon-free-plan-1-gb-per-project)), 10 branches per project ([Neon free plan FAQ](https://neon.com/faqs/free-plan-limits-and-quotas)); migrations run on Vercel build via `scripts/migrate-if-configured.mjs`; no downtime. Agents do not touch production: the owner runs the backfill and verification from a runbook, after a rehearsal on a Neon branch.

### 4.1 Expand (migration, phase 2)

```sql
ALTER TABLE "TournamentParticipant"
  ADD COLUMN IF NOT EXISTS "listedName" TEXT,
  ADD COLUMN IF NOT EXISTS "claimedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "claimSource" TEXT;
ALTER TABLE "TournamentParticipant"
  ADD CONSTRAINT "TournamentParticipant_claimedByUserId_fkey"
  FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "TournamentParticipant_claimedByUserId_idx"
  ON "TournamentParticipant"("claimedByUserId") WHERE "claimedByUserId" IS NOT NULL;

ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "matchKey" TEXT;
CREATE INDEX IF NOT EXISTS "Person_matchKey_idx" ON "Person"("matchKey");

CREATE TABLE "UserNameAlias" ( … as in 3.1 … );
CREATE UNIQUE INDEX "UserNameAlias_userId_matchKey_key" ON "UserNameAlias"("userId","matchKey");
```

- Nullable `ADD COLUMN` with no default is a catalog change, no table rewrite.
- The FK is added on an all-NULL column, so validation is a scan with nothing to check (130k rows at B9 scale, well under a second). `NOT VALID` + `VALIDATE` is not needed at this size.
- Index builds are plain, not `CONCURRENTLY`: Prisma runs a migration in a transaction and `CREATE INDEX CONCURRENTLY` cannot run in one ([prisma/prisma#9154](https://github.com/prisma/prisma/issues/9154)). The `claimedByUserId` index is partial over an all-NULL column (empty); `Person_matchKey_idx` is built on an all-NULL column too. Both lock their table for milliseconds.
- `schema.prisma` gains the same fields, so `prisma migrate dev` stays clean (the lesson from `schema.prisma:298-301`).

### 4.2 Backfill (script, phase 3; not a migration)

`scripts/backfill-identity-v2.mjs`, idempotent, batched (1,000 rows per statement, one transaction per batch), `--dry-run` default, prints counts. Refuses to run without `--confirm-host=<host>` matching the URL host, so it cannot hit the wrong database by accident. Steps:

1. **Participation claims** (exactly reproduces today's CV):
   ```sql
   UPDATE "TournamentParticipant" tp
   SET "claimedByUserId" = p."claimedByUserId",
       "claimedAt"       = COALESCE(p."claimedAt", NOW()),
       "claimSource"     = 'backfill'
   FROM "Person" p
   WHERE tp."personId" = p.id
     AND p."claimedByUserId" IS NOT NULL
     AND tp."claimedByUserId" IS NULL
     AND EXISTS (SELECT 1 FROM "DiscoveredUrl" du
                 WHERE du."userId" = p."claimedByUserId"
                   AND du."tournamentId" = tp."tournamentId");
   ```
   The `EXISTS` is the attendance rule and the same intersection `buildCvData.ts:356-393` applies. Participations of a claimed Person at tournaments the user never had a URL for are **not** claimed: they are the namesake leak (2.4 item 2). The script writes their count per user to its report (open question 2).
   *Superseded by section 10: the owner chose to carry those participations over too (step 1b there), with guardrails, and to show them on the CV with the source mark.*
   Note `buildCvData` also requires `ingestedAt IS NOT NULL`; the backfill deliberately does not, so a URL mid-ingest keeps its claim when it finishes.
2. **Aliases**, one per claimed Person, plus the raw registration spellings that map to it (they keep the accents the v1 key lost):
   - from `Person` where `claimedByUserId` is set: `(userId, displayName, v2(displayName), 'backfill')`;
   - from `DiscoveredUrl` where `registrationPersonId` points to a Person claimed by the same user: `(userId, registrationName, v2(registrationName), 'backfill')`.
   `ON CONFLICT ("userId","matchKey") DO NOTHING`. Computed in JS so the script and the app share `normalizePersonNameV2`.
3. **`listedName` for the URL owner's own row**: `tp.listedName = du.registrationName` where `tp.personId = du.registrationPersonId AND tp.tournamentId = du.tournamentId`. Other rows stay NULL until their tournament is re-ingested (readers fall back to `person.displayName`; no invented data).
4. **`Person.matchKey`** for every Person, in JS batches of 1,000: `UPDATE "Person" p SET "matchKey" = v.k FROM (VALUES …) v(id,k) WHERE p.id = v.id AND p."matchKey" IS DISTINCT FROM v.k`.

Ordering: steps 1-3 touch only claimed users' rows (hundreds to low thousands); step 4 touches every Person and runs last, after the read switch is verified, because nothing reads `matchKey` before phase 5.

Concurrency: dual-write (phase 3 code) is deployed **before** the backfill runs, so claims made during the backfill land in both models; the backfill's `IS NULL` guards make re-runs safe. The ingest advisory lock is not taken; the backfill's updates are short row-level writes that do not conflict with ingest's `(tournamentId)`-scoped transactions beyond ordinary row locks.

### 4.3 Size impact

Per-row figures from `docs/SIZING-2026-10-25.md` (B9 scale: 130k participations, 56k Persons).

| Change | Steady state | Transient |
| --- | --- | --- |
| 4 nullable TP columns | NULLs cost a null-bitmap bit; `listedName` ~15-25 B where set. At full re-ingest: ~130k × ~25 B ≈ 3 MB | none until written |
| Claimed TP rows (backfill 1, 3) | negligible | dead tuples for a few thousand rows |
| Partial index on TP claims | a few KB | none |
| `Person.matchKey` + index | ~56k × (~20 B heap + ~40 B index) ≈ 3-4 MB | one full rewrite of Person: ~16 MB of dead tuples until autovacuum; batching lets it reclaim as it goes |
| `UserNameAlias` | (claimed users × names) × ~150 B: under 1 MB | none |
| **Total** | **≈ 7 MB** | **≈ 16-20 MB** |

Against 1 GB that is under 1 % steady and 2 % peak. Production's current size is still unknown (`SIZING-2026-10-25.md:34`); the runbook records `pg_database_size` before and after.

### 4.4 Contract (phase 6)

After the read switch has run for the soak period (open question 5) with the verification SQL clean:

- Stop writing `Person.claimedByUserId` / `claimedAt`.
- Migration: `ALTER TABLE "Person" DROP COLUMN "claimedByUserId", DROP COLUMN "claimedAt"` and drop `Person_claimedByUserId_idx`. Remove the `claimedPersons` relation on `User`.
- Dropping columns is a catalog change; space comes back as rows are rewritten.

### 4.5 Rollback

| Phase | Rollback |
| --- | --- |
| 2 expand | revert the PR; columns stay (harmless, unread). If needed, a down migration drops them. |
| 3 dual-write + backfill | revert code; old columns were never stopped, so the app is exactly as before. Backfilled values can stay or be cleared with `UPDATE … SET "claimedByUserId"=NULL WHERE "claimSource"='backfill'` and `DELETE FROM "UserNameAlias" WHERE source='backfill'`. |
| 4 read switch | flip `IDENTITY_V2_READS` off (env var, no deploy needed beyond a redeploy on Vercel). Writes are still dual. |
| 5 namesake claims | flag off. New namesake claims exist only in the new model; with reads back on the old model those users lose those rows from view until re-enabled, but nothing is deleted. |
| 6 contract | not reversible by flag. Before the drop, the runbook takes a Neon branch (instant, copy-on-write) as the restore point and keeps it for 14 days. To rebuild `Person.claimedByUserId` from the new model: one claimant per Person where unambiguous; ambiguous Persons (namesakes) cannot be represented in the old model, which is the point. |

### 4.6 Verification SQL

Run on the rehearsal branch and on production after each step. All read-only.

```sql
-- V1. Every legacy claim reproduced: per user, the CV tournament set under
-- the old rule equals the set under the new rule. Expect 0 rows.
WITH old AS (
  SELECT DISTINCT p."claimedByUserId" AS u, tp."tournamentId" AS t
  FROM "TournamentParticipant" tp JOIN "Person" p ON p.id = tp."personId"
  WHERE p."claimedByUserId" IS NOT NULL
    AND EXISTS (SELECT 1 FROM "DiscoveredUrl" du
                WHERE du."userId" = p."claimedByUserId" AND du."tournamentId" = tp."tournamentId")
), new AS (
  SELECT DISTINCT tp."claimedByUserId" AS u, tp."tournamentId" AS t
  FROM "TournamentParticipant" tp WHERE tp."claimedByUserId" IS NOT NULL
)
(SELECT 'missing_in_new' AS k, * FROM old EXCEPT SELECT 'missing_in_new', * FROM new)
UNION ALL
(SELECT 'extra_in_new', * FROM new EXCEPT SELECT 'extra_in_new', * FROM old);

-- V2. Every user with a claimed Person has at least one alias. Expect 0.
SELECT p."claimedByUserId" FROM "Person" p
WHERE p."claimedByUserId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "UserNameAlias" a WHERE a."userId" = p."claimedByUserId")
GROUP BY 1;

-- V3. No claim without attendance. Expect 0.
SELECT tp.id FROM "TournamentParticipant" tp
WHERE tp."claimedByUserId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "DiscoveredUrl" du
                  WHERE du."userId" = tp."claimedByUserId" AND du."tournamentId" = tp."tournamentId");

-- V4. No claim on a suppressed Person. Expect 0.
SELECT tp.id FROM "TournamentParticipant" tp JOIN "Person" p ON p.id = tp."personId"
WHERE tp."claimedByUserId" IS NOT NULL AND p."suppressedAt" IS NOT NULL;

-- V5. Leak report (not an error): legacy participations NOT carried over.
--     After section 10 this lists only the rows a guardrail refused (same-round
--     conflict, claimed by another user, suppressed), with the reason.
SELECT p."claimedByUserId" AS u, COUNT(*) AS not_carried
FROM "TournamentParticipant" tp JOIN "Person" p ON p.id = tp."personId"
WHERE p."claimedByUserId" IS NOT NULL AND tp."claimedByUserId" IS NULL
GROUP BY 1 ORDER BY 2 DESC;

-- V6. matchKey coverage after step 4. Expect 0.
SELECT COUNT(*) FROM "Person" WHERE "matchKey" IS NULL;

-- V7. Size.
SELECT pg_size_pretty(pg_database_size(current_database())),
       pg_size_pretty(pg_total_relation_size('"TournamentParticipant"')),
       pg_size_pretty(pg_total_relation_size('"Person"'));
```

## 5. Effect on each surface

| Surface | Change |
| --- | --- |
| CV build (`buildCvData.ts`) | *Superseded by section 10: drop the `tournamentId IN (user's URL tournaments)` restriction; the CV reads every participation the user has claimed, and rows without a private URL carry the "Added from public tab" mark.* `myParticipations` = `TournamentParticipant WHERE claimedByUserId = user AND tournamentId IN (user's URL tournaments)` (replaces `349-352`, `388-393`). Per-tournament display name = `listedName` of the claimed row, then alias match on `registrationName`, then `person.displayName` (replaces `378-386`). Judge assignments by `(tournamentId, personId)` pairs of claimed rows, not a global personId set (`570`). Teammates exclude claimed participation ids, not Person ids (`781`). Judge-broke matches break-page names against the user's alias `matchKey`s (`846-848`). |
| Public CV `/u/<slug>` | No change of its own; it uses `buildCvData` (`app/u/[slug]/page.tsx:87`). Same rows as the private CV, so V1 passing means the public CV is unchanged for every existing user. |
| CSV / XLSX export, `cv.json` | Same: via `buildCvData`. The append-only field registry is untouched. |
| Account export | `claimedPersons` (all participations of a name) is replaced by `claimedParticipations` and `nameAliases`; `schemaVersion` 1 → 2. This stops exporting a namesake's tournaments. The privacy page's "what we export" text needs a line. |
| Stats (`speakerStats`, `/cv/stats`) | Input is `CvData`, so no change. Teammate keys stay `p<personId>` (name bucket) until phase 7. |
| Dashboard, ingest/url, cv/status, cv/verify, "has claims" gates | `person.claimedByUserId = u` → `claimedByUserId = u` on the participation, or `EXISTS alias` for the gates. The dashboard and ingest/url counts become correct (they currently include a namesake's tournaments). |
| Participants search + claim button | Hide only participations claimed by someone else (not Persons). Claim route takes a participation id (`/api/participations/[id]/claim`; the old `/api/persons/[id]/claim` stays as a shim resolving the user's tournament participation for one release). |
| Onboarding names / identity manager | Picker rows keyed on alias `matchKey`; `isMine` = alias exists. Proximity unchanged. Confirm writes aliases and participation claims instead of upserting Persons by name. Onboarding stops creating Persons. |
| Ingest upserts | `preCommitPersons` and participant upserts unchanged in phases 2-6 (bucket key v1). New: write `listedName` on every speaker / adjudicator upsert (from `sp.speakerName` / `p.name`). `linkRegistrationPerson` claims the **participation** using decision A instead of "already claims this key". |
| Refresh delete (`ingest.ts:1977-1985`) | Must protect `tp.claimedByUserId IS NOT NULL` as well as the Person rule **before** any participation-only claim exists (phase 3), or a re-ingest deletes a namesake's claimed row. After contract, the Person rule goes. |
| Stand-in prune (`provenance.ts:80-88`, migration `20260915000000`) | Add `AND NOT EXISTS (claimed participation for this Person)` in phase 3; replace the Person rule at contract. |
| Suppression | Stays on Person, i.e. on the name: suppressing one Rahul Sharma masks every Rahul Sharma. Same as today; claims on a suppressed Person stay refused (V4). Moving suppression to participations is out of scope. |
| Admin release | Operates on participations (release one, or all of a user's under one alias). |
| Seeds | `seed-dev-data.mjs`, `seed-from-corpus.mjs` write participation claims and aliases; seed adds a namesake pair (two users, same name, different tournaments) and an accented and a non-Latin name, so each branch renders locally. |
| Account delete | `onDelete: SetNull` on the new FK, `Cascade` on aliases. Matches today's Person behaviour (`account/delete/route.ts:45-46`). |

## 6. Test plan

New and changed Vitest cases, following existing files:

1. `tests/calicotab.fingerprint.test.ts`: `normalizePersonNameV2` folds accents (`José`→`jose`, `Méline`→`meline`), keeps Cyrillic / CJK / Devanagari, keeps v1 separators, returns `''` only for punctuation-only input. v1 tests untouched.
2. `tests/identity.nameProximity.test.ts` (existing suite for `nameProximity`): unchanged answers for Latin names after `fold` moves to v2; a non-Latin exact match is `match`; non-Latin vs Latin transliteration is `different`.
3. `tests/api/participations-claim.test.ts` (new, modelled on the existing `tests/api/persons-claim.test.ts`, which keeps covering the shim): attendance required (403); identity `different` (403); namesake: user A holds alias, user B claims B's participation at another tournament (200); same participation already claimed by A (409); suppressed (403); idempotent self re-claim.
4. `tests/api/onboarding-confirm.test.ts`: writes aliases, claims only participations at the user's URL tournaments, never touches another user's claim, unclaims on untick only `onboarding`/`registration` claims; stand-ins still skipped.
5. `tests/api/onboarding-names.test.ts`: `isMine` from aliases; accent variants group under one v2 key.
6. `tests/cv.test.ts`: CV reads participation claims; two users with the same name each see only their own rows; teammate exclusion by participation id; per-tournament display name prefers `listedName`.
7. Ingest (new `tests/ingest.identityClaims.test.ts`, alongside the existing `tests/ingest.*.test.ts`): `linkRegistrationPerson` claims on `match` only (section 10; `close` is held for one tap), holds on `different`; refresh keeps participation-claimed rows of an otherwise unclaimed Person; `listedName` written.
8. `tests/api/account-export.test.ts`: schemaVersion 2, no namesake tournaments.
9. Backfill script: a pure function computing the plan from fixture rows (claims, aliases, skipped leak rows), tested without a DB; plus a local-Postgres run of the script followed by V1-V6 in `npm run seed:dev` data.
10. Deadlock: participation claims are single-row `updateMany` with a `claimedByUserId IS NULL OR = self` guard, like today. Re-run `tests/calicotab.deadlock.test.ts` in the ingest PR; no lock ordering changes.

Manual: rehearse on a Neon branch of production (owner-run), run V1-V7, browse `/cv`, `/cv/stats`, `/u/<slug>` and the export as two seeded namesake users locally with `next dev`.

## 7. Phased PR list

Each PR is small and shippable alone. Flags are env vars read in one helper (`lib/identity/flags.ts`).

| # | PR | Contents | Risk |
| --- | --- | --- | --- |
| 1 | Normaliser v2 | `normalizePersonNameV2` + tests; `nameProximity.fold` uses it. No DB. | Low. `fold` change could move a borderline proximity answer; tests pin current answers. |
| 2 | Expand migration | Columns, table, indexes (4.1); `schema.prisma`. No code reads them. | Low. Runs on Vercel build; locks are milliseconds. Check migration applies on a Neon branch first. |
| 3 | Dual-write + guards | Every claim writer also writes participation claim + alias; ingest writes `listedName`; refresh delete and stand-in prune also protect participation claims. Backfill script + runbook (`docs/runbooks/identity-v2-backfill.md`). Owner runs backfill after deploy. | Medium. Missing a writer leaves V1 drift; V1 catches it. The refresh-delete guard must ship here, not later. |
| 4 | Read switch (flag `IDENTITY_V2_READS`) | `buildCvData`, gates, counts, participants search, account export v2, verify page read the new model when on. | Medium. CV regressions are the user-visible risk; V1 = 0 is the precondition for turning the flag on, and the CV of a few real users is compared by eye before/after. |
| 5 | Namesake claims + decision A auto-claim (flag `IDENTITY_V2_CLAIMS`) | New participation claim route (old route as shim); onboarding confirm stops upserting Persons by name; `linkRegistrationPerson` auto-claims on `match`/`close`; claim route uses `nameProximity`; identity manager keyed on aliases. | Medium-high. First phase where the two models disagree by design (a namesake's claim exists only in the new model), so phase 4 must already be on. Abuse surface is bounded by attendance. |
| 6 | Contract | Stop dual-write; drop `Person.claimedByUserId`, `claimedAt`, index; remove flags. Neon branch restore point first. | Medium. Irreversible without the branch. Only after the soak with V1-V4 clean. |
| 7 | (optional, separate design) Within-tournament identity and v2 bucket key | Persist a per-tournament entry key (Tabbycat object URL from the API path, `lib/calicotab/tabbycatApi.ts:152` keys speakers by `url`; else v2 name + team) and replace `@@unique([tournamentId, personId])` with it; switch `Person.normalizedName` to v2 and drop its uniqueness; merge `José`/`Jose` buckets. Needs a `PARSER_VERSION` bump and re-ingest of every tournament. | High: touches every ingest write, invalidates all cached parses, and the B9 pre-scrape load. Not needed for the namesake fix. See open question 1. |

## 8. Risks not tied to one PR

- **Wrong-identity auto-claims under decision A.** A teammate's forwarded URL whose name is `close` to the user's (siblings, common surnames with an initial) would auto-claim. Mitigation: `close` claims show a "linked by close name" marker in the identity manager, and unticking removes them; the claim is per participation so the damage is one row.
- **Drift during dual-write.** A code path that writes only the old model. V1 runs daily (it is cheap) until contract; a non-zero result blocks phase 6.
- **Free-tier headroom.** Small (section 4.3), but the B9 load shares the same 1 GB. Run the backfill before or well after the B9 load, not during.
- **Non-Latin names appearing.** v2 is only used for aliases and matching in phases 1-6; Persons with an empty v1 key are still not created until phase 7. So non-Latin debaters still cannot get a CV before phase 7. This is the main thing option B (phases 1-6) does **not** fix.

## 9. Open questions for the owner

*All answered on 2026-10-29: see section 10.*

1. **Same-name pairs at one tournament, and non-Latin names (phase 7).** Do phase 7 now, as part of H2, or after phases 1-6 have shipped? It needs a parser version bump and a full re-ingest. **Recommended default: after.** First measure how often two people share a name at one tournament, from the corpus (not production), and do phase 7 only if it is more than a handful of tournaments or a non-Latin user asks. *(Measured since; see "Owner's rule: not in the same round" below: it is far more than a handful, and the default is revised.)*
2. **Legacy participations not carried over.** Old claims cover a namesake's tournaments the user never had a URL for (report V5). These never showed on the CV, but they appear in the account export and dashboard counts today. **Recommended default: do not carry them over**, and keep the V5 report for the owner to look over once.
3. **Auto-claim on a "close" name.** Decision A accepts a close name as proof. Should a `close` registration name auto-claim at ingest, or only `match`, with `close` shown for one-tap confirmation? **Recommended default: auto-claim on both**, as decision A says, with a visible "linked by close name" marker that the user can undo.
4. **Suppression scope.** Suppression stays on the name, so one person's erasure request also masks every namesake (and stops those namesakes claiming). **Recommended default: keep it on the name for now**, because over-masking is the safe side for erasure, and handle a namesake who complains through the admin route.
5. **Soak and who runs production steps.** **Recommended default:** the owner runs the backfill and verification SQL from the runbook, after an agent-prepared rehearsal on a Neon branch. The read switch runs for 14 days with V1-V4 clean before the contract migration, which is preceded by a Neon branch restore point kept for 14 days.

### Owner's rule: not in the same round (2026-10-27, refined)

The owner, a debater, refined the rule recorded here earlier ("nobody is both a speaker and a judge at the same tournament"). The rule is now: **a person cannot speak and judge in the same round.** Nor can they speak for two teams, or sit on two panels, in one round. Across rounds they can do different things: a speaker who did not break judges the outrounds; a replacement speaks one round; an organiser or stop-gap is entered on several "swing" teams so that every room has its 4 teams (BP) or 2 (two-team formats).

So entries that share a name key at one tournament are judged by their **rounds**, not by their roles:

- **Overlapping rounds** (two speaker entries both scored in round N; a speaker entry in round N while the name judged round N; two judges with the name on round N): **different people.**
- **Disjoint rounds:** **plausibly one person**, holding both roles (speaker, then judge) or listed on several teams.
- **No round data on one side:** unknown.

What this means for the model:

- **Claims (3.3, 3.4).** One `TournamentParticipant` carrying both a `speaker` and a `judge` `ParticipantRole` is a **valid state** (one person, disjoint rounds), so the claim paths must not treat it as a merge on its own. The conflict signal is two entries of one name whose rounds overlap.
- **Within-tournament identity (phase 7).** The identity key is **name + non-overlapping rounds**:
  - entries of one name whose rounds **overlap** get **separate participant rows**. In the API they are different Tabbycat objects with different URLs; the HTML fallback key (v2 name + team) must split them by round overlap, which needs the round data at ingest time (speaker-tab scores, the results pages' adjudicators, or the team's results rounds);
  - entries whose rounds are **disjoint** are **one participant holding both roles** (or several team entries). So the participants-list merge (`participantByName`, `ingest.ts:965-982`) must **keep both the speaker and the judge role** for such a person. Today `Map.set` keeps the last row; Tabbycat lists Adjudicators before Speakers, so the speaker row wins and the judge role is dropped. For a disjoint pair that is lost credit for one real person, a bug of its own (the checker's `judge_role_lost_one_person`), not a namesake collision;
  - where rounds are **unknown**, the recommended default is separate rows per role family. Under option B claims bind to participations, so one person split in two can claim both rows, while two people merged into one row cannot be told apart afterwards.

**Measured (open question 1 asked for this).** The offline checker is `scripts/find-identity-affected-tournaments.mjs` (runbook: `docs/runbooks/identity-affected-tournaments.md`), run on an export of 855 tournaments with a tab page:

- Before any rule: **146 of 855** affected (empty-key names and same-role collisions only). Under the earlier "never both at one tournament" rule (PR #176): **232 of 855**.
- Under the **same-round rule** (the checker now compares rounds; agent run on the 2026-10 export, to be confirmed by the owner's re-run): **158 of 855** affected (empty-key names, or a group whose entries overlap in some round), and **221 of 855** if every rounds-unknown group is also counted as two people. Of the groups: 203 overlap (139 tournaments; 75 of them speaker+judge), 37 are disjoint speaker+judge (19 tournaments; all 37 lose their judge role in the merge today), 12 are disjoint same-role (10 tournaments), 161 are unknown (87 tournaments), 18 are duplicate rows. 23 tournaments have empty-key names (44 names). Judge rounds come only from stored results pages; 9 tournaments have none.

**Revised re-ingest estimate.** The runbook (step 4) gives about 25 s per tournament on one shard:

| Route | Tournaments | Actions time |
| --- | --- | --- |
| Short list from the checker | 158 (221 with unknowns) | about 66 (92) minutes |
| Global `PARSER_VERSION` bump | all 855 in the export | about 6 hours, and every user's cached parses are invalidated |

The short list is 18-26 % of the export, not "a handful". So the recommended default for open question 1 stays **do phase 7**, with a short-list re-ingest of the checker's list instead of a global bump. Runbook step 2's caveat still applies: the v1-to-v2 re-key of `Person` is a data migration and must run first. The disjoint speaker+judge people are not on the strict list (nothing collides), but their lost judge role is fixed only by phase 7's merge change plus a re-ingest, so add those tournaments to the list once that change ships.

## 10. Owner decisions (2026-10-29, final)

These answer section 9 and override the sections above where they differ.

### 10.1 The principle

A claim that does not show on the CV has no point. Once a user holds an appearance, it shows on the CV, statistics, public CV and exports. Safety comes from guardrails on **how** a claim is made (10.4), not from keeping claims off the record.

### 10.2 Answers

| # | Question | Decision |
| --- | --- | --- |
| 1 | Phase 7 (same-name people at one tournament, non-Latin names) | **Do it, after phases 1-6 are live and soaked.** Re-key `Person` v1 to v2 first, then re-ingest only the checker's short list (158 tournaments, 221 with the rounds-unknown groups) plus the 19 where a judge role was lost (about 66-92 minutes of Actions time). **No global `PARSER_VERSION` bump.** Discovery phase 5 waits for it. |
| 2 | Legacy participations | **Carry all of them over, and show them.** Reverses the default. Guardrails and display in 10.3. |
| 3 | Auto-claim on a `close` name | **No.** Only `match` auto-claims; `close` is offered for one tap (owner rule 2026-10-27: a close name always needs the user's tick). |
| 4 | Suppression scope | **Stays on the name for now**, so namesakes are masked and blocked too. An admin can grant a namesake a per-user exception for their own appearances. Revisit after phase 7. |
| 5 | Production steps and soak | An agent rehearses each step on a Neon branch of production and writes the runbook with exact commands and expected outputs; **the owner runs** the backfill, the `IDENTITY_V2_READS` flip and the contract migration. The read switch soaks **14 days** with V1-V4 clean; a Neon restore point is taken immediately before the contract and kept 14 days. |

### 10.3 Legacy carry-over (replaces the exclusion in 4.2 step 1)

- **Step 1a:** as written in 4.2 step 1, the participations at the user's private-URL tournaments.
- **Step 1b:** every other participation of a Person the user claims, **except** where a guardrail refuses it:
  - **same-round conflict:** at that tournament, another entry with the same name key has rounds that overlap this one (two entries in one round are two people, the owner's rule above);
  - **claimed by another user:** the participation already carries another user's claim;
  - **suppressed:** the Person is suppressed (V4 still expects 0).
- Step 1b claims use `claimSource='legacy'`. Refused rows go to the V5 report with the reason.
- **Display:** a `legacy` (or later `discovery`) claim at a tournament with no private URL shows on the CV, statistics, public CV and exports with the **"Added from public tab"** source mark and a link to the public tab page (redesign decision: never the private URL).
- **Notification:** after the backfill, each affected user gets one bell notification listing what was added, each with **Remove**. Remove unclaims that participation and records it like a discovery "Not me", so it is not re-added.
- **Consequence:** `buildCvData` reads URL tournaments **plus** claimed participations (the union discovery phase 3 planned). That moves into this design's phase 4 (read switch).

### 10.4 Guardrails on every new claim (all four)

1. **Names need evidence.** A name is claimable only if it appears on one of the user's own private URLs (registration name), or is an exact or close match to one under `nameProximity`. Onboarding stops accepting free-typed names; the identity manager offers only evidenced names. This also closes the "onboarding confirm accepts any 50 names" hole.
2. **Same-round check at claim time.** A claim is refused with 409 and a plain message when the appearance's rounds overlap an appearance the user already holds at that tournament.
3. **One owner per appearance.** A second claimant sees "claimed by someone else" and can file a report (the existing `CvErrorReport`). A private-URL holder still wins a dispute over a discovery or legacy claim, and the other user is notified (discovery decision 6).
4. **Claim rate limit.** At most 50 claims a day per user across onboarding, Found and Review, server-enforced, matching the discovery decision limit.

### 10.5 Changes to the phase list (section 7)

| Phase | Change |
| --- | --- |
| 1 | Unchanged: `normalizePersonNameV2` + tests; `nameProximity.fold` uses it. |
| 3 | Backfill adds step 1b (10.3) with `claimSource='legacy'`; the V5 report lists guardrail refusals; the runbook gains the notification step. Guardrails 2-4 (same-round, one owner, rate limit) ship with dual-write in the claim writers. |
| 4 | Read switch: `buildCvData` reads the union of URL tournaments and claimed participations; the "Added from public tab" mark and Remove ship here. Account export v2 lists legacy claims with their source. |
| 5 | Auto-claim on `match` only (not `close`); guardrail 1 (names need evidence) replaces onboarding's free-typed names. |
| 7 | Confirmed (10.2 row 1), with the short-list re-ingest. |

## Sources

- [Neon changelog, 2026-10-02](https://neon.com/docs/changelog/2026-10-02) and [Neon blog: Free plan 1 GB per project](https://neon.com/blog/neon-free-plan-1-gb-per-project): Free storage is 1 GB per project.
- [Neon free plan limits FAQ](https://neon.com/faqs/free-plan-limits-and-quotas): 10 branches per project on Free (the same page still shows the old 0.5 GB storage figure).
- [prisma/prisma#9154](https://github.com/prisma/prisma/issues/9154): `CREATE INDEX CONCURRENTLY` fails inside Prisma's migration transaction; this repo is on Prisma `^6.1.0` (`package.json:22,48`), so indexes here are built plainly on small or empty columns.
