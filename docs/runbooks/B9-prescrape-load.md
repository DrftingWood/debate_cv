# Runbook: loading the B9 pre-scrape into production

Owner-run. Nothing here has been run against production. Design: `docs/superpowers/specs/2026-10-25-b9-prescrape-design.md`. Sizing: `docs/SIZING-2026-10-25.md`.

> **Do not run the load from a laptop.** The first production attempt (2026-10-26) failed on its first tournament with "Transaction not found". Measured from the owner's laptop, one query to Neon takes about 300 ms; ingest's write phase makes hundreds of sequential queries inside a 45 s transaction, so it can only finish when the database is a few milliseconds away. Nothing was lost (0 tournaments written, about 1 MB of provenance rows). The runner now refuses to write when the median round trip is over 120 ms, and the load runs on a GitHub Actions runner, which sits in a US datacenter near Neon. Steps 1 and 4 below are the Actions path.

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

### 1. Credentials: a GitHub secret holding the database URL only

The load needs exactly one setting, `POSTGRES_PRISMA_URL`. **Do not use `vercel env pull`:** it writes *every* production secret to disk, including the Google OAuth secret, `TOKEN_ENCRYPTION_KEY`, `AUTH_SECRET`, `CRON_SECRET` and the Anthropic key.

1. Copy the **pooled** connection string of your **default** branch (not `pre-b9-load`) from the Neon console (Connect, *Pooled connection*) or from Vercel → Storage → the database → `POSTGRES_PRISMA_URL`.
2. GitHub → this repository → **Settings → Secrets and variables → Actions → New repository secret**. Name: `PRESCRAPE_DATABASE_URL`. Value: the string. Nothing else goes in it.
3. If a local `.env.production` exists from the earlier laptop attempt, **delete it**.
4. **Delete the secret when the load is finished** (same page).

The repository is public. Secrets are not exposed to pull requests from forks, and only people with write access can run a workflow by hand, so the string is not reachable by others. It is encrypted at rest and masked in logs.

Why pooled: it is what production's ingests use, so the pre-scrape runs the same code path, and its advisory locks are transaction-scoped and safe under the pooler. The direct (non-pooling) URL is only for migrations, and nothing here migrates.

**Verified with nothing else set (2026-10-26).** The runner was run against a local throwaway Postgres with an environment holding only `POSTGRES_PRISMA_URL` and the operating system's own variables: no `TOKEN_ENCRYPTION_KEY`, no `AUTH_*`, no `SENTRY_*`, no Google or Anthropic keys. It wrote ILNU RR 2026 in full and the duplicates check came back `[]`. With no Sentry DSN set, the runner reports nothing to production Sentry; its record is the report file and the console.

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

### 4. Load stage A: from GitHub Actions

Actions → **Pre-scrape (B9)** → **Run workflow**.

**First, the smoke run** (mode `smoke`; no database, no secret, nothing written). It reads a sample of 12 tournament sites from the runner's network and fails if half or more refuse it. Datacenter addresses are sometimes blocked by sites behind Cloudflare; Vercel's are not, but a GitHub runner is a different network, so find out before committing hours. Expect `smoke ok`. If it fails, stop: the load would only produce errors, and the next option is a different host for the runner.

**Then the load** (mode `load`):

| Input | Value |
| --- | --- |
| mode | `load` |
| list | leave the default (`scripts/prescrape/stage-a-2023-2025.txt`) |
| shards | `4` |
| confirm | `LOAD` (the run refuses without it) |

- **Shards:** the list is split by *host*, so one site is only ever fetched by one job at a time and ingest's per-host politeness still holds. Four jobs run in parallel, so the load takes roughly a quarter of the 3–5 hours of a single run.
- **Each job** checks the database size before every tournament and stops cleanly at 0.85 GiB (`PRESCRAPE_MAX_DB_BYTES`). Four jobs check independently, so a few tournaments of overshoot are possible; the margin to 1 GiB covers it.
- **The runner checks the link first:** it measures the median database round trip and refuses to write if it is over 120 ms. From a runner it should read a few milliseconds.
- **Limits:** a job is capped at 6 hours by GitHub. The load is resumable: if a job hits the cap, run the workflow again; tournaments already stored and current are skipped.
- **Watching it:** each job's log shows its tournaments. When a job ends, its report (`prescrape-shard-N.json`) is attached to the run as an artifact.
- **Cost:** none on a public repository. Compute on Neon is the same total as a single run, over a shorter time.

### 5. Check after

1. **The reports** (download each shard's `prescrape-shard-N.json` artifact from the run):
   - each report's last entry must be `{"duplicates": []}`; the runner also fails the job if not;
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
5. **Delete the `PRESCRAPE_DATABASE_URL` secret** (Settings → Secrets and variables → Actions). If all is well, also delete the `pre-b9-load` branch in the console.

### 6. Stage B, only if production is ≤ 0.55 GB after stage A

The list is `scripts/prescrape/stage-b-2020-2022.txt` (217 Calicotab tournaments, built from the Tabs sheet of the Official Global Debating Spreadsheet by taking each tournament link whose slug or name carries a year from 2020 to 2022). Run step 4 with that list; tournaments already loaded are skipped.

### 7. Stage C, tournaments the first two lists missed

`scripts/prescrape/stage-c-2020-2025.txt` holds 109 Calicotab tournaments dated 2020–2025 that the Tabs sheet of the Official Global Debating Spreadsheet lists but stages A and B do not (matched on host and slug). Entries whose slug is not known are root URLs, which the runner expands into every tournament the root page links, up to 2025. Run step 4 with this list; already loaded tournaments are skipped. Some pages may not be published yet and will fail with HTTP 404, as `hufsiv2023` did. Otherwise move to Launch first, or leave stage B unloaded; those tournaments keep working through the normal ingest.

### 8. Stage D, stage E and stage F

Stages D (65), E (158) and F (316) are loaded the same way as C: run step 4 with each list, in any order.

`scripts/prescrape/stage-f-discovered.txt` holds 316 tabs: 308 found on 2026-10-28 by crawling the root pages of multi-tournament hosts (edudrift, bdc, mace, midp, wolce, sunwaydebate, dialectica, sbs, speechforces, debsocsrcc, sls, judo, lums). Each was fetched and confirmed live, and none is in stages A to E. The other 8 are tabs the owner took part in (australs2020, cttcduds2022, indiawudcfundraiser, kclopen2021, lseopen2022, popposting2021, trivium2022, yaleivfall21); the other 11 of the 19 owner-participation tabs are already in stages A to E or in F. The owner confirmed on 2026-10-28 that Neon has enough storage for all three, so they can run back to back; the runner still stops itself at `PRESCRAPE_MAX_DB_BYTES`. Stage B's 2 timeouts are listed in `retry-timeouts.txt`.

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
