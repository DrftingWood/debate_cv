# debate_cv database audit (2026-10-26)

Scope: `prisma/schema.prisma` (637 lines), all 35 migrations in `prisma/migrations`, the raw SQL in `lib/` and `app/` (`$queryRaw`, `$executeRaw`, `$queryRawUnsafe`), plus `docs/CALICOTAB_DATA_MODEL.md`, `docs/SIZING-2026-10-25.md` and `docs/INGESTION_WORKFLOW.md`. This was a read-only review. I did not connect to any database, so every size figure below is an estimate or is marked "not verified".

Conventions used throughout:
- Every timestamp column is `TIMESTAMP(3)` **without time zone**, because that is the Prisma default.
- Every `Decimal` is `DECIMAL(65,30)`, which is unconstrained numeric. **No `Float` is used anywhere**, so no column uses a float where it should use a numeric.
- `ON UPDATE CASCADE` is set on every foreign key.

---

## 1. Inventory

Column legend: PK = primary key, UQ = unique, IX = index, FK = foreign key. "Should be NOT NULL?" lists nullable columns that look as if they should not be null. "Large/growing" lists columns that hold large or growing data.

### Auth (NextAuth)

| Model | Purpose | PK | UQ | IX | FK (onDelete) | Should be NOT NULL? | Large/growing |
|---|---|---|---|---|---|---|---|
| User | Account holder plus public-CV settings | id (cuid) | email; publicCvSlug | none beyond UQ | none | none | none |
| Account | OAuth link written by PrismaAdapter | id | (provider, providerAccountId) | **none on userId** | userId→User CASCADE | none | `refresh_token`, `access_token` and `id_token` are **plaintext** Google tokens with Gmail scope |
| Session | Database sessions (`strategy: 'database'`, lib/auth.ts:62) | id | sessionToken | **none on userId** | userId→User CASCADE | none | Expired rows are never pruned (no cron step found) |
| VerificationToken | NextAuth email tokens | **no PK** | token; (identifier, token) | none | none | none | none |

### Gmail, URLs and queue

| Model | Purpose | PK | UQ | IX | FK (onDelete) | Should be NOT NULL? | Large/growing |
|---|---|---|---|---|---|---|---|
| GmailToken | Encrypted Gmail token, one per user | id | userId | none | userId→User CASCADE | `encryptionVersion` (null means a legacy plaintext row) | none |
| DiscoveredUrl | A private URL found in a user's Gmail, and its link to a tournament and person | id | (userId, url) | (userId, ingestedAt); (registrationPersonId) | userId→User CASCADE; tournamentId→Tournament SET NULL (DB; Prisma default); registrationPersonId→Person SET NULL | none | `url` and `token` hold the **private URL and token in plaintext**; `subject` holds email subjects |
| IngestJob | Ingest queue, one row per (user, url) | id | (userId, url) | (status, scheduledAt); (userId, status) | userId→User CASCADE | none | `url` is plaintext private URL; `lastError` also contains it (ingest.ts:610 → queue.ts:172) |

### Tournament data

| Model | Purpose | PK | UQ | IX | FK (onDelete) | Should be NOT NULL? | Large/growing |
|---|---|---|---|---|---|---|---|
| Tournament | One scraped event | id (bigserial) | fingerprint | year; format (neither is used by any query found) | none | none | Small (about 1k rows) |
| Person | Global identity, **keyed by normalised name** | id | normalizedName | claimedByUserId; suppressedAt | claimedByUserId→User SET NULL | none | About 50k+ rows after the pre-scrape |
| PersonRejection | A user said "not me" | (userId, personId) | n/a | personId | User CASCADE; Person CASCADE | n/a | Small |
| TournamentParticipant | One person in one tournament: team, totals, ranks, judge aggregates | id | (tournamentId, personId) | tournamentId (**redundant**); personId | Tournament CASCADE; Person CASCADE | `speakerCategories` is TEXT[] **nullable in the DB** (migration 20260914152207) but `String[]` in Prisma | About 130k rows; the largest per-person table |
| ParticipantRole | Role(s) per participant | (tournamentParticipantId, role) | n/a | n/a | Participant CASCADE | n/a | About 130k rows |
| SpeakerRoundScore | Per-round speaker score, plus an 'average' row at roundNumber 0 | id | (tournamentParticipantId, roundNumber, positionLabel) | none | Participant CASCADE | `score` | The biggest row count (about 0.5M) |
| TeamResult | Team standings (round 0) and per-round results | id | (tournamentId, teamName, roundNumber) | none | Tournament CASCADE | `roundNumber` (it is part of the UQ, so NULLs escape dedup) | **About 130 MB by the sizing doc**; the largest table by bytes, excluding SourceDocument |
| Motion | Released motions | id | (tournamentId, roundLabel, seq) | tournamentId (**redundant**) | Tournament CASCADE | none | `text` and `infoSlide` are TEXT |
| TagProposal | Moderation queue for region and motion tags | id (cuid) | **none** (one live proposal per target is enforced in the API only) | (status, createdAt); (userId, tournamentId); motionId | User CASCADE; Tournament CASCADE; Motion CASCADE | none | Small |
| EliminationResult | Outround won/lost results, plus break-tab rows (stage holds a category such as 'Open', or 'break') | id | (tournamentId, stage, entityType, entityName) | none | Tournament CASCADE | none | About 40k rows |
| JudgeAssignment | Per-panel judging, sourced from 'landing' or 'round_results' | id | (tournamentId, personId, stage, panelRole, roundNumber), **3 of which are nullable** | (tournamentId, source); personId | Tournament CASCADE; Person CASCADE | `stage`, `panelRole` and `roundNumber` are part of the UQ, so NULLs escape it | About 190k rows when every judge is extracted |

### Feedback, notifications, provenance and rate limits

| Model | Purpose | PK | UQ | IX | FK (onDelete) | Should be NOT NULL? | Large/growing |
|---|---|---|---|---|---|---|---|
| CvErrorReport | User bug reports | id | none | userId (**redundant**); createdAt; resolvedAt; status; (userId, status) | User CASCADE | none | `tournamentIds` is TEXT[] with no FK |
| Notification | In-app activity feed | id | none | (userId, createdAt DESC); (userId, readAt) | User CASCADE | none | **No pruning**; grows without bound |
| SourceDocument | Fetched page or API body, gzipped | id | (url, contentHash) | url (**redundant**); fetchedAt | none | none | **`bodyGzip` BYTEA**; `url` includes **private URLs**; the newest row per URL is kept forever |
| ParserRun | Parser invocation log | id | none | sourceDocumentId; (parserVersion, parserName) (**unused**) | SourceDocument CASCADE | none | Pruned after 90 days, except the latest successful run per document |
| RateLimit | Fixed-window counters | key | n/a | windowStart | none | none | Pruned daily |

### Raw SQL inventory

| Location | Statement | Sets @updatedAt? |
|---|---|---|
| lib/queue.ts:60,69 | UPDATE IngestJob (reset stuck) | Yes, `NOW()` |
| lib/queue.ts:111 | UPDATE … FOR UPDATE SKIP LOCKED (claim) | Yes |
| lib/calicotab/ingest.ts:1586 | UPDATE TournamentParticipant.speakerRankOpenDerived | **No**. The table has `updatedAt @updatedAt` |
| lib/calicotab/ingest.ts:1903, 2037; app/api/onboarding/confirm/route.ts:65 | INSERT Person … ON CONFLICT | Person has no updatedAt. **These paths set `claimedByUserId` without `claimedAt`** |
| lib/calicotab/provenance.ts:51,59,81 | Retention DELETEs on SourceDocument, ParserRun and Person (placeholders) | n/a |
| lib/rateLimit.ts:81 | Upsert counter | n/a |
| lib/cv/buildCvData.ts:447 | MAX(roundNumber) aggregate | n/a (read only) |
| migration 20261026000000 | UPDATE Tournament.sourceUrlRaw | Yes |
| app/api/admin/schema-probe (`$queryRawUnsafe`), app/api/admin/migrations/clear-orphans | Introspection, and DELETE from `_prisma_migrations` | n/a |

---

## 2. Findings

Severity counts: **High 4, Medium 10, Low 12** (26 findings in total).

### High

**H1. Google OAuth tokens with Gmail scope are stored in plaintext in `Account`, which defeats the GmailToken encryption.**
- **Evidence:**
  - `lib/auth.ts:47` uses the stock `PrismaAdapter(prisma)` with `access_type: 'offline'` and the `gmail.readonly` scope (lines 52-58). The adapter's `linkAccount` writes `access_token`, `refresh_token` and `id_token` into `Account` (schema.prisma:83-88, TEXT columns).
  - Nothing ever nulls them: the only writes are `prisma.account.deleteMany` in `app/api/account/disconnect/route.ts:18`.
  - `lib/gmail/client.ts:106-109` even reads them back as a fallback.
- **Why it matters:** `lib/crypto.ts` encrypts `GmailToken`, but an identical long-lived refresh token sits next to it unencrypted. Anyone who reads the database (a leaked Neon connection string, a backup, a branch) gets read access to every user's Gmail.
- **Fix:** Wrap the adapter so `linkAccount` strips `access_token`, `refresh_token` and `id_token` before the insert, or encrypts them with the same `lib/crypto.ts`. Then run a one-off `UPDATE "Account" SET access_token=NULL, refresh_token=NULL, id_token=NULL` once `GmailToken` holds the encrypted copy. Remove the fallback in `gmail/client.ts:106`.

**H2. Person identity is a globally unique normalised name, so different people merge and one person splits; the database cannot represent two people with the same name.**
- **Evidence:**
  - `Person.normalizedName @unique` (schema.prisma:274).
  - `normalizePersonName` (`lib/calicotab/fingerprint.ts:73-85`) lower-cases the name and **deletes every character outside `[a-z0-9\s]`**. So "José Silva" becomes "jos silva", accented and non-Latin names collapse to fragments or to empty, and two different "Rahul Sharma"s share one row.
  - Every writer upserts on that key (`ingest.ts:1903-1913`, `ingest.ts:2037-2052`, `onboarding/confirm/route.ts:65-84`).
  - The claim route only allows claiming an unclaimed or own row (`app/api/persons/[id]/claim/route.ts:130`).
- **Why it matters at our scale:** the sizing doc counts 121,376 participants but only 52,114 distinct names (`SIZING-2026-10-25.md:11`). A namesake collision is therefore common, not an edge case. When user A claims the name, user B with the same name cannot claim it, and A's CV absorbs B's tournaments. This is the main blocker for a correct per-person history query.
- **Fix:**
  1. Make Person a surrogate identity: drop the UQ on `normalizedName` and keep a plain index on it.
  2. Resolve names to people per tournament. A participant row points to a Person chosen by (normalizedName plus a disambiguator such as institution, or a user claim).
  3. Make claims per participation (`TournamentParticipant.claimedByUserId`), or use a `PersonAlias` table, rather than per name.
  4. As a minimum stop-gap, fold diacritics before stripping (`normalize('NFKD').replace(/\p{M}/gu,'')`) and keep non-Latin letters (`\p{L}`). Doing that requires a one-off re-key migration.

**H3. Private snapshots and private URLs outlive account deletion and suppression requests.**
- **Evidence:**
  - `SourceDocument` has no userId. Its `url` is the private URL: the landing fetch at `ingest.ts:598` passes the normalised private URL, and `cv/verify/page.tsx:121` joins `sourceDocument.url IN userUrls`.
  - `bodyGzip` holds the private landing HTML (registration name, team, private links).
  - Retention keeps the newest row per URL **forever** (`provenance.ts:34-40`).
  - Account deletion only deletes `User` and relies on cascades (`app/api/account/delete/route.ts:44-47`), which never reach `SourceDocument` or `ParserRun`.
  - `Person.suppressedAt` masks names in tables, but stored HTML bodies keep the raw name. The comment at fetch.ts:470-472 says the API path scrubs names; I did not verify that any scrub exists for HTML.
- **Why it matters:** the privacy page promises erasure. A deleted user's private token and page stay readable in the database indefinitely, and suppressed people's names stay in the snapshots.
- **Fix:**
  - On account delete, run `DELETE FROM "SourceDocument" WHERE url = ANY($user_private_urls)`, collecting the URLs before the cascade removes `DiscoveredUrl`.
  - Stop storing `bodyGzip` for `/privateurls/` pages, or store them under a hashed URL key.
  - Add an HTML scrub, or a "drop bodies mentioning X", step to suppression.

**H4. Speaker round scores are deleted in one transaction and re-inserted in a second one, while the tournament is already stamped as current.**
- **Evidence:**
  - `prepareTournamentWideRefresh` deletes every participant's `SpeakerRoundScore` inside the main transaction (`ingest.ts:1969-1972`).
  - The same transaction stamps `parserVersion = PARSER_VERSION` and `scrapedAt` (1292-1297).
  - Only after commit does `finalizePostTransaction` run the separate delete+createMany transaction (`ingest.ts:1702-1719`).
- **Why it matters:** if the process dies between the two transactions (Vercel's 60 s budget, a pool drop), the tournament keeps zero round scores. The cache check (`ingest.ts:302`: `parserVersion === PARSER_VERSION && fresh`) then serves it as complete to every later user until a parser bump. At 1,000 pre-scraped tournaments and about 0.5M score rows this cannot be detected without a query. I did not verify whether any repair path exists.
- **Fix:**
  - Move the `parserVersion` stamp (and the `scrapedAt` bump) into a final `UPDATE` that runs after the score transaction succeeds.
  - Alternatively, insert the scores inside the main transaction with one `INSERT … SELECT unnest(...)` raw statement, which avoids the per-row cost that motivated the split.
  - Add a cheap integrity query (participants with a speaker role and a total, but no round rows) to the cron.

### Medium

**M1. `SourceDocument.bodyGzip` is unbounded and unmeasured; it is likely the largest table, and every unchanged re-fetch rewrites the bytea.**
- **Evidence:**
  - `fetch.ts:440-446`: `upsert … update: { fetchedAt, status, contentLength, bodyGzip }`. Bodies up to 5 MB raw are stored (`MAX_STORED_BODY_BYTES`, fetch.ts:176).
  - `SIZING-2026-10-25.md:34,79` excludes snapshots from every estimate. HTML team+speaker tabs alone are 151 KB gzipped for WUDC (line 105); round-result, participant, break, motion and landing pages come on top.
- **Why it matters:**
  - Not verified, but at roughly 100-250 KB per tournament × about 1,000 tournaments, snapshots plausibly account for **100-250 MB of the 550 MB**.
  - Rewriting an identical `bodyGzip` on every content match writes a new TOAST value each time, so dead TOAST tuples accumulate until autovacuum. That inflates `pg_database_size`, which is the number the free-plan limit and the pre-scrape guard (`__prescrape.live.test.ts:56`) watch.
  - The newest row per URL is kept forever, so dead tournaments and per-user private landing pages accumulate.
- **Fix:**
  1. Drop `bodyGzip` from the `update` branch (set it only `WHERE "bodyGzip" IS NULL` for backfill).
  2. Measure the table: `SELECT pg_total_relation_size('"SourceDocument"'), sum(octet_length("bodyGzip")), count(*) FILTER (WHERE url ~ '/privateurls/') FROM "SourceDocument";`
  3. Consider moving bodies to object storage (Vercel Blob or R2) and keeping only the key.
  4. Keep a per-tournament cap. Stop storing per-user landing bodies (see H3).

**M2. A tournament's host+slug identity is not enforced by the database; only a post-load test checks it.**
- **Evidence:**
  - `Tournament.fingerprint @unique` hashes host|slug|**name**|**year** (`fingerprint.ts:9-15`). A rename or a different inferred year produces a new fingerprint.
  - The host+slug fallback is an application `startsWith … insensitive` lookup that adopts nothing when there are two or more matches (`ingest.ts:201-223`).
  - Duplicates are only detected after the fact by `tests/__prescrape.live.test.ts:126-139`.
  - The 2026-10-26 migration also maps every root-hosted tournament to the bare site root, so they share one `sourceUrlRaw`.
- **Why it matters:** two concurrent ingests (or one ingest plus the pre-scrape) under different fingerprints both insert, because the advisory lock is keyed on the fingerprint (`ingest.ts:1270`). The result is duplicate tournaments that split participants across rows.
- **Fix:**
  1. Add `sourceHost TEXT NOT NULL` and `sourceSlug TEXT` (re-adding what migration 20260501000000 dropped), populated from `sourceUrlRaw`.
  2. Add `CREATE UNIQUE INDEX ON "Tournament"(lower("sourceHost"), lower("sourceSlug")) WHERE "sourceSlug" IS NOT NULL`.
  3. Take the advisory lock on host+slug rather than the fingerprint.

**M3. Private URLs and tokens are stored in plaintext in four places.**
- **Evidence:**
  - `DiscoveredUrl.url` and `.token` (schema.prisma:137,146; the token duplicates part of the URL).
  - `IngestJob.url` (195).
  - `IngestJob.lastError` (queue.ts:172 stores `fetch landing <private url> → HTTP …` from ingest.ts:610).
  - `SourceDocument.url` (H3).
- **Why it matters:** a Tabbycat private URL is a participant's credential. Depending on tournament settings it allows ballot or feedback submission and shows private data. The code already treats it as a secret on the shared Tournament row (migration 20261026000000), but not here.
- **Fix:**
  - Encrypt `DiscoveredUrl.url` and `IngestJob.url` with `lib/crypto.ts`, keeping a SHA-256 column for the (userId, url) unique.
  - Drop the redundant `token` column (or encrypt it).
  - Redact `/privateurls/<token>` in `lastError` before storing it.

**M4. The derived and denormalised facts on TournamentParticipant can drift from their sources.**
- **Evidence:**
  - `speakerScoreTotal` coexists with `SpeakerRoundScore` rows, including a duplicated 'average' row at roundNumber 0 (`ingest.ts:1567-1568`).
  - `speakerRankOpenDerived` is recomputed only for rows that currently hold the speaker role (`ingest.ts:1586-1605`).
  - `prepareTournamentWideRefresh` deliberately keeps claimed or judging participants with their old values (`ingest.ts:1944-1956, 1977-1985`). Those rows keep a stale `speakerRankOpenDerived` that can duplicate a freshly assigned rank.
  - `teamBreakRank` duplicates the break `EliminationResult` rows.
  - `eliminationReached` duplicates the outround `EliminationResult` rows. EliminationResult is fully deleted and rewritten (`ingest.ts:1957`), while `eliminationReached` on preserved rows is not.
  - `totalParticipants` and `totalTeams` are stored, not counted.
- **Why it matters:** the CV and /cv/stats read both sides, so users see inconsistent ranks and rounds, and a per-person history query has to choose a source.
- **Fix:**
  - Null `speakerRankOpenDerived` tournament-wide before the recompute (`UPDATE … SET "speakerRankOpenDerived"=NULL WHERE "tournamentId"=$1`).
  - Derive `eliminationReached` and `teamBreakRank` from EliminationResult in a view, or recompute them in the same transaction.
  - Add a cron consistency check.

**M5. The daily regex DELETE on Person cascades through participations.**
- **Evidence:**
  - `prunePlaceholderPersons` (`provenance.ts:80-88`, called from `app/api/cron/process-queue/route.ts:151`) deletes every Person matching `PLACEHOLDER_NAME_PATTERN`.
  - The foreign keys TournamentParticipant→Person, JudgeAssignment→Person and PersonRejection→Person are all `ON DELETE CASCADE` (init migration lines 294, 312).
- **Why it matters:** a regex edit in code silently deletes real people's participations, round scores, roles and judge records every night, with no audit trail. Short all-digit or "Iron …" style names are inside the pattern's reach.
- **Fix:**
  - Change Person's child foreign keys to `ON DELETE RESTRICT` and delete children explicitly in the prune.
  - Alternatively, mark placeholders (`isPlaceholder boolean`) instead of deleting them.
  - Log the deleted ids and counts in the cron response.

**M6. Motion tags can attach to the wrong motion text after a re-ingest.**
- **Evidence:** the upsert key is (tournamentId, roundLabel, seq). The update overwrites `text` and `infoSlide` but deliberately keeps `motionType` and `topic` (`ingest.ts:1395-1403`). `seq` is the document order (schema.prisma:424-426).
- **Why it matters:** if a tab inserts or reorders a motion, the approved tags (and the TagProposal audit rows) stay on a row whose text has changed.
- **Fix:** add `textHash` to the row. When the incoming text hash differs, null `motionType`/`topic` and mark the related proposals stale; or key the row on (tournamentId, roundLabel, textHash).

**M7. Unique keys over nullable columns let duplicates through.**
- **Evidence:**
  - `JudgeAssignment` UQ over stage, panelRole and roundNumber, all nullable (schema.prisma:524). The `db_hygiene` migration already had to delete such duplicates (20260611150000 §3).
  - `TeamResult` UQ includes the nullable `roundNumber` (408).
  - Writers rely on `createMany({skipDuplicates})` (ingest.ts:382).
- **Fix:**
  - On Postgres 15+ (the Neon version was not verified), recreate the indexes with `NULLS NOT DISTINCT`.
  - Otherwise make `TeamResult.roundNumber NOT NULL` (0 already means standings) and give the JudgeAssignment columns `''` or `-1` sentinels, as was done for `positionLabel`.

**M8. Raw claim paths skip `claimedAt`, and unclaim paths leave it set.**
- **Evidence:**
  - `claimedAt` is set only in `app/api/persons/[id]/claim/route.ts:132`.
  - The raw INSERTs that set `claimedByUserId` (`onboarding/confirm/route.ts:65-84`, `ingest.ts:2037-2052`) never set it.
  - The unclaim (`onboarding/confirm/route.ts:113`) and the FK `SET NULL` on user deletion never clear it. Only the admin release route clears it (`app/api/admin/persons/[id]/release/route.ts:61`).
- **Why it matters:** the column exists to audit disputed claims (schema.prisma:276-279), and it is wrong on the most common claim path.
- **Fix:**
  - Set `"claimedAt" = CASE WHEN "Person"."claimedByUserId" IS NULL AND EXCLUDED."claimedByUserId" IS NOT NULL THEN NOW() ELSE "Person"."claimedAt" END` in both raw upserts.
  - Clear `claimedAt` in the unclaim `updateMany`.
  - Add `CHECK (("claimedByUserId" IS NULL) = ("claimedAt" IS NULL))` once the data is backfilled.

**M9. The CV is driven by DiscoveredUrl, not by person.**
- **Evidence:** `buildCvData` builds `tournamentIds` only from the user's `DiscoveredUrl` rows (`lib/cv/buildCvData.ts:336-358`). It then filters participations by `person.claimedByUserId` (389-393).
- **Why it matters:** after the pre-scrape, a claimed Person's participations in tournaments the user has no email for (which is the point of B9) never appear. A per-person history needs `TournamentParticipant WHERE personId IN (claimed)`. That query is indexed (`TournamentParticipant_personId_idx`), but TeamResult and EliminationResult are then joined by **team-name strings**, because there is no Team entity or foreign key.
- **Fix:**
  - Drive the history from `TournamentParticipant(personId)`.
  - Add `(tournamentId, teamName)` indexes on TournamentParticipant, or introduce a `Team(id, tournamentId, name)` table referenced by TournamentParticipant, TeamResult and EliminationResult, so team joins are foreign keys rather than text.

**M10. `Notification` and `Session` grow without bound.**
- **Evidence:** the cron prunes only SourceDocument, ParserRun, RateLimit and placeholder Persons (`app/api/cron/process-queue/route.ts:142-151`). Nothing deletes old notifications, expired sessions or verification tokens.
- **Why it matters:** each table is small per user, but it grows forever, and storage headroom is about 450 MB.
- **Fix:** add `DELETE FROM "Notification" WHERE "readAt" < now()-interval '90 days'` and `DELETE FROM "Session" WHERE expires < now()` to the 03:00 prune.

### Low

**L1. Redundant indexes.**
- `TournamentParticipant_tournamentId_idx` duplicates the leading column of (tournamentId, personId) UQ: about 130k entries, roughly 3-4 MB.
- `Motion_tournamentId_idx` duplicates the UQ (tournamentId, roundLabel, seq).
- `SourceDocument_url_idx` duplicates the UQ (url, contentHash), and is a long-text index.
- `CvErrorReport_userId_idx` duplicates (userId, status).
- `ParserRun_parserVersion_parserName_idx` is never used as a filter (`admin/page.tsx:35` filters on warnings and orders by createdAt).
- `Tournament_year_idx` and `Tournament_format_idx` have no `where` usage in lib/ or app/.
- **Fix:** drop all of them, as the 20260611150000 migration did for DiscoveredUrl.

**L2. Foreign keys without a supporting index.**
- `DiscoveredUrl.tournamentId`: a Tournament delete with SET NULL scans the table.
- `TagProposal.tournamentId`: only the second column of (userId, tournamentId).
- `Account.userId` and `Session.userId`: user deletion scans them, and `gmail/client.ts:106` looks up by (userId, provider).
- All are small today. **Fix:** add single-column indexes, or (userId, provider) for Account.

**L3. ParserRun is missing the index its queries need.**
- `/admin` orders by `createdAt DESC LIMIT 200` with no createdAt index (admin/page.tsx:35-39).
- `isLatestParserRun` filters (sourceDocumentId, success) and orders by createdAt (ingest.ts:1859-1863).
- **Fix:** replace the unused index with `(sourceDocumentId, createdAt DESC)`, plus `(createdAt)`.

**L4. Raw UPDATE bypasses `@updatedAt`.**
- `ingest.ts:1586` updates TournamentParticipant without `"updatedAt" = NOW()`.
- **Fix:** add the assignment. That is the convention CLAUDE.md states for raw SQL.

**L5. Timestamps are `timestamp without time zone`, and raw SQL mixes in `NOW()`.**
- Prisma writes UTC wall-clock values. Raw SQL compares them with `NOW()` cast through the session `TimeZone` (queue.ts:43,63,114; rateLimit.ts:86; provenance.ts:53,61).
- This is correct only while the Neon role's TimeZone is UTC (not verified).
- **Fix:** set `ALTER DATABASE … SET timezone='UTC'` explicitly, or migrate to `timestamptz` (`@db.Timestamptz(3)`).

**L6. Score and rank columns have no CHECK constraints.**
- `speakerScoreTotal`, `SpeakerRoundScore.score` and `TeamResult.points` are unconstrained `DECIMAL(65,30)`. Numeric is the right type, but there is no precision or range.
- `rank`, `speakerRank*`, `teamBreakRank`, `roundNumber`, `wins`, `firsts`, `seconds`, `seq`, `chairedPrelimRounds` and `prelimRoundCount` accept negative values.
- **Fix:**
  - Use `@db.Decimal(7,2)` for totals and `(5,2)` for round scores.
  - Add `CHECK (x >= 1)` for ranks, `CHECK (x >= 0)` for counts and round numbers, and `CHECK ("firsts" + "seconds" <= …)` where meaningful.

**L7. Closed-set text columns have no enum or CHECK.**
- `ParticipantRole.role`, `JudgeAssignment.source`, `EliminationResult.entityType` and `.result`, `TagProposal.kind`, `JudgeAssignment.panelRole`.
- `EliminationResult.stage` is overloaded: it holds outround labels, break categories ('Open', `ingest.ts:717`) and the default 'break' (`ingest.ts:1666`).
- The docs deliberately avoid CHECK constraints for the *tag vocabulary* (migration 20260611120000). That reasoning does not apply to these internal sets.
- **Fix:** add CHECK constraints for `source IN ('landing','round_results')`, `result IN ('won','lost')`, `entityType IN (...)` and `role IN (...)`. Split break category out of `stage` into its own column.

**L8. TagProposal "one live proposal per (user, kind, target)" is enforced only in the API.**
- schema.prisma:455-456.
- **Fix:** `CREATE UNIQUE INDEX ON "TagProposal"("userId","kind","tournamentId",COALESCE("motionId",0))`.

**L9. `CvErrorReport.tournamentIds` is TEXT[] holding bigint ids, with no foreign key.**
- It is left dangling after a tournament is re-keyed or deleted.
- **Fix:** add a join table `CvErrorReportTournament(reportId, tournamentId)` with foreign keys.

**L10. Inconsistent `teamBreakRank` between the create and update branches.**
- The update branch uses `teamNameToWrite` (the primary team); the create branch uses `sp.teamName` (`ingest.ts:1540` vs `1551`).
- An iron-man speaker gets a different break rank depending on whether the row existed.
- **Fix:** use `breakRankForTeam` in both branches.

**L11. User deletion cascades `TagProposal`, which erases the moderation audit trail for shared tags.**
- schema.prisma:475. **Fix:** make `userId` nullable with `SET NULL`.

**L12. Migration hygiene risks.**
- Two migrations share the timestamp `20260501000000`.
- An orphan, `20260512000000_multi_gmail_tokens`, was applied to production but is not in the repo (see 20260524130000).
- `speakerCategories` is nullable in the database while Prisma models it as a non-null list (20260914152207).
- An admin route deletes rows from `_prisma_migrations` (`app/api/admin/migrations/clear-orphans/route.ts:77`).
- **Fix:**
  - Run `prisma migrate diff --from-url <prod> --to-schema-datamodel` before the next schema change. This must be run by the owner, since I made no database connection.
  - Set `speakerCategories` to `NOT NULL DEFAULT '{}'`.

---

## 3. Measurements the owner should run (read-only)

```sql
SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       pg_size_pretty(pg_relation_size(c.oid)) AS heap,
       pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - pg_indexes_size(c.oid)) AS toast
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC;

SELECT count(*), pg_size_pretty(sum(octet_length("bodyGzip"))),
       count(*) FILTER (WHERE url ~* '/privateurls/') AS private_rows
FROM "SourceDocument";

SELECT indexrelid::regclass, idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes ORDER BY idx_scan, pg_relation_size(indexrelid) DESC;   -- confirms L1

SELECT count(*) FROM "Account" WHERE refresh_token IS NOT NULL;                     -- confirms H1
SELECT count(*) FROM "GmailToken" WHERE "encryptionVersion" IS NULL;                -- legacy plaintext
SHOW timezone;                                                                       -- L5
```
