# Opus tasks (debate_cv)

Last updated 2026-10-25. Scope for now: backlog sections A (ship what is built) and B (ingest and infrastructure). Everything not listed here is a Sonnet task.

## How to use this file

An agent picking up work here should read this before starting, take one task at a time, and finish it to its "Done when" line.

A task is listed because at least one of these holds:

- It changes design, schema or the consent model, not just code.
- It touches fragile code where a wrong answer looks right (parity across tournament formats, statistics, live encrypted data).
- It needs a trade-off judged, not a checklist followed.

Working rules:

- Local branches and the open PR only. Do not merge to `main`, deploy, or run a migration on production without the owner.
- Do not bump `PARSER_VERSION` casually: it invalidates cached parses for every user.
- Do not change queue lock ordering without re-running `tests/calicotab.deadlock.test.ts`.
- Anything written under this file gets reviewed by a fresh reader of the diff alone, not of the author's summary.
- A Sonnet task that turns up a surprise is handed up to here.

Related: `docs/INTEGRATION-2026-10-21.md` (what PR #115 contains and the deploy checklist), `docs/HANDOFF.md`.

## B6. Snapshots for API-sourced tabs

**Status (2026-10-25): built, PR #119, awaiting merge.** The owner chose option 1 (store the JSON, newest per URL). Measured on WUDC 2024: ~100 KB gzipped per tournament, against ~151 KB for the HTML tabs it replaces (`docs/SIZING-2026-10-25.md`).

**Decision needed (owner):** when team and speaker tabs come from the Tabbycat API, should the response JSON be stored as a `SourceDocument`?

- Today API-sourced tabs store nothing, so they drop out of the re-derivation archive. HTML tabs keep the newest snapshot per URL and a 90-day prune keeps that one.
- Without a snapshot you cannot re-parse after a parser change without re-fetching, and a tournament that later withdraws its tabs leaves no copy.
- Snapshots are the main database growth risk on a free Postgres tier.

Options: (1) store the JSON, newest per URL only (the 20 Oct report's recommendation); (2) store it compressed with the same retention; (3) accept the gap.

Done when: the choice is recorded in the handoff, the code stores or deliberately skips the snapshot, a test covers it, and the row-size effect is measured on a seeded record.

## B8. Rounds, break and participants through the API

**Status (2026-10-25): built, PR #120 (stacked on #119), awaiting merge.** Opt-in with `TABBYCAT_API_ROUNDS=1`, off by default. 0 real differences on 13 tournaments, including WUDC 2023/2024/2025 and Australs 2022/2025, with about 25–30 % fewer requests than HTML. Turning it on in production is the owner's call.

Goal: stop scraping HTML for the pages that are still scraped. Team and speaker tabs already read from the API (`lib/calicotab/tabbycatApi.ts`); the live parity check showed 0 differences on 11 tournaments.

- Still HTML: round results, the break and participants. The API has pairings and break eligibility.
- Parity has to hold across formats and odd settings. The all-ghost round bug (commit `8b31fa1`) was invisible to the parity suite and only appeared on WUDC 2024.
- Approach: map to the existing row shapes, diff against HTML on real tournaments, keep the HTML path as a silent fallback.

Done when: each page has a mapper with unit tests; a live diff shows 0 differences (or each is explained and judged harmless) on the 11 tournaments already used plus one WUDC-scale and one Australs tournament; the extra request count is noted against the per-host throttle budget.

Depends on: PR #115 merged, so the work builds on the live API source.

## B9. Pre-scrape 2020 to 2025 and match people by private URL

**Status (2026-10-25): step 1 done, awaiting the owner's scope choice.** 2020–2025 is about 1.15–1.24 M rows and 310–335 MB (620–670 MB with a 2x allowance) against the 1 GB Neon Free limit. Recommended: the whole set, if production is under ~300 MB, else Neon Launch first. See `docs/SIZING-2026-10-25.md`.

Idea (owner's): tournaments are finite and final, so scrape them once and match each person to a stored tournament from their private URL. An ingest becomes a database copy that takes under a second and can run inside the user's own request, with no queue wait and no cron for stored tournaments.

Flow: Gmail scan finds a private URL, then one request to that URL identifies the person, then the app links them to the stored tournament.

Exists already: the corpus crawler, a 625-tournament index with person coverage on 582 of them, a page cache, and `scripts/seed-from-corpus.mjs`.

Not removed: the queue and cron stay for tournaments after 2025 and for any not yet stored. Tournaments with unreleased tabs (403) will not be in the set.

Risks:

- Storage. WUDC 2024 alone is 3,076 team results and 5,274 round scores. Across 625 tournaments the row count could be in the millions. Not measured yet.
- Consent model. A CV is built only from links emailed to its owner (`isPrivateUrl` gate in ingest). The identifying fetch must stay, and stored data must never be reachable without it.
- Staleness. A tournament that corrects its tab needs a re-scrape path, at least for recent ones.

Step 1, before any build: count rows per table from the existing corpus export, estimate bytes, and compare to the database plan limit. If it does not fit, decide what to keep (CV-relevant fields only, or only tournaments with a known user).

Done when: the size estimate is written up and the owner picks scope. Only then design the schema and the match flow.

## C1. Outround motions on the /cv round ledger

**Status (2026-10-25): built on `opus/outround-motions`.** Outround motions are stored with `roundNumber` null and only a label, while the ledger matched motions by round number, so outround rows never showed a motion (525 of 1,023 on the seeded record).

`ledgerMotions` (`lib/cv/roundLedger.ts`) keeps the round-number match for prelims. For a row that `ledgerRoundNames` named as an outround, it matches unnumbered motions by stage through the stage lexicon ("Final" and "Grand Final" are one stage), in the team's own break category from `eliminationReached`.

When unsure it shows no motion:
- a "Round N" fallback row is never matched by stage;
- two different labels for one stage and bracket show nothing;
- a numbered motion is never moved onto another row.

Done when: tests cover each rule (`tests/cv.roundLedger.test.ts`), and the owner has checked an outround-heavy record on /cv.

## Parked (backlog sections C and D)

Not in scope until A and B are clear.

- Stats phases 3 to 7: spec at `docs/superpowers/specs/2026-09-17-filterable-stats-design.md`. Statistical choices; a wrong number looks fine.
- Skill rating (Glicko-2 or TrueSkill): start from `docs/RATINGS_DESIGN_NOTE.md`. Needs a public method page and an opt-in.
- Paste-a-URL ingest: avoids Gmail's restricted-scope verification. Threat-model the endpoint first (auth, abuse, privacy).
- `TOKEN_ENCRYPTION_KEY` rotation: needs a re-encrypt migration of stored Gmail tokens. Write the migration and rollback plan before touching the key.

## Owner's decisions (no model decides these)

- Merge PR #115 to `main` (deploys production). Done.
- Merge #119 (B6), #120 (B8), and turn on `TABBYCAT_API_ROUNDS` in production.
- B6: which snapshot option. Decided 2026-10-25: option 1.
- B9: scope, after the size estimate.
- JSON Resume award rules (the report recommended top 10).
- Which licence to use on the public repos.
