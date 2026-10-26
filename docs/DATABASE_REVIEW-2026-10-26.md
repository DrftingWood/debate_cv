# Database review (2026-10-26)

Scope: the Prisma 6 schema and its raw SQL on Neon Postgres, reviewed against current data-storage practice. The owner asked for a review beyond duplicate data. Production is about 550 MB of the 1 GB free-plan limit after the bulk pre-scrape.

## How this was done, and what it can and cannot say

- Two Opus agents worked in parallel. One compiled a cited checklist of 71 criteria from PostgreSQL 18, Prisma, Neon, GDPR / DPDP and tooling docs. The other read the schema, every migration and the raw SQL, and wrote 26 findings. Neither touched a database.
- **Checked by hand against the code before writing this:** H1 (plaintext tokens in `Account`), H2 (`Person.normalizedName` unique, accents stripped) and H4 (scores deleted in the main transaction, re-inserted after the tournament is stamped current). The other findings are the audit agent's, each with file and line evidence, and have not been re-read one by one.
- **Nothing here is measured.** Table sizes, index usage, the share taken by stored HTML, and the server time zone are all unknown until the owner runs the read-only SQL at the end. Size figures in the audit are estimates.
- The research notes its own gaps: no authoritative source for arrays versus link tables, entity-resolution quality or naming suffixes; GDPR and DPDP points rest on secondary sources; two Prisma statements (that `///` comments create no database comment, and that `autoincrement()` emits `serial`) were not confirmed.

## Against the standards, area by area

| Area | Verdict | Why |
| --- | --- | --- |
| Keys and normalisation | Partial | Natural-key uniques exist, but a person is keyed by name alone (H2), team joins are by text (M9), and several facts are stored twice and can drift (M4). |
| Constraints | Gap | No CHECKs on scores, ranks or round numbers (L6); closed sets are free text (L7); uniques over nullable columns let duplicates through (M7); the nightly person prune cascades through participations (M5). |
| Data types | Partial | `numeric` for scores is right, but unbounded; timestamps are `timestamp without time zone` (L5); `CvErrorReport.tournamentIds` is a text array of ids with no foreign key (L9). |
| Indexing | Partial | Redundant indexes (L1), foreign keys with no index (L2), no index for the queries that read `ParserRun` (L3). Not one of these is large at today's size. |
| Large blobs and retention | Gap | Gzipped HTML in a `bytea` column, rewritten on every unchanged fetch, kept forever per URL and never measured (M1). Private pages are in it (H3). |
| Provenance and idempotent ingest | Strong, with holes | Source documents, parser runs, content hashes and upserts are what the standards ask for. Holes: the round-score write is not atomic with the "current" stamp (H4); tournament identity by host and slug is not enforced by the database (M2); motion tags can stay on a row whose text changed (M6). |
| Migrations | Partial | Two migrations share a timestamp, one applied migration is missing from the repo, and an admin route edits `_prisma_migrations` (L12). |
| Data quality | Gap | The only automated check is the post-load duplicate test. No reconciliation of totals, ballots per round or brackets. |
| Privacy and retention | Gap | OAuth tokens are plaintext in `Account` (H1); private URLs are stored in four places (M3); account deletion and suppression do not reach stored HTML (H3); notifications and sessions are never pruned (M10); `claimedAt` is wrong on the commonest claim path (M8). |
| Capacity | Partial | The pre-scrape has a storage guard, but there is no per-table size report and no alarm before the 1 GB hard stop (writes fail at the cap). |
| Naming and documentation | Partial | PascalCase tables need quoting everywhere; Prisma `///` comments do not become database comments. Low priority; renaming is not worth the churn. |

## What to fix, in order

**Phase 1: security and correctness (do first)**
1. **H1.** Stop the adapter writing `access_token`, `refresh_token` and `id_token` into `Account` (or encrypt them as `GmailToken` does), then null the existing ones once the encrypted copy is confirmed, and remove the plaintext fallback in `gmail/client.ts`. Gmail read access for every user is exposed to anyone who can read the database or a backup.
2. **H4.** Move the `parserVersion` and `scrapedAt` stamp to a final update after the score transaction succeeds, and add a cheap query (speaker rows with a total but no round scores) to the cron. Until then a crash can leave a tournament served as complete with no round scores. With PRs #143 and #144 a stored tournament is served indefinitely, so this matters more than it did.
3. **H3 and M3.** On account delete, remove `SourceDocument` rows for the user's private URLs; stop storing bodies for `/privateurls/` pages; redact the token in `IngestJob.lastError`; and, per the owner's answer B, delete stored private URLs after a successful ingest.

**Phase 2: identity and duplicates**
4. **H2.** Decide how a person is identified. Minimum stop-gap: fold accents and keep non-Latin letters in the normaliser (needs a one-off re-key). Proper fix: per-participation claims or an alias table. Namesakes are common (about 121k participants share about 52k distinct names), and this is the main blocker for a correct per-person history.
5. **M2.** Enforce one tournament per host and slug in the database (partial unique index, advisory lock on host and slug).
6. **M9.** Drive a claimed person's history from `TournamentParticipant(personId)` instead of the user's emailed URLs, so pre-scraped tournaments appear.

**Phase 3: integrity and tidying (low risk, batch together)**
7. **M5, M7, M8, M4, M6, L6, L7.** Make the nightly prune non-cascading and logged; `NULLS NOT DISTINCT` (or sentinels) on the nullable uniques; set `claimedAt` in the raw claim paths; null derived ranks before recompute; hash motion text; add CHECKs and `CHECK`-style sets.
8. **M1.** Measure `SourceDocument`; stop rewriting `bodyGzip` on unchanged fetches; consider object storage for bodies.
9. **M10, L1 to L5, L8 to L12.** Prune notifications and expired sessions; drop the redundant indexes; add the missing foreign-key indexes; set the database time zone to UTC explicitly or move to `timestamptz`.

## Decisions for the owner

- Which of H2's options for person identity (stop-gap now, proper fix later).
- Whether to move HTML snapshots to object storage once M1 is measured.
- Whether to keep any snapshot of a private page at all.
- Naming: leave as is (recommended).

## Read-only measurements to run first

Run in the Neon SQL editor. They change nothing.

```sql
-- Where the 550 MB is: heap, indexes and TOAST (large values) per table
SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       pg_size_pretty(pg_relation_size(c.oid)) AS heap,
       pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - pg_indexes_size(c.oid)) AS toast
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC;

-- Stored HTML and private pages in it
SELECT count(*), pg_size_pretty(sum(octet_length("bodyGzip"))),
       count(*) FILTER (WHERE url ~* '/privateurls/') AS private_rows
FROM "SourceDocument";

-- Unused indexes (stats reset when Neon suspends, so read with care)
SELECT indexrelid::regclass, idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes ORDER BY idx_scan, pg_relation_size(indexrelid) DESC;

SELECT count(*) FROM "Account" WHERE refresh_token IS NOT NULL;      -- H1
SELECT count(*) FROM "GmailToken" WHERE "encryptionVersion" IS NULL; -- legacy plaintext
SHOW timezone;                                                        -- L5
```

Send me the results and I will turn the sizes into a measured version of M1 and the capacity section.
