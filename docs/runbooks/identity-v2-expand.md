# Identity option B, phase 2: rehearse the expand migration, then ship it

**What it is.** Migration `20261029120000_identity_v2_expand` adds empty columns and one table for the new identity model (design: `docs/superpowers/specs/2026-10-27-person-identity-option-b-design.md`, 3.1 and 4.1):

- `TournamentParticipant`: `listedName`, `claimedByUserId`, `claimedAt`, `claimSource`, plus an index and a foreign key to `User`;
- `Person`: `matchKey`, plus an index;
- a new table, `UserNameAlias`.

Nothing reads or writes these until phase 3. No existing column, row or constraint changes.

**Why a rehearsal.** Merging the PR to `main` applies the migration to **production** on the next deploy, because `scripts/migrate-if-configured.mjs` runs `prisma migrate deploy` on production builds. Owner decision (spec section 10, Q5): an agent prepares and tests the step, the owner rehearses it on a copy of production, then the owner merges. Do not merge the PR before step 5.

**Already done by the agent (2026-10-29), on a throwaway local Postgres 17 at port 55432:**

- every migration applied to an empty database, and `prisma migrate diff` against `schema.prisma` reported no difference;
- on a seeded database (1,302 participations, 1,285 Persons, 2 claimed), only the new migration was applied:
  - it took about 3 s, most of that CLI start;
  - the size stayed at 10 MB, and every count was unchanged;
  - the new columns were empty, and both indexes, both foreign keys and the unique key exist;
- in a rolled-back transaction, the constraints behaved as designed:
  - two users may hold one alias;
  - one user may not hold it twice;
  - deleting a user deletes their aliases and clears their participation claims, but keeps the participations;
- signed in with `next dev`, every page rendered with no console errors and no sideways scroll at 390 px: Record, Statistics, Motions, Imports, Review, Settings.

Run the steps in order. Nothing touches production until step 5.

## 1. Make a copy of production (Neon branch)

In the Neon console, open the project, then **Branches → Create branch**:

- Parent: the production branch.
- Data: **current point in time**.
- Name: `rehearsal-identity-v2-expand`.

Copy the branch's **direct** connection string (not the pooled one). A branch is copy-on-write, so it costs almost nothing, and nothing done to it touches production. The free plan allows 10 branches.

## 2. Record the starting point (on the branch)

In the Neon SQL editor, with the branch selected:

```sql
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;
SELECT
  (SELECT count(*) FROM "TournamentParticipant") AS participations,
  (SELECT count(*) FROM "Person") AS persons,
  (SELECT count(*) FROM "Person" WHERE "claimedByUserId" IS NOT NULL) AS claimed_persons;
SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 1;
```

Keep the output. The last migration should be `20261027130000_public_avatar_off_by_default`, the newest one on `main` before this PR.

## 3. Apply the migration to the branch

From a checkout of the PR branch (`preview/option-b-phase2`), in PowerShell:

```powershell
cd "C:\Users\achar\Documents\6. Projects\2. Debate CV\debate_cv"
git switch preview/option-b-phase2
git pull
npm ci
$env:POSTGRES_URL_NON_POOLING = '<the branch direct connection string>'
npx prisma migrate deploy
```

Expected:

```
Applying migration `20261029120000_identity_v2_expand`
All migrations have been successfully applied.
```

The variable set in the shell wins over `.env`, because `prisma.config.ts` loads `.env` with `dotenv`, which never overwrites a variable already set. Close the window afterwards so the string does not linger.

## 4. Check the branch

Still in that window:

```powershell
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma
```

Expected: `No difference detected.`

Then in the SQL editor, on the branch:

```sql
-- Same counts as step 2; the new columns are all empty.
SELECT count(*) AS participations, count("listedName"), count("claimedByUserId"),
       count("claimedAt"), count("claimSource")
FROM "TournamentParticipant";
SELECT count(*) AS persons, count("matchKey"),
       count("claimedByUserId") AS claimed_persons
FROM "Person";
SELECT count(*) AS aliases FROM "UserNameAlias";

-- The new indexes and foreign keys exist.
SELECT indexname FROM pg_indexes
WHERE indexname IN ('TournamentParticipant_claimedByUserId_idx', 'Person_matchKey_idx',
                    'UserNameAlias_userId_matchKey_key');
SELECT conname FROM pg_constraint
WHERE conname IN ('TournamentParticipant_claimedByUserId_fkey', 'UserNameAlias_userId_fkey');

SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;
```

Expected:

- `participations`, `persons` and `claimed_persons` equal step 2;
- every other count is `0`;
- three index names and two constraint names come back;
- `db_size` is within a few MB of step 2. The spec estimates about 3 MB now (empty indexes) and about 7 MB once the backfill fills the columns.

If anything differs, stop and send the output. Nothing has touched production.

## 5. Ship it

1. Merge the PR. The production deploy runs the migration during its build, before the new code goes live.
2. After the deploy shows **Ready** on Vercel, run step 4's SQL on **production** (read-only). Expect the same results as on the branch.
3. Open the site signed in: Record, Statistics, Imports. Nothing should look different.

## 6. Clean up

Delete the `rehearsal-identity-v2-expand` branch in the Neon console. It is not a restore point; the contract phase (6) takes its own.

## If something goes wrong

- **The migration fails on the branch:** nothing happened to production. Send the error.
- **The migration fails on the production build:** the deploy fails and the previous deployment keeps serving. Prisma marks the migration as failed. Send the build log before retrying: `prisma migrate resolve` decides between rolled back and applied.
- **Removing the columns after shipping:** they are harmless if left, because nothing reads them. If they must go, the `DROP` statements are in the header of `prisma/migrations/20261029120000_identity_v2_expand/migration.sql`; after running them, delete the migration's row from `_prisma_migrations`.

## A note on previews

Preview builds never run migrations (`migrate-if-configured.mjs` skips them). If the Preview environment points at the production database (open item in `docs/HANDOFF.md`), this PR's preview reads with the new Prisma client from a database that lacks the new columns. Any page that loads a whole `TournamentParticipant` or `Person` row would then fail on that preview only. A failing preview is itself the answer to that open item: Preview shares the production database.
