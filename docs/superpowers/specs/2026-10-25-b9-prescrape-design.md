# B9 — Pre-scrape 2020–2025 and match people by private URL

Status: design decided by Opus on the owner's instruction ("leave the complex decision making up to Opus, I want the pre-scrape"), 2026-10-25. The sizing behind it is in `docs/SIZING-2026-10-25.md`.

**The decision:**

- **Stage A:** load 2023–2025 first, through the existing ingest pipeline with no owner.
- **Matching:** a user's private URL matches a stored tournament through the cache path that already exists.
- **No new tables.**
- **Stage B (2020–2022):** waits on the production database size, or a move to Neon Launch.

## Scope and stages

| Stage | Years | Tournaments (corpus) | Rows | Size, with 2x allowance | Gate |
| --- | --- | ---: | ---: | ---: | --- |
| A | 2023–2025 | 260–278 | ~610,000 | ~330 MB | none beyond the PR |
| B | 2020–2022 | ~227 | ~495,000 | ~265 MB | the owner confirms the production size, or moves to Launch |

**Why A first:** production's database size is unknown (the owner chose "over 300 MB / not sure"). Stage A alone keeps the free plan's 1 GB in reach even if production is a few hundred MB. It also covers the tournaments current users are most likely to ingest.

**Why not cut columns:** the bytes are in TeamResult and SpeakerRoundScore, which the CV and /cv/stats both read.

## Identification: no new key

A tournament row is keyed by `fingerprint = sha256(host | slug | name | year)`.

- **Name:** Tabbycat titles every page `"<tournament> | <page>"`, and the name is the part before the bar. So the public home page and a private-URL page give the same name: "WUDC 2025 | Open Break" and "SIDO 2026 | Private URL" both yield the tournament's own name.
- **Year:** the year in the name when there is one. Otherwise the pre-scrape uses `null`. A private-URL ingest whose year was inferred from its email already tries the `null` fingerprint (`candidateFingerprints`), so both converge on one row.
- **Root-hosted entries:** 50 of the 260 dated 2023–2025 corpus entries are recorded by site root only (`https://presido2026.calicotab.com/`). A private URL always carries the tournament slug. So the pre-scrape resolves a root to its tournament when the root page links exactly one `/<slug>/`, and skips it otherwise. A row stored without its slug could never be matched.

## Match flow: the existing cache path

When a user's private URL is ingested and its tournament is already stored and current, `checkCacheFreshness` returns a cache hit:

1. It makes the one identifying fetch: the private landing page. That stays, so the consent model is unchanged.
2. `linkRegistrationPerson` links the registration person to the user.
3. It records that person's judge and speaker rounds from the landing page.
4. It marks the `DiscoveredUrl` ingested.

No tab is fetched, so an ingest becomes a database copy that takes about a second.

Two changes make this hold for pre-scraped tournaments:

1. **Settled tournaments stay fresh.** The freshness window is 30 days, which would make every pre-scraped tournament a cache miss. A tournament whose year is before the current year is settled and counts as fresh for 365 days. Parser-version bumps and the "nav shows more rounds than stored" check still force a refresh, as does `force` (a manual re-ingest).
2. **Judges from round results, for everyone.** On a finished tournament Tabbycat often empties the judge's Debates card on the private page. The full ingest then falls back to the round-results panels for the URL owner, but the cache path has no rounds to read. So the pre-scrape writes `JudgeAssignment` rows with `source='round_results'` for every judge on every panel. A judge who later ingests finds their rounds already attached to their Person.

   The old `EXTRACT_ALL_JUDGES` writer was deleted in May 2026 for being unverified, not for policy. This is a rebuild with tests.

   To keep those rows, the full ingest no longer deletes round-results rows tournament-wide inside its transaction. Each writer replaces only its own: the owner's ingest replaces the owner's rows, and the pre-scrape replaces everyone's. Before the pre-scrape, round-results rows only ever existed for URL owners, so existing data behaves the same.

## Consent

- **Public pages only:** the pre-scrape reads only public pages (public home, tabs, results, break, participants, motions) and the public API. Tournament release settings apply exactly as in ingest (B8's preference gates).
- **No new exposure:** nothing becomes visible that is not visible today. A CV shows only Persons claimed through a private URL, and the claim happens only in `linkRegistrationPerson`, reached only from a private landing page. Teammates and the field were already stored for every ingested tournament.
- **The identifying fetch stays:** without a private URL, nothing is claimed.

## Running it

`prescrapeTournament(url, { force?, deadline? })` (`lib/calicotab/ingest.ts`) is ingest's tab and write phases with no owner. The runner `tests/__prescrape.live.test.ts` walks a list (`scripts/prescrape/tournaments.json`), politely and resumably: a stored, current tournament is skipped.

The runner refuses a non-localhost database unless `PRESCRAPE_ALLOW_REMOTE=1` is set. Loading production is the owner's step.

## Staleness

- **A tournament that corrects its tab:** re-run the runner with `PRESCRAPE_FORCE=1` for it, or let any user's forced re-ingest refresh it.
- **Automatic refresh:** the 365-day settled window and the stale-rounds check cover the rest.

## Review points (from the independent reviewer, answered before the build)

### 1. A match needs the identifying fetch, and nothing else produces one

- **The only path to a claim:** a stored tournament is linked to a user only in `linkRegistrationPerson`. That is reached only from `ingestPrivateUrl` after:
  1. the URL passes `isPrivateUrl`, the anchored private-URL check, in `loadLandingAndFingerprint` and at every route;
  2. that private landing page is fetched successfully, with the user's own URL;
  3. its registration card names the person.
- **What does not produce a match:** a public listing, a tournament name, or a guessable URL. The pre-scrape never calls `linkRegistrationPerson`, never writes `DiscoveredUrl`, and takes no user id.
- **Tests:**
  - a URL failing `isPrivateUrl` throws before any lookup;
  - a failed landing fetch throws before the cache check;
  - `prescrapeTournament` refuses any URL containing `privateurls` (`publicTournamentBase`);
  - a pre-scrape writes no claim and no `DiscoveredUrl`.

### 2. Which round-results judge rows survive a full ingest

Before this change, the full ingest's transaction deleted every `JudgeAssignment` with `source='round_results'` for the tournament, then rewrote only the URL owner's. After it, the transaction deletes none. Each writer replaces exactly its own rows:

| Writer | Deletes, then rewrites |
| --- | --- |
| URL owner's full ingest (`recordJudgeRoundsFromRoundResults`) | that owner's `round_results` rows for the tournament (unchanged) |
| Pre-scrape (`recordEveryJudgeFromRoundResults`) | every `round_results` row for the tournament, then all judges' |
| Landing path (`recordJudgeRoundsFromLanding`) | that owner's `landing` rows (unchanged) |

- **What survives a user's full re-ingest:** other judges' pre-scraped `round_results` rows, which is the point.
- **Today's data is unaffected:** today only URL owners have `round_results` rows, and each owner's ingest already replaced its own.
- **Genuinely stale rows** (a tournament re-publishes its panels): a judge's own ingest refreshes theirs, and a forced pre-scrape refreshes everyone's. Between those, a non-ingested judge's pre-scraped panels stay as last scraped. That is the same staleness as every other pre-scraped field.
- **Tests:**
  - the transaction no longer issues the tournament-wide delete;
  - the owner writer still scopes its delete to `(tournamentId, personId, source='round_results')`;
  - the pre-scrape writer replaces the tournament's `round_results` rows and no `landing` rows.

### 3. Interplay with #124 (Re-ingest all, PARSER_VERSION 20261025.0)

- **Stale-marked tournaments still refresh:** "Re-ingest all" sets `scrapedAt` to the epoch. `storedTournamentFresh` measures age from `scrapedAt`, so an epoch tournament is over 365 days old and never fresh, settled or not.
- **A parser bump still invalidates:** the parser-version check in `checkCacheFreshness` is separate and unchanged. Any `Tournament.parserVersion` other than `PARSER_VERSION` is a cache miss, pre-scraped rows included. A version bump therefore invalidates them, and the runner re-scrapes them, since it skips only rows that are fresh and current.
- **`force` bypasses the cache entirely,** as before.
- **Tests:** an epoch `scrapedAt` with a settled year is not fresh; a parser mismatch is a miss whatever the age.

### 4. What the pre-scrape writes

It writes the same tables a cache-miss ingest writes, through the same functions:

- `Tournament`;
- `Person` (created, never claimed: `claimedByUserId` stays null);
- `TournamentParticipant` and `ParticipantRole`;
- `TeamResult`, `SpeakerRoundScore`, `EliminationResult`, `Motion`;
- `JudgeAssignment` (`round_results` only);
- `SourceDocument` and `ParserRun` (provenance, B6 snapshots).

It writes none of `User`, `Account`, `DiscoveredUrl`, `IngestJob` or `GmailToken`, and nothing per-user.

Person rows for the whole field (teammates, opponents, judges) are what every ingest already creates today, so the pre-scrape adds coverage, not a new kind of data. No Person is claimed without a user. A claim requires that user's private landing page (point 1). Stand-in names ("Speaker 1") are not created, as in ingest.

### 5. Request volume and politeness

- **Per tournament:** 25–45 requests, measured in B8's live runs (API tabs on, rounds/break/participants on HTML or API). That puts 2023–2025 at roughly 7,000–12,000 requests in total.
- **Per host:** 245 distinct hosts for the 260 dated entries. Most carry one tournament; the busiest carries 6 (edudrift.calicotab.com), then 4, 3 and 3.
- **The runner is sequential:** one tournament at a time, so one host at a time. Each tournament uses its own `FetchSession` with the existing per-host serial slot, the learned back-off and push-back handling, plus a configurable pause between tournaments (default 5 s).
- **Load per host:** no host sees more than its tournaments' worth of requests at ingest's normal rate. A host that pushes back is slowed by the same rules as ingest.
- **Wall time:** about 3–5 hours for stage A on one machine. The runner is resumable.

## Conditions from the design review (approved with these, 2026-10-25)

### C1. No duplicate tournaments: fall back to host + slug

The match fails silently if the public and private pages give different fingerprints: a rename, a title handled differently, or a year in one name and not the other. The user's ingest would then create a second Tournament row and leave the pre-scrape unused.

So both `loadLandingAndFingerprint` and the pre-scrape do the following before creating a Tournament:

1. Try the fingerprint candidates, as today.
2. If none matches, look up the tournament by host + slug: `sourceUrlRaw` starting with `https://<host>/<slug>/`.
3. If exactly one row matches, adopt its fingerprint, as `candidateFingerprints` already adopts an existing row's.
4. If several match, adopt none and log it. Never guess.

Within one Tabbycat site, a slug names one tournament, so host + slug identifies it.

Tests: a stored tournament whose name differs from the private page's is matched by host + slug and no second row is created; two candidates means no adoption.

After every load, the runner prints a duplicates report: each host + slug that has more than one fingerprint. Duplicates fail the run's check. Stored tournaments that no private page has matched yet are expected and are not reported.

### C2. Prove the match on real pages before any production load

On a local throwaway database:

1. Pre-scrape at least three corpus tournaments: one with a year in its name, one without, and one root-hosted (resolved to its slug).
2. Ingest each through a real private URL (the repo's existing test URLs).
3. Assert `cached: true`, exactly one Tournament row per host + slug, and the user's person linked.

This is a live test in the build PR, and its output goes in the PR body. Production is not loaded until it passes.

### C3. Maintenance cost of a PARSER_VERSION bump

Every `PARSER_VERSION` bump invalidates every pre-scraped row (there were two bumps on 2026-10-25). After a bump there are two choices:

- **Re-run the runner:** about 3–5 hours for stage A. It is version-aware: it re-scrapes only tournaments whose `parserVersion` is not the current one, so an interrupted run resumes where it stopped.
- **Do nothing:** the next user to touch each tournament pays a normal full ingest, which is exactly today's cost. Nothing is lost, only the speed-up for that tournament.

**Recommendation:** do nothing by default. Re-run the runner only after a bump that fixes data the CV shows for most tournaments; the bump's PR should say which kind it is. This keeps the routine cost of a bump at zero, and the pre-scrape remains a speed-up rather than a liability.

### Notes for the owner

- **Volume of stored names:** the pre-scrape stores the names of roughly every debater and judge at the stage-A tournaments, most of whom never signed up. It is the same kind of public data the app already stores for every ingested tournament (the whole field of each tab), at larger volume. Whether the privacy page should say so is the owner's call.
- **Opted-out people:** they are handled exactly as in ingest. Speakers who opted out of the tab stay redacted (`<em>Redacted</em>`), and their real names never reach a row or a stored snapshot (B6's `scrubOptedOutNames`). Tournaments that keep a tab private are not read (B8's release-preference gates).
- **Loading production is the owner's step.** Stage A needs the production database size first.
