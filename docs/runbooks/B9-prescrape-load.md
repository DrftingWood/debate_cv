# Runbook: loading the B9 pre-scrape into production

Owner-run. Nothing here has been run against production. Design: `docs/superpowers/specs/2026-10-25-b9-prescrape-design.md`. Sizing: `docs/SIZING-2026-10-25.md`.

## Decision

**Stage A (2023–2025, 260 list entries) is safe to load on the free plan. Stage B (2020–2022) is conditional:** load it only if production is at or under 0.55 GB after stage A. Otherwise move to Neon Launch first.

| | Storage |
| --- | ---: |
| Production now (Neon console, 2026-10-26) | 0.16 GB |
| Stage A, measured rate × 1.5 allowance | +0.27 to 0.40 GB |
| After stage A | about 0.43–0.56 GB |
| Stage B, measured rate × 1.5 allowance | +0.20 to 0.30 GB |
| After stage B | about 0.63–0.86 GB |
| Neon Free limit | 1.00 GB per project |

**The measured rate:** 4.2 KB per participant, all-in. That covers the rows, their indexes, and the B6 snapshots of every page fetched (28 % of it). It was measured on 2026-10-26 by pre-scraping ILNU RR 2026, ASO Winter 2024 and WUDC 2024 (1,024 participants) into an empty local database.

**Stage A's size:** about 64,000 participants (55,283 dated 2023–2025 in the corpus, plus pages not yet seen and undated entries) × 4.2 KB ≈ 0.27 GB. The 1.5 allowance is for index bloat and dead tuples left by updates.

**Why stage B is conditional:** stage B on its own fits on paper. But at the top of the range it leaves under 0.15 GB for users, jobs and snapshot growth. Measuring after stage A decides it.

**Neon Free limits** ([limits and quotas](https://neon.com/faqs/free-plan-limits-and-quotas) and [history window](https://neon.com/docs/postgres/backup-restore/history-window), read 2026-10-26):

- **Storage:** 1 GB per project. Writes that would exceed it **fail** until space is freed. Nothing is billed and nothing is deleted. Users' ingests would fail too, which is why the runner stops at 0.85 GB.
- **Compute:** 100 CU-hours a month.
- **Network:** 5 GB a month of public transfer.
- **History (instant restore):** 6 hours, capped at 1 GB, no charge, and kept separate from branch storage. A 3–5 hour bulk write fills history; the cap bounds it, and it is not storage. But it means **instant restore can only reach back 6 hours.** That is why step 2 below makes a branch.

**Older figures:** an older Neon blog gave the free plan 0.5 GB. **Before loading, confirm the console shows 1 GB.** At 0.5 GB, stage A would not fit.

## Cost

- **Compute:** the runner holds the database awake for the whole load. Each tournament's write is short, and the 5 s pause between tournaments sits under the 5-minute auto-suspend. At Neon's 0.25–2 CU autoscaling that is about **1–10 CU-hours for stage A**, most likely 2–4, against 100 a month (1.77 used so far). Stage B costs about the same again.
- **Network:** the reads back are small; well under 0.1 GB of the 5 GB.
- **Money:** none on the free plan. On Launch, storage is $0.35/GB-month, so about $0.20 a month for the loaded data.

## Preconditions

1. **#131 is merged and deployed** (private URLs never shown). B9 (#129) is on `main`.
2. **The console shows the plan's storage quota as 1 GB, and current storage.** Write both down.
3. **No other bulk job is running:** no "Re-ingest all" in flight. The cron can keep running; the pre-scrape and ingest serialise on the same per-tournament claim.
4. **A recent clean checkout of `main`:** `git checkout main && git pull && npm ci`.

## Steps

### 1. Credentials: the database URL only

The runner needs exactly one setting, `POSTGRES_PRISMA_URL`. **Do not use `vercel env pull`:** it writes *every* production secret to disk, including the Google OAuth secret, `TOKEN_ENCRYPTION_KEY`, `AUTH_SECRET`, `CRON_SECRET` and the Anthropic key.

1. Copy the **pooled** connection string from the Neon console (Connection details, *Pooled connection*) or from Vercel → Storage → the database → `POSTGRES_PRISMA_URL`.
2. Create `.env.production` (already in `.gitignore`) in the checkout, with one line and nothing else:

   ```
   POSTGRES_PRISMA_URL=postgresql://…pooled string…
   ```

3. **Delete the file when the load is finished.**

Why pooled: it is what production's ingests use, so the pre-scrape runs the same code path, and its advisory locks are transaction-scoped and safe under the pooler. The direct (non-pooling) URL is only for migrations, and nothing here migrates.

**Verified with nothing else set (2026-10-26).** The runner was run against a local throwaway Postgres with an environment holding only `POSTGRES_PRISMA_URL` and the operating system's own variables: no `TOKEN_ENCRYPTION_KEY`, no `AUTH_*`, no `SENTRY_*`, no Google or Anthropic keys. It wrote ILNU RR 2026 in full (41 participants, 50 judge rows) and the duplicates check came back `[]`. No import reads another variable at load time.

**No Sentry:** with no Sentry DSN set, the runner reports nothing to production Sentry. Its record is the report file and the console.

### 2. Safety net: a branch before writing

In the Neon console → **Branches → Create branch**, from `main`, named `pre-b9-load`, at the current point. It is instant and copy-on-write: it costs almost nothing until `main` changes, and the load writes mostly new pages. Unlike instant restore, it is not limited to 6 hours. Note its time.

### 3. Measure before

Run this in the Neon console SQL editor:

```sql
SELECT pg_size_pretty(pg_database_size(current_database())) AS total;
SELECT relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 12;
SELECT count(*) AS tournaments FROM "Tournament";
```

### 4. Load stage A

```bash
npx -p dotenv-cli@11.0.0 dotenv -e .env.production -- \
  env RUN_PRESCRAPE=1 PRESCRAPE_ALLOW_REMOTE=1 \
      PRESCRAPE_LIST=scripts/prescrape/stage-a-2023-2025.txt \
      PRESCRAPE_REPORT=prescrape-stage-a.json \
      PRESCRAPE_PAUSE_MS=5000 \
      PRESCRAPE_MAX_DB_BYTES=912680550 \
  npx vitest run tests/__prescrape.live.test.ts
```

On Windows PowerShell, run it from Git Bash, or set the variables with `$env:NAME = 'value'` before `npx vitest run …`.

- **`PRESCRAPE_ALLOW_REMOTE=1`:** without it, the runner refuses any non-localhost database.
- **`PRESCRAPE_MAX_DB_BYTES=912680550`:** 0.85 GiB. Before each tournament the runner stops cleanly (`stopped-storage`) at that size.
- **`PRESCRAPE_PAUSE_MS=5000`:** the pause between tournaments, on top of ingest's own per-host throttle. A larger pause (say 30000) does not lower compute much, because the database stays awake either way. It only lengthens the load.
- **Duration:** 3–5 hours. Keep the machine awake.

**Resumable.** Stop it at any time with Ctrl+C. Re-running the same command skips every tournament already stored and current (`status: "current"`) and continues. After a `PARSER_VERSION` bump it re-scrapes only the stale ones.

### 5. Check after

1. **The report** (`prescrape-stage-a.json`):
   - its last entry must be `{"duplicates": []}`; the runner also fails the run if not;
   - count the statuses;
   - `error` entries are tournaments whose pages failed and can simply be re-run;
   - `skipped` entries are roots that link several tournaments, which is by design.
2. **The step 3 queries again:** the total should have grown by about 0.27–0.40 GB, and the tournament count by the number of `written` entries.
3. **The cache path works for real:** have one user re-scan, or ingest one private URL for a stage-A tournament. Its log should show a cache hit (`cached: true`) in about a second, with no `[ingest] tabbycat api` line for that URL.
4. **Tag the new motions.** The load adds the motions of every stage-A tournament that released them, roughly 2,000–3,000, all untagged. So the Motions pages would otherwise be full of untagged items. On `/admin/tags`:
   1. **Download untagged**;
   2. hand the file to Claude for answers;
   3. **Load answers** (they file as pending);
   4. review, then **Approve all**.
5. **Delete `.env.production`.** If all is well, also delete the `pre-b9-load` branch in the console.

### 6. Stage B, only if production is ≤ 0.55 GB after stage A

Build the stage-B list the same way as stage A, from the corpus index, for 2020–2022. It is not yet committed. Run step 4 with that list. Otherwise move to Launch first, or leave stage B unloaded; those tournaments keep working through the normal ingest.

## If storage nears 1 GB

- **The runner stops itself** at `PRESCRAPE_MAX_DB_BYTES`. Do not raise the ceiling past about 0.9 GB.
- **If the console shows over 0.9 GB for any other reason:**
  1. stop the runner;
  2. run the daily prune by calling the cron route at 03:00 UTC, or wait for it (it drops superseded snapshots);
  3. decide: move to Launch, or roll back part of the load (below).

## Rollback

- **Whole load, within 6 hours:** Neon instant restore of `main` to the time noted in step 2.
- **Whole load, any time:** restore `main` from the `pre-b9-load` branch. Console: the branch → **Restore** onto `main`, or **Reset from parent**, depending on the console version.

  **Either way, ingests done by real users after that point are lost too,** and those users would need to re-scan. Prefer the partial rollback once users have ingested since the load.

- **Partial: just the pre-scraped tournaments.** The report lists each written tournament's `tournamentId`. Remove those that no user has ingested since.

  **The delete cascades:** participants, results, scores, judge rows, motions, and **any tags approved on those motions**. So count first, then do a dry run inside a transaction:

  ```sql
  -- ids: every "written" tournamentId from prescrape-stage-a.json
  -- 1. How many would go?
  SELECT count(*) FROM "Tournament" t
  WHERE t.id = ANY('{<ids>}'::bigint[])
    AND NOT EXISTS (SELECT 1 FROM "DiscoveredUrl" d WHERE d."tournamentId" = t.id);

  -- 2. Dry run: same statement, then ROLLBACK. The count it reports must match step 1.
  BEGIN;
  DELETE FROM "Tournament" t
  WHERE t.id = ANY('{<ids>}'::bigint[])
    AND NOT EXISTS (SELECT 1 FROM "DiscoveredUrl" d WHERE d."tournamentId" = t.id);
  ROLLBACK;

  -- 3. Only when 1 and 2 agree: run the DELETE again with COMMIT instead of ROLLBACK.
  ```

  The Person rows it leaves unattached are harmless. Tournaments a user has ingested since are kept: the user's data is theirs.
