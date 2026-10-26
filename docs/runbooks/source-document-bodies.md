# Taking stored page bodies off the server

**Why.** On 2026-10-26 the `SourceDocument` table was 260 MB of a 550 MB database (47%), of which 217 MB was the gzipped HTML of fetched pages (26,764 rows; 405 from private-URL pages). Nothing in the app reads those bodies back. The owner keeps a local copy instead, so the server no longer needs them. Result: roughly 200 MB of headroom on the 1 GB free plan.

**What is kept on the server.** The row itself: `url`, `contentHash`, `contentLength`, `status`, `fetchedAt` and its `ParserRun` history. That is the provenance trail and the unchanged-page dedup. Only `bodyGzip` goes.

**What is lost, and the trade.** Re-deriving a field a future parser adds, without fetching the page again. With the local copy that stays possible from your machine. Pages from sites that no longer exist exist only in that copy, so make it before clearing.

Run the steps in order. Nothing is cleared until step 4.

## 1. Copy the bodies to this machine (read-only)

```bash
# the connection string stays in your environment; the script never prints it
export POSTGRES_URL_NON_POOLING='<the direct Neon connection string>'
node scripts/export-source-documents.mjs --out ./source-docs
```

- One `<id>.html.gz` per page plus `index.jsonl` (id, url, status, hash, length, fetch time, file).
- Pages from private URLs are skipped by default (a personal credential and a registration name, nothing public to keep). Add `--include-private` only if you really want them.
- Resumable: run it again and files already on disk are skipped.
- Expect about 215 MB on disk.

## 2. Check the copy is complete

The script ends with `scanned N | written W | already on disk A | no body B | private pages skipped P`. Then `W + A` should equal the count of non-private rows that have a body. In the Neon SQL editor:

```sql
SELECT count(*) FILTER (WHERE "bodyGzip" IS NOT NULL AND url !~* '/privateurls/') AS should_be_on_disk FROM "SourceDocument";
```

and count the files: `ls source-docs/*.html.gz | wc -l` (Git Bash). The two numbers must match. Open two or three files (`gunzip -c source-docs/<id>.html.gz | head`) to see real HTML.

## 3. Stop writing bodies

Merge and deploy the PR that makes `STORE_SOURCE_BODIES` default to off. Until then new fetches keep adding bodies. Set `STORE_SOURCE_BODIES=1` only on a development machine that should keep them.

## 4. Clear the bodies and give the space back (production write)

Only after step 2 matched.

```sql
UPDATE "SourceDocument" SET "bodyGzip" = NULL WHERE "bodyGzip" IS NOT NULL;
```

Clearing does not shrink the database by itself: Postgres only marks the space reusable. To return it to the plan's storage count, rewrite the table:

```bash
psql "$POSTGRES_URL_NON_POOLING" -c 'VACUUM FULL "SourceDocument";'
```

`VACUUM FULL` locks the table while it rewrites it, which is quick once the bodies are gone, and needs free space about the size of what remains (a few tens of MB). Run it when no ingest is running. If the Neon SQL editor refuses it (it cannot run inside a transaction), use `psql` as above.

## 5. Check

Run the table-size query from `docs/DATABASE_REVIEW-2026-10-26.md` again. `SourceDocument` should be a few tens of MB and the database about 300 to 350 MB.

## Rolling back

New fetches stop storing bodies the moment step 3 deploys; setting `STORE_SOURCE_BODIES=1` and redeploying turns them back on for new fetches. Cleared bodies are not restored on the server: they come back only by re-fetching the page, or from the local copy.
