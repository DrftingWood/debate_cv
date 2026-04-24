# Calicotab ingestion foundation

This document converts your requirements into a concrete data model and extraction contract.

## What is a Calicotab (for this project)?

A **Calicotab private URL** is the canonical source for tournament-level and participant-level data.
For each URL, we ingest:

- Tournament metadata (name, format, season/year)
- Person profile data (name + inferred role in that tournament)
- Team tab information (team score, team membership)
- Speaker tab information (speaker score, rank/position details)
- Results tab information (wins/losses, elimination progress, final placements)
- Adjudicator/Judge track (if present)

## Core extraction goals

Given a private URL, produce:

1. **Person summary** in that tournament:
   - person name
   - role(s): speaker, judge, team member
   - team affiliation
   - score and ranking information
2. **Tournament summary**:
   - tournament name
   - format (e.g., BP/AP/other)
   - year
   - stage progression structure
3. **Performance details**:
   - preliminary round outcomes (wins/losses)
   - position-wise round statistics where available (first/second/third/fourth for BP-like formats)
   - elimination stages reached (octo/quarter/semi/final etc.)

## Tab-to-entity mapping

| Calicotab area | Primary entities | Notes |
|---|---|---|
| Overview/Header | `tournaments` | source URL fingerprint + title parsing |
| Team tab | `teams`, `team_entries`, `team_results` | aggregates team score and record |
| Speaker tab | `people`, `speaker_entries`, `speaker_round_scores` | speaker totals, rank, per-round position if available |
| Results tab | `rounds`, `match_results`, `elimination_results` | supports prelim + break rounds |
| Judge/Adjudicator tab | `judge_entries`, `judge_assignments` | adjudicator role and progression |

## URL and caching strategy

A private URL can vary by token but still reference the same tournament. Use these keys:

- `source_url_raw`: full private URL
- `source_host`: e.g., `*.calicotab.com`
- `source_tournament_slug`: stable URL segment if present
- `tournament_fingerprint`: normalized fingerprint from host + slug + tournament title + year

Ingestion behavior:

1. Normalize URL and compute fingerprint.
2. If fingerprint already exists and last scrape is fresh, return cached records.
3. If stale or forced refresh, scrape again and upsert all related records.

## Role modeling

A person can have multiple roles in one tournament. Store roles as many-to-many:

- `participant_roles`: (`tournament_participant_id`, `role`)
- Allowed roles initially: `speaker`, `judge`, `team_member`, `coach` (extensible)

## Output contract (normalized)

Each ingest should emit:

```json
{
  "tournament": {
    "name": "...",
    "format": "BP|AP|...",
    "year": 2026,
    "source_url": "...",
    "fingerprint": "..."
  },
  "person_summaries": [
    {
      "person_name": "...",
      "roles": ["speaker"],
      "team": "...",
      "speaker_score_total": 0,
      "team_score_total": 0,
      "wins": 0,
      "losses": 0,
      "position_breakdown": {
        "first": 0,
        "second": 0,
        "third": 0,
        "fourth": 0
      },
      "elimination_reached": "quarterfinal"
    }
  ]
}
```

## Parser implementation notes

- Prefer stable selectors tied to table headers/tab labels.
- Build parser adapters per tab (`parseTeamsTab`, `parseSpeakersTab`, `parseResultsTab`, `parseJudgesTab`).
- Keep extraction idempotent and resilient to missing tabs.
- Persist provenance (`source_url`, `scraped_at`, optional content hash) for every derived record.
