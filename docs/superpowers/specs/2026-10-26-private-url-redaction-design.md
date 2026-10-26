# Removing stored private URLs after a successful load: design (draft for the owner)

Owner decision B on paste-a-URL: once an ingest succeeds and the person is linked, the stored private URL is deleted. This note sizes that and proposes how, before any code. It also covers database-review findings H3 and M3.

## What a private URL is and where it is stored

A Tabbycat private URL is a credential for one person in one tournament. Today the full URL, token included, sits in:

| Place | Column | Used for |
| --- | --- | --- |
| `DiscoveredUrl` | `url`, `token` | One row per user and URL (unique on `userId, url`); the dashboard list; the account export |
| `IngestJob` | `url`, `lastError` | The queue (unique on `userId, url`); `lastError` can contain the URL |
| `SourceDocument` | `url`, `bodyGzip` | Stored copy of the landing page; the `/cv/verify` page joins on it |

About 37 files read or write the first two (found by search, to be read in detail in the first PR): the dashboard, CV page, queue drain, retry, re-ingest, lock, onboarding, claim and the account export.

## What the private URL is actually needed for

1. **The first load.** The landing page behind it gives the registration name and the user's judging card. Everything else (team tab, speaker tab, rounds, motions) is public.
2. **A re-ingest.** It fetches the same landing page again.
3. **Deduplication.** `(userId, url)` is the key that stops the same link being queued or stored twice.

Only (1) and (2) need the real, working URL. (3) needs only a stable identifier of it.

## Proposal: redact in place, keep a stable key

After a successful ingest, replace the token segment of the stored URL with a short one-way hash of it:

`https://host/slug/privateurls/<token>/` becomes `https://host/slug/privateurls/h-<first 16 hex of sha256(token)>/`

- The same link pasted again hashes to the same value, so dedupe, the unique keys and the dashboard list keep working without storing the credential.
- The redacted URL cannot be fetched. A re-ingest of a redacted row therefore refreshes the **public** pages only, through the same path the pre-scrape uses, and does not re-read the landing page. The judging card was already stored on the first load, and a person's claim is unaffected.
- A row that is still pending or failed keeps the real URL (it has not succeeded yet); it is redacted when it does.
- `IngestJob.lastError` has the token redacted whenever it is written.
- `DiscoveredUrl.token` is dropped (it duplicates part of the URL).
- `SourceDocument` rows for private pages are deleted on success, and no body is stored (the page-body change in PR #158 already stops bodies; this removes the rows and the join on them). The `/cv/verify` page must then join on the public tournament address instead.

## Steps, one PR each

1. `redactPrivateUrl(url)` and `isRedactedPrivateUrl(url)`: pure, tested, including that the redaction is stable and irreversible, and that a non-private URL passes through untouched.
2. Redact `lastError` text at the places the queue writes it.
3. On a successful ingest, redact the user's `DiscoveredUrl` and `IngestJob` rows and delete the matching private `SourceDocument` rows, in the same step that stamps success.
4. Re-ingest paths: when the stored URL is redacted, refresh via the public tournament base instead of failing. Covers `reingest-mine`, `retry-failed`, the single re-ingest button and the admin re-ingest all.
5. `/cv/verify`: join on the public tournament address.
6. Backfill: an admin-only route, run once by the owner, that redacts the rows already stored (405 private pages and every succeeded `DiscoveredUrl` and `IngestJob`). Idempotent; a row it cannot redact is left alone and counted.

## Risks to watch

- **Re-ingest loses the landing page.** After redaction, a user's own judging card is not refreshed. Acceptable under decision B, and the stored data stays.
- **Account export.** The export lists URLs as provenance ("which email gave us this URL"). It will list redacted ones, and the privacy page wording may need a line.
- **Anything that fetches `DiscoveredUrl.url`.** Each such place must handle a redacted row; step 4 and the tests exist to find them. Until every one is covered, the backfill (step 6) must not run.
- **Order of rollout.** Steps 1 to 5 can ship with nothing redacted yet. Only step 6 changes existing data.

## Open questions

- Should a user be able to re-supply the real URL to refresh their judging card later? (It would simply be pasted again; it hashes to the same row.)
- Keep failed or abandoned links with the real URL indefinitely, or redact those after a time?
