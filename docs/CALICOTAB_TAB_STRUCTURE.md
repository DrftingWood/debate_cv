# Calicotab tab/page structure observed for ILNU RR 2026

Observed from private URL: `https://ilnuroundrobin.calicotab.com/ilnurr2026/privateurls/rbo1rd0g/`.

## Canonical navigation map

- Private URL page: `/ilnurr2026/privateurls/<token>/`
- Team tab: `/ilnurr2026/tab/team/`
- Speaker tab: `/ilnurr2026/tab/speaker/`
- Motions tab: `/ilnurr2026/tab/motions/`
- Results rounds:
  - `/ilnurr2026/results/round/1/`
  - `/ilnurr2026/results/round/2/`
  - `/ilnurr2026/results/round/3/`
  - `/ilnurr2026/results/round/4/`
  - `/ilnurr2026/results/round/5/`
  - `/ilnurr2026/results/round/6/` (Grand Final)
- Break tabs:
  - `/ilnurr2026/break/teams/open/`
  - `/ilnurr2026/break/adjudicators/`
- Participants: `/ilnurr2026/participants/list/`
- Institutions: `/ilnurr2026/participants/institutions/`

## Private URL page fields that should be parsed

- `Private URL for <person_name> (<team_name>)`
- `Team name: <team_name>`
- `Speakers: <comma separated speakers>`
- `Institution: <institution_name>`

## Results pages

From Round pages, parse:

- Round identity (e.g., "Results for Round 1")
- Available views:
  - "View by Team"
  - "View by Debate"

These should map into the round/debate result ingestion layer.

## Parser strategy

1. Parse all links from the private page first.
2. Classify links into Team/Speaker/Motions/Results/Break/Participants/Institutions.
3. Crawl each classified page and parse table/header content.
4. Upsert to normalized schema.

## Important note for implementation

Tabbycat tournament visibility settings can cause tab pages to render with minimal content for some users or tournament phases.
Implementation must tolerate missing rows and parse whatever is currently visible.
