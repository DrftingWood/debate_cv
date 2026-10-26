# Paste-a-URL ingest: threat model (draft for the owner)

Goal: let a signed-in user add a tournament by pasting their private tab URL or uploading a CSV of them. The Gmail read stays (owner decision, below), so this is an extra route and does not by itself avoid Google's restricted-scope verification. This note is written before any code change, as `docs/OPUS_TASKS.md` asks.

## What already exists

`POST /api/ingest/url` (`app/api/ingest/url/route.ts`) already takes a pasted URL. Today it is the dashboard's manual path next to the Gmail scan. Controls in place, checked in code:

| Control | Where |
| --- | --- |
| Signed-in session required | `auth()` in the route |
| Rate limit, 20 requests per user per hour | `lib/rateLimit.ts` (`ingest:url`) |
| URL must be a private tournament URL, matched against the whole string (an unanchored match was an SSRF once, fixed) | `isPrivateUrl` in `lib/gmail/extract.ts` |
| Host must end in `.calicotab.com` or `.herokuapp.com` (suffix match on the parsed host) | `ALLOWED_TAB_HOST_SUFFIXES` |
| Redirects followed by hand, each hop re-checked against the allowlist, capped at a hop limit | `lib/calicotab/fetch.ts` |
| Ingest stops 55 s after the request starts and is handed to the queue | `INGEST_DEADLINE_MS` |
| Only the tournament's public address is stored on the tournament row | `publicTournamentUrl`, migration `20261026000000` |

## What a private URL is

A capability URL: whoever holds it can read one person's private page in one tournament, and the app treats the holder as that person. It is not a password, but it is a credential, so it needs the same care in logs and storage.

## Threats and gaps

| # | Threat | Today | Gap / proposal |
| --- | --- | --- | --- |
| 1 | SSRF: make the server fetch an internal or attacker host | Allowlist on the host, anchored match, manual redirects with per-hop check | Add a test that every redirect hop to a non-allowlisted host is refused, and one for `.herokuapp.com` subdomain takeover (any Heroku app matches the suffix). Consider restricting herokuapp hosts to ones that answer like a Tabbycat install. |
| 2 | Claiming someone else's identity with a URL you were not sent | Inherent to capability URLs: holding the URL is the proof | Decide the policy (see open question A). At minimum, one Google account per claimed person, and a visible "claimed from URL" note on the record. |
| 3 | Credential leakage: private URLs in logs, Sentry, error reports, DB | `Tournament.sourceUrlRaw` holds the public address only. Private URLs are still stored in `DiscoveredUrl.url`, `IngestJob.url` and `SourceDocument.url` | Audit those three columns and Sentry breadcrumbs for the token. Redact the token segment in logs and error text. Decide whether to keep the full URL after a successful ingest (open question B). |
| 4 | Abuse and cost: flood the queue or force large scrapes | 20 per hour per user, deadline, queue | Add a daily cap per user and a cap on queued jobs per user. Without Gmail there is no natural ceiling on URLs per account. |
| 5 | Scraping the host politely | Per-host throttle in the fetch layer | Keep it. The pre-scrape now serves most tournaments from storage, so a paste of a stored tournament should cost one landing-page fetch (see PR #143 and #144). |
| 6 | Fake or hostile pages on an allowed host | Parser treats pages as untrusted HTML | Fuzz the parser entry points with oversized and malformed pages. Cap response size. |
| 7 | Account deletion and the right to remove data | Delete and export routes exist | Confirm they remove `IngestJob` and `DiscoveredUrl` rows holding private URLs. |

## What changes in the product

1. The dashboard's primary action becomes "paste your tab link(s)", with a multi-line box (many URLs at once), per-line status, and clear errors for non-private or unsupported URLs.
2. Gmail scanning becomes optional or is removed, depending on question C. Removing it lets the `gmail.readonly` scope go and avoids the verification.
3. The queue path stays for tournaments too slow for one request.

## Owner's answers (2026-10-26)

- A. Identity claims: a name close to the user's Google profile name is acceptable proof. For URLs found by the Gmail scan, the registration name must match or be close to the profile name (fuzzy, so nicknames and initials still pass). Add an option to upload a CSV of URLs.
- B. Retention: not yet answered. Proposed default: delete the stored private URL once the ingest succeeds and the person is linked.
- C. Gmail: keep the Gmail read (and its scope) as a route alongside paste and CSV.
- D. Limits: keep the daily cap per user, and 20 URLs per paste (the CSV upload is capped the same).

### Consequences for the build

1. Name proximity check: a pure, tested function comparing the registration name with the Google profile name (case, accents, word order, initials). Below the threshold the URL is held for confirmation instead of linked.
2. CSV upload: one URL per row (or a column named url), at most 20 usable rows, each validated exactly like a single paste, with a per-row result.
3. Gmail stays. Because it stays, the restricted-scope verification is not avoided by this work; the paste and CSV routes are an addition.

## Done when

Tests cover items 1, 3 and 4 above; the audit of items 3 and 7 is written up with any redaction fixes; the owner has answered A to D; and the dashboard flow is built behind a flag and checked by the owner on a real private URL.
