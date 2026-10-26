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

**Status (2026-10-26): built, PR open (stage A tooling and the match path); production not loaded.**

- **Design:** `docs/superpowers/specs/2026-10-25-b9-prescrape-design.md`, merged as #126.
- **Proof on real pages (C2):** 4 tournaments, local throwaway database. Each was pre-scraped, then ingested through a real private URL. All four were served from storage, as one row per site, with the person linked. Other judges' rows survived a forced full re-ingest.
- **Loading stage A (2023–2025, 260 entries)** into production is the owner's step. It needs production's database size first. Stage B (2020–2022) waits on that size, or a move to Neon Launch.

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

## B10. Scrape Yellow Tab tournaments

**Status (2026-10-26): built on `opus/yellowtabs-host`; the owner has not yet seen it on a record.** Probe result: the pages are a Tabbycat install and our parsers read them unchanged (landing nav, team tab, speaker tab, results round, motions). `cnlupd.yellowtabs.com/cnlupd26/` loaded end to end into a throwaway database: 24 teams, 88 participants, 96 judge seats, 24 motions, 37 elimination results, no warnings, no duplicates. The host is now allowed in the fetch allowlist, the private-URL matcher, the Gmail search and the privacy copy. Earlier status: open, untested. Yellow Tab tournaments (hosted on `*.yellowtabs.com`, for example `cnlupd.yellowtabs.com/cnlupd26/`) are expected to share Calicotab's page structure, since both are Tabbycat installs, but nothing has been run against them. The two spreadsheets the pre-scrape lists came from hold exactly one such link, so the count is small today; the host is allowed nowhere yet, so a pasted or emailed Yellow Tab URL is refused.

Approach, smallest step first:
- Fetch one Yellow Tab tournament by hand (landing, team tab, speaker tab, one results round, motions) and diff the HTML against a Calicotab fixture. Record any difference in the markup or the URL shape.
- If it parses as is: add `.yellowtabs.com` to the host allowlist (`ALLOWED_TAB_HOST_SUFFIXES` in `lib/gmail/extract.ts`, the private-URL matcher beside it, and the redirect check in `lib/calicotab/fetch.ts`), then run the pre-scrape smoke mode on that tournament against a throwaway database.
- If not: list the parser differences and decide whether they belong in the existing parsers or in a host adapter.

Care: the allowlist is the SSRF defence. A suffix match on `.yellowtabs.com` must keep the existing tests that reject `a.yellowtabs.com.evil.example`; add the same cases for the new suffix.

Done when: one real Yellow Tab tournament loads end to end with the same rows a Calicotab one produces, the allowlist tests cover the new host, and the owner has seen it on a record.

## C1. Outround motions on the /cv round ledger

**Status (2026-10-25): built on `opus/outround-motions`.** Outround motions are stored with `roundNumber` null and only a label, while the ledger matched motions by round number, so outround rows never showed a motion (525 of 1,023 on the seeded record).

`ledgerMotions` (`lib/cv/roundLedger.ts`) keeps the round-number match for prelims. For a row that `ledgerRoundNames` named as an outround, it matches unnumbered motions by stage through the stage lexicon ("Final" and "Grand Final" are one stage), in the team's own break category from `eliminationReached`.

When unsure it shows no motion:
- a run in more than one bracket gets no stage match, because the ledger names its outrounds from one bracket's ladder;
- a tournament with a partial-round motion gets no stage match, because the ladder has no partial rung;
- a "Round N" fallback row is never matched by stage;
- two different labels for one stage and bracket show nothing;
- a numbered motion is never moved onto another row.

Done when: tests cover each rule (`tests/cv.roundLedger.test.ts`), and the owner has checked an outround-heavy record on /cv.

## Q1. Code-standards changes (queued: start only after the database fixes)

**Status (2026-10-27): phase 1 done; phases 2 to 4 not started.** Phase 1 is the compiler flags, the five lint rules as warnings and the escape-hatch ratchet (`npm run ratchet`). The baseline counts are in `docs/CODE_STANDARDS_BASELINE-2026-10-27.md`: 345 size and complexity warnings, plus 0 `any`, 7 `as unknown as`, 75 non-null `!` and 4 unexplained `eslint-disable`.

**Earlier status (2026-10-26): queued, not started.** The owner asked for this to be a to-do and picked up after the database changes (docs/DATABASE_REVIEW-2026-10-26.md). Research and the comparison are written: `docs/CODE_STANDARDS_REVIEW-2026-10-26.md` (with the cited checklist and the counted metrics beside it). Do not start any of it while a database fix is in flight.

Phases, in order, one small PR each:
1. Cheap settings: `noFallthroughCasesInSwitch` and `noImplicitOverride`; ESLint `max-lines`, `max-lines-per-function`, `complexity`, `max-params`, `max-depth` as warnings to create a baseline; a written ratchet (no new `any`, `as unknown as`, `!` or unexplained `eslint-disable`).
2. Tests before refactors: `rateLimit`, `fetchSession`, the untested parts of `auth`; characterization tests around `buildCvData` and the ingest transaction.
3. Structure, each with a short design note first: split `lib/calicotab/ingest.ts` (2,331 lines) and `buildCvData` (one function of about 939 lines) along real seams, one extraction per PR; type-aware strict linting in warning mode; `noUncheckedIndexedAccess` last.
4. Platform upgrades as separate planned migrations: Next 16, Zod 4, TypeScript 6/7, Prisma 7 (heaviest).

Done when: the warnings baseline is recorded and falling, the named modules have tests, `ingest.ts` and `buildCvData` are split with the suite green at every step, and the owner has decided the upgrade order.

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
