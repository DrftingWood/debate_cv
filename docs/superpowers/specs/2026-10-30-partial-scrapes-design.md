# Partial scrapes: design

Owner decisions, 2026-10-30 (`C:\Users\achar\reports\decisions\debate_cv.md`, "partial scrapes").

## Problem
A tournament scrape is all-or-nothing. `runFullScrape` throws "Aborting ingest" when any page fails (`fetchLevelFailures`), and the queue retries the whole tournament, about 16 pages again. With calicotab at 10-40 s a page, one slow page throws away everything that loaded. There is no way to refresh one tab or one round: a forced re-ingest refetches everything, and `prepareTournamentWideRefresh` deletes the tournament's results first.

## Decisions
1. **Two levels of piece.** Tabs are team, speaker, participants, motions, and break (one per category page). Within results, each round (R1, R2, …, each outround) is its own piece.
2. **Each piece records whether it loaded**, in a new table `ScrapePiece`: status, HTTP status, error, attempts, last attempt, when it loaded, next retry.
3. **Keep what loaded.** A scrape with failed pieces writes the pieces that loaded and records the failures. It never deletes stored rows that a failed piece would have replaced. It aborts only when no piece loaded.
4. **A refresh rewrites only its pieces.** A partial re-scrape fetches the landing page (for current URLs) and the chosen pieces, then deletes and rewrites only those pieces' rows.
5. **Failed pieces retry automatically.** Each piece retries alone after 15 min, 1 h, 6 h, then 24 h. After 5 failures it stops retrying until an admin acts.
6. **Partly loaded tournaments still show on the CV**, marked "Partly loaded" (with text, not colour alone).
7. **Admin.** An actionable overview: tiles, scrape health by piece kind, a list of partly loaded tournaments with Retry, failed import jobs with Retry. A per-tournament page shows a grid of pieces with a picker to re-scrape any tab or round. A user-facing refresh comes later.

## Out of scope
Backfilling `ScrapePiece` for already-stored tournaments; pieces appear as tournaments are scraped. A user-facing refresh. A global `PARSER_VERSION` bump.
