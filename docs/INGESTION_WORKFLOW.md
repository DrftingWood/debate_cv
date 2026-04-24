# End-to-end ingestion workflow (Gmail -> Calicotab -> Database)

## Pipeline levels

### Level 1: Gmail URL discovery

- Read authorized Gmail messages using `gmail.readonly`.
- Extract Calicotab private URLs from message body/snippet via regex.
- De-duplicate URLs before scheduling ingestion.

Example URL matcher:

```regex
https://[a-zA-Z0-9.-]*calicotab\.com/[\w-]+/privateurls/[\w-]+/?
```

### Level 2: Tournament scrape + parse

For each URL:

1. Fetch page HTML.
2. Parse tournament metadata.
3. Parse Team tab.
4. Parse Speaker tab.
5. Parse Results/Outround tabs.
6. Parse Judge tab (if available).
7. Build a normalized in-memory model.

### Level 3: Storage and re-use

- Compute tournament fingerprint.
- Upsert into relational schema.
- Record scrape timestamp and source URL.
- On future references to same tournament, serve from DB unless refresh requested.

## Idempotent ingest algorithm

```text
ingestPrivateUrl(url):
  normalized = normalize(url)
  html = fetch(normalized)
  parsed = parseAllTabs(html)
  fingerprint = makeFingerprint(parsed.tournament, normalized)

  existing = findTournamentByFingerprint(fingerprint)
  if existing and isFresh(existing.scraped_at):
      return existing (cache hit)

  tx begin
    upsert tournament
    upsert people
    upsert tournament_participants
    upsert participant_roles
    upsert speaker_round_scores
    upsert team_results
    upsert elimination_results
    upsert judge_assignments
  tx commit

  return hydrated tournament summary
```

## Suggested freshness policy

- `fresh` = scraped in last 30 days.
- Force refresh when:
  - manual trigger
  - parsing logic version changed
  - source data hash changed

## Minimal API surface

- `POST /api/ingest-url` -> ingest one private URL
- `POST /api/ingest-gmail` -> discover URLs from Gmail and queue ingestion
- `GET /api/tournaments/:fingerprint` -> fetch normalized tournament data
- `GET /api/people/:personId/tournaments` -> person’s tournament history

## Reference implementation added

A structure-discovery parser is now available at:

- `src/calicotab_parser.py`
- `tests/test_calicotab_parser.py`

It parses private-page navigation and registration details, returning URLs for Team/Speaker/Results/Break/Participants/Institutions pages that can then be fetched and parsed tab-by-tab.
