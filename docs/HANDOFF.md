# Session Handoff — debate_cv

---

## 2026-10-27 - Stats changes (owner-approved): no re-ingest needed

- **BP uses straights, not wins.** A straight is points >= 2 x rounds; firsts are tracked separately as a break indicator; the BP "2nd-or-better" rate replaces win rate in the BP views.
- **Finals ranking** now includes Gold/Silver/Bronze finals. Rank values change: **Grand Final 100 -> 95** and **partial quarters (pre-semis) 75 -> 80**. Category finals carry category titles (ESL/EFL/Novice). "Top 10 speaker" replaces "top 10% of break". Tied ranks display as "5="; the export `team_rank` stays "#5".
- **No `PARSER_VERSION` bump and no re-ingest.** Stored `eliminationReached`, `lastOutroundChaired` and `lastOutroundPaneled` stay consistent because the shared comparator reproduces the old answers for stored data; the new rank values apply at read time.

---

## 2026-10-26 — B9 pre-scrape: where it stands

**Lists on main** (`scripts/prescrape/`): stage A 2023–25 (260), B 2020–22 (217), C sheet leftovers 2020–25 (108), D second-sheet 2020–25 (65), E 2026 + undated + pre-2020 (158), and `retry-timeouts.txt` (wudc2020, wudckorea). B–E were built from the Tabs tabs of the two Official Global Debating Spreadsheets, matched on host + slug.

**Loaded so far:** A (258 of 260 usable) and B (all but 7: four unpublished 404s, one 403, two write timeouts). The duplicate check at the end of every load covers the whole Tournament table (host + slug under more than one fingerprint) and has returned none. Database about 393 MB of 1024 MB after B.

**Gotchas learned**
- The workflow's `concurrency: prescrape` group (cancel-in-progress false) keeps one running and ONE pending run. A third dispatch cancels the pending one. Start loads one at a time.
- A shard's runner can have 65 ms to the database instead of 4 ms; the same big tournament then takes 5–6 minutes instead of 40 seconds. Use more, smaller shards (4) and expect shard 0 to be the slow one.
- Pre-scrape write limit is 15 minutes (live ingest stays 45 s). `PRESCRAPE_MAX_YEAR=2026` makes root pages expand to 2026 tournaments.
- Cancelling a run is safe: each tournament is one transaction and the loader skips ones already written; the report step runs on cancel, so the progress is kept.

**Tagging:** answers for the 2026-10-26 export (4,072 topics, 3,918 types, 352 of 404 regions) are loaded and approved. 52 tournaments have no region (names give no place). edudrift and wolce are tagged Southeast Asia (the owner calls them Singapore and Malaysia; the vocabulary has regions only). A fresh Download untagged is needed after each load.

---

## 2026-10-25 (night) — B8: should `TABBYCAT_API_ROUNDS` be turned on?

**Recommendation: turn it on, after the current Re-ingest all has finished.** Set `TABBYCAT_API_ROUNDS=1` in Vercel (Production) and redeploy. Waiting keeps the re-ingest's evidence (write times, failures) from being mixed with a second change.

- **The benefit is fewer requests and less fragility, not speed:** a quarter to a third fewer requests on every tournament whose API answers, so less exposure to Cloudflare push-back and to HTML markup changes.
- **Wall time is unchanged.**
- **Stored data is identical,** page for page.
- **Falls back cleanly** wherever the API can't serve a page. Where it can't serve the rounds, it costs a few extra calls (Uhuru 2022: 4).

**Rollback:** delete `TABBYCAT_API_ROUNDS` (or set it to anything but `1`) in Vercel → Settings → Environment Variables, then redeploy. Env changes only take effect on a new deployment. No data migration is involved in either direction. Rows written while it was on are the same rows the HTML path writes.

### Evidence

**1. Real ingests, flag off vs on** (`tests/__ingestTiming.live.test.ts`). These are real private URLs, force-ingested into a local throwaway Postgres, alternating which mode ran first.

| Tournament | Off: time / requests | On: time / requests | Stored rows (teams, participants, eliminations, scores, judges) |
| --- | ---: | ---: | --- |
| WUDC 2024 | 52.9 s / 53 | 56.7 s / 39 | identical |
| ASO Winter 2024 | 24.1 s / 46 | 22.5 s / 31 | identical |
| ILNU RR 2026 | 15.0 s / 25 | 17.5 s / 26 | identical |
| Uhuru Worlds 2022 (outrounds) | 14.5 s / 22 | 16.0 s / 26 | identical (API had no rounds; HTML fallback cost 4 extra calls) |

- **Requests:** down 26 % (WUDC 2024, 53→39) and 33 % (ASO, 46→31) where the API serves the rounds.
- **Wall time:** within ±3 s either way. The per-host throttle, not the request count, sets the pace, and the API's per-round list is large.
- **Not usable:** 17 of the 21 private URLs available couldn't be measured. Their landing page no longer loads (dead herokuapp installs, rotated URLs), which is independent of the flag.
- **A flake, not caused by the flag:** HKPDS 2022, IITM PD 2025 and Oxford WSDC 2021 each failed one run of the pair, at random, on a `fetch: participants` error.

**2. What the API serves across tournaments** (`tests/__apiCoverage.live.test.ts`): 32 public corpus tournaments, 2020–2023, API side only. The survey stopped at 32 of 63 when the machine ran low on memory; the remaining 31 (2023–2026) weren't reached.

| Page | Served by the API | Sent back to HTML, and why |
| --- | ---: | --- |
| Round results | 300 of 311 (96 %); every round at 29 of 32 tournaments | 7 rounds not in the API, 4 rounds with no results yet |
| Break tabs | 43 of 78 (55 %) | 34 show institutions, 1 has ranks that skip numbers |
| Participants list | 4 of 32 (12 %) | 28 show institutions |

- **Where the saving comes from:** almost all of it is round results.
- **Institutions keep most participants lists and many break tabs on HTML,** by design. The API only links institutions to a token-gated endpoint, so reading those pages from it would drop every judge's and team's institution.
- **Rounds outside the API** cost nothing beyond one pairings call, then fall back.

**3. Parity** (PR #120): 0 real differences against the HTML parsers on 13 tournaments, including WUDC 2023/2024/2025 and Australs 2022/2025.

### Production: WUDC-scale fits the 60 s function; local timings overstate

#123's `[ingest] write phase` log, from the owner's Re-ingest all on cfbb302 (Vercel fra1 → Neon):

| Participants / teams | Write time |
| --- | ---: |
| 60 / 25 | 1.8 s |
| 91 / 29 | 2.1 s |
| 125 / 26 | 3.4 s |
| 137 / 31 | 4.4 s |
| 146 / 53 | 5.0 s |
| 194 / 43 | 3.2 s |
| 211 / 58 | 5.3 s |
| 244 / 87 | 5.6 s |
| 273 / 94 | 5.8 s |
| 242 / 94 | 6.6 s |
| 274 / 94 | 8.5 s |
| 436 / 192 (SIDO 2026) | 11.0 s |
| **1,062 / 379 (WUDC 2022)** | **18.1 s** |

**WUDC 2022 is the proof:** it ingested successfully on the platform at 18:18:09Z, with a fetch phase of about 23 s, a write of 18.1 s, about 41 s in all, and a flat 15 s reserve. Its first attempt did not finish and its second did, which is #123's deferral working as designed.

- **My local runs overstated the risk:** WUDC 2024 took 53–57 s locally (a 35–40 s fetch phase on this machine's network). Production's fetch for WUDC-scale is about 23 s, so WUDC-scale tournaments fit the platform today.
- **The write rate is sublinear:** about 17 ms per participant + team for small tournaments, 12.6 ms at WUDC scale.

**Reserve decision (#128):** 4 s + 14 ms per participant + team, overridable with `INGEST_WRITE_RESERVE_MS`.
- **Against the data:** 5.2 s for the smallest, 9.2 s for 274/94 (the slowest per row, 8.5 s), 12.8 s for SIDO, 24.2 s for WUDC 2022. That covers every measured write and admits WUDC 2022, which has about 32 s left after its fetch.
- **The first fit was wrong:** 3 s + 25 ms per row would have reserved about 39 s for WUDC 2022 and deferred it on every attempt.
- **Which way it errs:** a killed write rolls back, so under-reserving is the cheaper error, and the fit leans toward admitting.
- **New in the log:** `fetchMs` and `remainingAtWriteMs`.

**What B9 is for:** speed, not rescue. Big tournaments ingest on the normal path today. The pre-scrape turns their first ingest into a database copy of about a second.
- **In B9's stage A (2023–2025):** WUDC 2023, WUDC 2024, Australs 2023–2025 and the other 2023–2025 tournaments in the corpus. WUDC 2025 is in the corpus only as its site root (`wudc2025.calicotab.com/`), so it is included only if that root page links exactly one tournament; otherwise the runner skips it rather than guess.
- **On the normal path, working:** WUDC 2022 (proven above), Korea WUDC 2021, the rest of 2020–2022 until stage B, and every 2026 tournament.

---

## 2026-10-25 (late) — Operator state after PRs #115–#122, and what is still open

**On `main`:** #115 filterable stats + Tabbycat API tabs + JSON Resume; #116 a private participants list no
longer fails an ingest (+ one retry for a dropped connection); #117 round-ledger names/points/BP placements,
motions list fetched, Tags/Verify admin-only; #118 tag suggestions (Suggest all tags, Approve all); #119 B6 API
snapshots + `docs/SIZING-2026-10-25.md`; #120 B8 rounds/break/participants via the API (**off**,
`TABBYCAT_API_ROUNDS=1`); #121 outround motions on the ledger; #122 pre-processed tags without an API key.

**Open at the time of writing:** #124 (Re-ingest all really re-fetches + `PARSER_VERSION` 20261025.0) and #123
(per-ingest deadline so a late-started job stops cleanly instead of being killed at 60 s). Merge #124 first,
then run Re-ingest all; it will now be a real, slow re-fetch of every tournament.

### Operator checklist (owner)

- [ ] Merge #124, then `/admin → Re-ingest all` (the previous runs were cache hits and re-fetched nothing).
- [ ] Merge #123 once its follow-ups land; then add `?respond=early` to the cron-job.org URL (job
  8720055) so its 30 s limit stops showing false timeouts.
- [ ] Tags: `/admin/tags` → Download untagged → give the file to Claude → Load answers → reject the odd row →
  Approve all. Repeat after each re-ingest, which adds new motions. No API key needed.
  (`Suggest all tags` is the API-key route and needs `ANTHROPIC_API_KEY`.)
- [ ] Rotate the cron-job.org API key and `CRON_SECRET` (Vercel env, the GitHub Actions secret, and the
  cron-job.org job's Authorization header); delete the plain-text key file.
- [ ] Give the B9 pre-scrape the production database size (Vercel → Storage); its plan is gated on it.
- [ ] Click through the signed-in `/cv` ledger (round names, running points, BP placements, outround motions).

### Landmines learned today

- **Re-ingest all was a no-op for cached tournaments.** It queues plain ingests; an ingest is a cache hit while
  the tournament is fresh (30 days) and at the current `PARSER_VERSION`. A parsing change needs a version bump
  (or #124's stale-marking). Symptom: cron ticks of ~1.5 s after a "re-ingest".
- **`next build` rejects an optional `req?: Request` on a route handler; `tsc` does not.** Run a real
  `next build` before pushing route changes.
- **A participants-list 403 is usually Tabbycat's own "Permission Denied (403)"** (the organisers keep it
  private), not Cloudflare; `SCRAPER_API_KEY` does not help. It is now optional unless participants are already
  stored for that tournament (a forced re-ingest would otherwise overwrite them from the landing page alone).
- **Hobby keeps one hour of runtime logs.** Investigate a production error within the hour or not at all.
- **Some landing pages link only `/motions/statistics/`.** The real list is `/motions/`; the parser now builds
  it. The statistics page's text must never be stored as motions (old rows were pruned by re-ingest).
- **cron-job.org gives up after 30 s**; a drain tick can run to 55 s. That showed as failed runs while a backlog
  cleared. The drain itself was not interrupted.

### Tag workflow, in one place

`lib/tags/todo.ts` defines what still needs an answer (shared by the classifier and the export).
`GET /api/admin/tags/export` → answers file → `POST /api/admin/tags/import` files **pending** proposals only
(vocabulary-validated, idempotent, never overwrites a tag or a decided proposal) → `POST
/api/admin/tag-proposals/approve-all` writes them through. Nothing reaches a CV without that last click.

---

## 2026-10-25 — B8: rounds, break and participants through the Tabbycat API

**Branch `opus/b8-api-rounds`, on top of `opus/b6-api-snapshots`.** Local, not pushed. Off by default:
`TABBYCAT_API_ROUNDS=1` turns it on (`.env.example`). Turning it on in production is the owner's call.

- **`lib/calicotab/tabbycatApiRounds.ts`** maps the API to the exact shapes `parseRoundResults`,
  `parseBreakPage` and `parseParticipantsList` return. Each linked page comes back from the API or as
  a reason to scrape it as before, so ingest falls back per page and silently.
  - **Round results:** `teams/standings/rounds` (one call carries every team's side, points and win for
    every round, outrounds included) plus one `rounds/<seq>/pairings` per linked round for the judges.
    BP prelims take `won` from first place (the API's `win` is always false there); outrounds and
    two-team formats take it from `win`. Side labels follow `debate_rules__side_names`. A drawn team with
    no result (a bye) has no row, as on the page.
  - **Break:** the API `rank` is the page's rank column, ties and "(different break)" teams included.
    If the ranks skip numbers (IITB 2023's do; its page does not), that tab stays on HTML.
  - **Participants:** speakers from `teams`, judges from `adjudicators` (core > invited > normal).
- **Privacy gates:** a page is read from the API only when the tournament's `public_features__public_*`
  preference is explicitly true, and only for URLs the landing-page nav links. Opted-out people appear
  as `<em>Redacted</em>` on break and participants pages, exactly as the HTML lists them. They are left
  out of round results, which never name them.
- **Institutions stay on HTML.** Where a tournament shows institutions (`ui_options__show_*_institutions`
  not false), the participants list and break tabs show codes the API can only link to `/institutions`,
  which needs a token. Those pages are scraped, so no judge or team loses its institution (WUDC 2025:
  172 judges). Round results are unaffected.
- **Shared helpers:** `roundIdentity` and `breakPageKind` were lifted out of `parseTabs.ts` with no
  behaviour change, so both sources label rounds and break stages identically. `getApiList` and
  `cleanName` are now exported from `tabbycatApi.ts`.
- **Snapshots:** the API fetcher in ingest goes through B6's `withApiSnapshots`, so every new endpoint
  is archived the same way.
- **Request budget** (live run): the API path used 21–29 requests where the HTML pages it replaces took
  33–43 per tournament. That is about 25–30 % fewer requests, under the same per-host slot.
- **Parity:** `RUN_TABBYCAT_API_ROUNDS=1 npx vitest run tests/__tabbycatApiRounds.live.test.ts`.
  **0 real differences on 13 tournaments** (BP, Australs, WSDC/schools). Every page the API answered
  matches the HTML parser row for row: team results, sides, points, outcomes, judges, break ranks and
  scores, participants. Every other page is an intended fallback.

  | Tournament | Rounds from API | Break tabs from API | Participants | Real differences | Requests API / HTML |
  | --- | ---: | ---: | --- | ---: | ---: |
  | WUDC 2024 | 19/19 | 4/4 | API | 0 | 29 / 43 |
  | WUDC 2025 | 17/17 | 3/4 | HTML (institutions) | 0 | 27 / 39 |
  | WUDC 2023 | 17/17 | 3/4 | HTML (institutions) | 0 | 27 / 39 |
  | Australs 2022 | 15/15 | 3/4 | HTML (institutions) | 0 | 25 / 35 |
  | Australs 2025 | 14/14 | 3/4 | HTML (institutions) | 0 | 24 / 33 |
  | SIDO 2026 | 16/16 | 4/4 | HTML (institutions) | 0 | 27 / 37 |
  | SIDO 2023 | 13/13 | 2/2 | HTML (institutions) | 0 | 22 / 29 |
  | IITB 2023 | 10/10 | 2/3 (ranks skip numbers) | API | 0 | 19 / 24 |
  | IITB 2022 | 0/10 (API 401) | 0/3 | HTML | 0 | 2 / 24 |
  | NDO 2021 | 10/10 | 2/3 | HTML (institutions) | 0 | 19 / 24 |
  | ILNU BP 2023 | 10/10 | 0/3 (team institutions) | HTML (institutions) | 0 | 15 / 24 |
  | MukMem 2021 | 12/12 | 2/3 | HTML (institutions) | 0 | 21 / 28 |
  | ANDO 2021 | 10/10 | 2/3 | HTML (institutions) | 0 | 19 / 24 |

  The adjudicator break is the tab that falls back where institutions are shown. WUDC 2023/2024,
  Australs 2022/2025 and SIDO 2026 ran on the final code. The other eight ran before the last review
  fixes: the push-back stop, the drawn-team coverage check, wider BP detection and a safe break-category
  URL. All four only add HTML fallbacks. Neither final-code Australs run fell back on coverage, including
  Australs 2022 round 3, where a drawn team has no result. Network errors (DNS, connection resets) on this
  machine interrupted some runs; each affected tournament was re-run.
- **Tests:** `tests/calicotab.tabbycatApiRounds.test.ts`.
- **Noticed, not changed:**
  - On the HTML path, ingest looks up a round's nav label by the *fetched* URL, which is the
    `by-debate/` variant when that exists. The lookup can miss, so the label falls back to the page
    heading. The API path keys by the nav URL and does not have this.
  - Australs 2025's `teams/standings` sends a metric value as a string. B8's break mapper accepts that.
    The existing team-tab mapper rejects it, so that tournament's team tab falls back to HTML.

---

## 2026-10-25 — B6: Tabbycat API responses kept as snapshots

**Owner decision (2026-10-25): option 1, store the API JSON, newest per URL only.** Branch
`opus/b6-api-snapshots`, cut from `main` at `fb6564a` (PR #115 merged). Local, not pushed.

- **`withApiSnapshots`** (`lib/calicotab/fetch.ts`) wraps ingest's API fetcher. Every 200 JSON body
  from `/api/v1/tournaments/<slug>/…` is stored as a `SourceDocument` keyed by its endpoint URL, as
  received. All eight endpoints are kept, since the mappers join across them. A non-200 or a non-JSON
  200 is not stored. A failed write is logged and swallowed, and a slow one is given 2 s before ingest
  moves on, so the API path never fails or stalls because of it. A body read that fails still reaches
  `getList` the way it did before, so fallback classification is unchanged.
- **Opted-out speakers:** `scrubOptedOutNames` blanks `name` / `last_name` on any `anonymous: true`
  object before storing. Tabbycat already nulls them (WUDC 2024: 10 of 10), so on such installs the
  body is stored byte-for-byte. The scrub covers installs that don't, so storage never holds more than
  the public tab showed.
- **`storeSourceDocument`** is the upsert lifted out of `fetchHtmlWithProvenance`, so both sources
  share gzip, the 5 MB cap and `(url, contentHash)` dedup. `pruneIngestArtifacts` needs no change:
  newest-per-URL retention already applies per endpoint URL.
- **No ParserRun** for these rows, the same as the HTML team and speaker tabs, which never had one.
- **Size:** WUDC 2024's five large endpoints are ~100 KB gzipped, against ~151 KB for the two HTML
  tabs they replace (`docs/SIZING-2026-10-25.md`, measured on the seeded local record).
- **Tests:** `tests/fetch.apiSnapshot.test.ts`.
- Re-derivation from these snapshots is not built. They are an archive for now, as the HTML bodies were
  when they were first kept.

---

## 2026-10-20 — Tabbycat REST API as a source for the team and speaker tabs

**Branch `feat/tabbycat-api`, cut from `feat/filterable-stats`.** Tests 1,203 passing / 40 skipped;
`tsc` + `eslint` clean. No ingest behaviour changes.

- **`lib/calicotab/tabbycatApi.ts`** fetches `/api/v1/tournaments/<slug>/{teams,speakers,rounds,
  speaker-categories,teams/standings,speakers/standings,speakers/standings/rounds}` and maps them to
  the same `TeamTabRow[]` / `SpeakerTabRow[]` that `parseTeamTab` / `parseSpeakerTab` return. Any
  non-200 or non-JSON answer returns `unavailable` so a caller can fall back to HTML.
- **Parity:** `RUN_TABBYCAT_API=1 npx vitest run tests/__tabbycatApi.live.test.ts` diffs the two
  paths. Clean (0 diffs) on 11 tournaments — WUDC 2024/2025, Australs 2022, IIT Bombay ×2, SIDO 2026,
  BSO 2021, NDO 2021, KO-23, ILNU RR 2026, MukMem 78: ~3,100 speakers, ~1,300 teams, BP / AP / Australs.
- **Rules the mapping had to learn** (each was a live diff first):
  - one column per prelim, empty where unspoken; outrounds dropped;
  - iron-person rounds show the non-`ghost` speech;
  - two-team formats put `speaks_sum` in `totalPoints` (the HTML ptsCol fallback);
  - every score rounded to 2 dp, as displayed (panel-averaged thirds);
  - opted-out speakers come back as `speaker: null` standings rows. Scores are recovered from the
    per-round endpoint only when exactly one hidden speaker's prelims sum to the row total; the team is
    never attached.
- **Where the API knows more:** swing-team speakers' scores (blank on the HTML tab, up to 35 per
  tournament), institution names from `long_name` (the HTML tab has none; `/institutions` needs a
  token), and public speaker categories on tabs that don't render the column.
- **Where it knows less:** two opted-out speakers on the same total can't be told apart (WUDC 2024: 2
  rows; Australs 2022: 1), so their rounds stay empty. The HTML has them, but those rows have no team,
  so `findRedactedOwnerRow` never uses them either.

### Wired in, then made the default (owner decision 2026-10-20: use the API, don't reparse)

`fetchAndParseTabs` asks the API first unless **`TABBYCAT_API_TABS=0`** (kill switch). There's no
`PARSER_VERSION` bump: cached tournaments keep their HTML-derived rows. It uses this ingest's
per-host `FetchSession` slot and skips the two HTML tab fetches when the API returns both tabs.
Anything less falls back to HTML **without** a warning, because a non-empty `fetchWarnings` also
suppresses `prepareTournamentWideRefresh`. The source is logged via `console.info('[ingest] tabbycat api', …)`.

**Not verified end to end:** no local Postgres on the machine this was built on, so the
flag-on path has unit and parity coverage but no real `ingestPrivateUrl` run. Before setting the
first deploy, run one re-ingest locally and compare `/cv`. If anything looks off in prod, set
`TABBYCAT_API_TABS=0` in Vercel.

### Per-tab sources, release settings, validation (later 2026-10-20)

Tests 1,224 passing / 40 skipped; `tsc` clean; `eslint` 0 errors (1 old warning in
`scripts/test-scrape.mjs`). Live parity re-run: BSO 2021 and KO-23 0 diffs, SIDO 2026 0 diffs.

- **Each tab now has its own source**: `api` (use the rows, skip the HTML page), `html` (fall
  back as before), or `private` (read nothing). `htmlTabsToFetch` turns that into the HTML URLs
  ingest may still fetch. So a team tab can come from the API while the speaker tab falls back.
- **Release settings are checked first.** `/preferences` answers without a token on calicotab
  2.12. `tab_release__{team,speaker}_tab_released: false` makes that tab `private`, and ingest
  fetches neither the API standings nor the HTML page, even when nav built a tab URL itself. When
  preferences are hidden (401/403), the standings call goes ahead. On calicotab an unreleased
  standings call answers 401 (seen on 01-rean `nsdsc11-23`), and that falls back to HTML, which
  Tabbycat gates the same way.
- **Top-N tabs** (`*_tab_limit > 0`) are left to HTML. The standings endpoint ignores the limit:
  mace `zodleliminations2021` has speaker limit 3 and returns 142 rows. On BSO 2021, which has a
  team limit of 28, the HTML tab also shows all 57 teams. So what the limit actually hides is
  unclear, and HTML stays the organisers' own rendering.
- **Validation:** every list goes through a zod schema covering only the fields the mapping reads.
  Wrong types, an object where a list should be (a paginated or error envelope), a missing
  `anonymous` flag, or standings that point at unknown teams all count as `html`, with the
  reason logged.
- **Host push-back:** each API request has a 15 s timeout, the same as fetch.ts. If the first
  call (`/preferences`) times out or answers 404 or non-JSON, the remaining API calls are
  skipped. A 429, a 503 or a timeout on team standings skips the speaker calls. A 429 or 503 (or a
  Cloudflare 403) also goes to `FetchSession.noteRateLimited`, so the HTML fallback uses the
  slower interval it has learned. The API itself is not retried; the HTML path already retries.

### Open decisions

- Request budget: a full API ingest makes 8 API calls and skips 2 HTML tabs, so it makes about 6
  more same-host requests than before. `FETCHES_PER_INGEST = 16` in fetch.ts (the drain's
  time estimate) was not changed.
- API mode stores no `SourceDocument` snapshot for the team and speaker tabs, so they drop out
  of the re-derivation archive. Should the JSON be stored as a snapshot instead?
- Round results, break and participants still come from HTML. The API has `rounds/<n>/pairings`
  and break eligibility for a later pass.

---

## 2026-09-17 — Formats fixed in ingest; filterable statistics (phases 0–2 of 7)

**Working tree only, not committed.** Tests 1,013 passing / 38 skipped; `tsc` + `eslint` clean.
**Spec:** `docs/superpowers/specs/2026-09-17-filterable-stats-design.md` — decisions, build order, status per phase.

### Product changes (affect real users)

- **Tournament format** (`lib/calicotab/format.ts` `inferTournamentFormat`, moved out of ingest): room shape
  first (four seats → BP; two sides named Gov/Opp → Asian Parliamentary, Aff/Neg → Australs,
  Prop/Opp → World Schools, confirmed by squad size ≥ 3; two a side → "Two-team Parliamentary"), then
  name keywords, then the old team-size rule. The old rule mislabelled 8 of the reference record's 73
  tournaments (all Australs as AP, NorAms as BP) and left 3 blank. Squad size can come from the
  participants page. `formatAbbrev` gains `Aus` and `2v2`. **No `PARSER_VERSION` bump** — the pending
  `/admin → Re-ingest all` (09-15 checklist) backfills.
- **Coverage over-count** on /cv/stats: motion coverage counted judged-only tournaments ("66 of 37").
- **Public CV** (`/u/<slug>`): doubled title suffix fixed; formats abbreviated; long tournament/team names
  truncated like the owner ledger, which stopped every "Broke" badge clipping (measured, 3 widths).
- **`buildCvData`**: rows carry `teammateDetails` (teammates' totals and round scores, names masked via
  `displayNameFor` exactly like `teammates`) and `prelimRoundCount`.
- **/cv/stats is filterable** by partner, pairing (pro-am / peers) and seat, URL-synced. Sections moved
  unchanged to `components/stats/StatsSections.tsx`; `FilterableStats` narrows the data
  (`lib/cv/statsFilter.ts`) and re-runs `computeSpeakerStats` in the browser. Under a seat filter, tab
  placement, breaks, runs, round dynamics, seasons and their findings are withheld with a reason.

### New pure modules (all test-first)

`lib/motions/classify.ts` (Policy / Actor / Belief / Stance / Regret / Preference + context-led and
info-slide flags; 99.8 % of 1,023 corpus motions), `lib/cv/statsFacts.ts` (round and tournament
tables, `seatKey`, `proAmFor` — pro-am gap > 1.5 from scored speeches only), `lib/cv/statsFilter.ts`.

### Landmines

- **Pro-am never uses tab totals.** A total ÷ prelims put a partner who sat out rounds 25.8 points below
  the user on the reference record. Unlabelled beats wrong.
- **Choice rounds have no motion type**: the round tab doesn't say which motion a room chose
  (~60 of 219 prelim rounds on the reference record). Fixable only from per-debate pages (phase 7).
- **Soft 404 on `/u/<unknown>`**: root `app/loading.tsx` streams a 200 before `notFound()`. A real fix
  removes that boundary from `/u`'s path and so changes navigation UX elsewhere — owner decision.
- The seeded corpus user (`scripts/seed-from-corpus.mjs`) now needs a third argument, `derived.json`
  from `tests/__derive.live.test.ts`, and **preserves `publicCvEnabled` across re-seeds** unless
  `PUBLIC_CV=0/1` is passed.

### Next (spec phases 3–7)

3. Per-format seat tables with per-format baselines; teammates with pro-am badges; motion-type section.
4. Cross-tabs and findings. 5. The fourteen "have data" views. 6. Institution eras and opponents
(parser + schema). 7. Speaking order and chosen motions from per-debate pages (separate spec).

---

## 2026-09-16 — A real 73-tournament record, for reviewing the CV at depth

**Not merged; working tree only.** Tests 902 passing / 36 skipped (unchanged),
`tsc` + `eslint` clean. No product code touched — the changes are corpus
tooling and a second seed script.

### Why

Every CV surface had only ever been reviewed against `seed-dev-data.mjs`: a
14-tournament invented record built to hit awkward branches. Nothing had been
rendered at the scale a long career reaches. This session put one real
73-tournament record into a local database to find out what breaks.

### The corpus is now a person index

The 2026-09-15 corpus had depth pages for only the **first 100 targets
alphabetically**, so its person counts were meaningless as a career measure —
the most prolific person in it appeared to have 17 tournaments.

- `__corpus.live.test.ts` now **caches**: a page already on disk is not
  re-fetched (`CORPUS_REFETCH=1` overrides). The participants pass below
  served 1,366 of its pages from disk and fetched 571.
- `CORPUS_PARTICIPANTS=1` fetches `/participants/` for tournaments *outside*
  the depth slice — one page each. That is what makes the corpus a person
  index, and it is affordable where the nine-page depth tier is not.
- `CORPUS_INDEX=<name>` lets a focused pass share the pages directory without
  overwriting `index.json`. `__corpusdb.live.test.ts` honours it too, and its
  ">100 tournaments" guard relaxes to ">0" for a focused index.

Person-level coverage went from 99 tournaments to **582 of 625**. Against the
full index, **32 real people have competed at more than 50 tournaments**; the
top four entries are still the stand-ins (`Speaker 2` at 341), which is a
standing confirmation that `PLACEHOLDER_NAME_PATTERN` earns its keep.

### The record

Ritabrata Mitra, 74 tournaments in the index and 73 with a reachable root —
the most balanced dual career available (37 speaking, 36 judging), across
WUDC Belgrade 2022, WUDC 2024, EUDC 2021, Australs, UADC, China BP and Japan,
tracking GLC Mumbai → IGNOU → Edinburgh. Deep-crawling those 73 lifted the
data from 7 speaker-tab rows to 37, 47 round scores to 219, 11 judge rounds
to 66 and 1 break row to 16.

Spot-checked against the tab's own independent fields at IITB 2023: published
total 398 = sum of the five round scores; published rank 5 = rank by ordering.
The CV's field denominator of 176 is exactly 185 scored speakers − 8 stand-ins
− 1 collapsed duplicate name, which is what ingest would also produce.

### `scripts/seed-from-corpus.mjs` (new)

Projects a corpus export into the app's tables. It exists because **ingest
cannot be used for this**: `ingestPrivateUrl` is gated on `isPrivateUrl`,
which demands `/<slug>/privateurls/<token>/`. That gate is the product's
consent model — a CV is built only from links emailed to its owner — and it is
not something to loosen for a demo. Companion pieces: `scripts/corpus-export.sql`
(psql → one JSON bundle; Prisma has no driver to query the corpus with) and
`tests/__tagplaceholders.live.test.ts` (asks the real detector which names are
stand-ins, so the rule is not re-implemented in a third dialect).

Three things about the schema cost a debugging cycle each and are worth
knowing before writing to these tables:

1. **`DiscoveredUrl` is what the CV reads first.** Participations alone render
   "No tournaments ingested yet" — `buildCvData` starts from the URLs the user
   supplied, not from every tournament they appear at.
2. **`JudgeAssignment.stage` holds a round LABEL, not a category.** Writing
   `'prelim'` makes `classifyRoundLabel` return `unknown` and the CV's
   "Judged" column renders empty for every row.
3. **A speaker's `broke` flag comes from `TournamentParticipant.teamBreakRank`
   / `eliminationReached`**, not from the `EliminationResult` rows. With those
   null the stats page confidently reported a 0% break rate over 37 entries;
   the real figure is 65%.

Deliberately left null: `eliminationReached` and `lastOutroundChaired`. The
crawler takes `resultsRounds.slice(0, 3)`, so no outround ballot is in the
corpus and there is no real stage name to write — inventing one inflates
"outrounds chaired" with a number nothing backs.

### What the deep record exposed

- **Page weight.** In dev, `/cv` renders 5.7 MB of HTML in ~8s, `/cv/motions`
  8.1 MB in ~13s, `/cv/verify` 4.8 MB in ~7.5s. Production strips the dev
  overhead, but most of that is data, not bundle: every tournament ships its
  expanded round ledger. A 73-tournament record is not an outlier — 32 people
  in the corpus alone are at that scale. Worth a virtualised or
  collapsed-by-default ledger before someone with a long career signs up.
- `Tournament.format` and `region` are never populated by this path, so those
  columns read "—" on every row.

### The public view at 73 rows — three defects

`/u/<slug>` had only ever been seen at 14 tournaments. Turned on locally
(`PUBLIC_CV=1`, opt-in; the default stays off) and rendered anonymously, it
serves 873 KB in ~10s — a tenth of `/cv`, so the condensed public template is
doing its job. Three things are wrong with it:

1. **Doubled title suffix.** `generateMetadata` returned
   `"<name> · debate cv"` while the root layout's template is `'%s · debate cv'`,
   so the tab and every link preview read
   "Ritabrata Mitra · debate cv · debate cv". **Fixed** in
   `app/u/[slug]/page.tsx` — the title is now just the name. This is the only
   product-code change in the session.
2. **Result badges are clipped.** The speaking table's `scrollWidth` (997)
   exceeds its container's `clientWidth` (982), and the "Broke" badge in the
   RESULT column lands 3px past the visible right edge — measured, not eyeballed,
   and identical at 1440 / 1280 / 1024 because the table carries a min-width.
   All 24 badges on this record are cut until the table is scrolled sideways.
   Not fixed: `DESIGN_INSTRUCTIONS.md` §6 governs the `.ledger` mechanics and
   this wants a deliberate column-width decision, not a nudge.
3. **Soft 404.** `/u/<unknown-slug>` returns **HTTP 200** with the "CV not
   found" body. `notFound()` is called, but the Suspense shell has already
   streamed, so the status is locked in. Low impact — that branch sets
   `robots: index:false`, and all public CVs are `noindex, nofollow, nocache` —
   but it is still a 200 for a page that does not exist.

Also cosmetic on both views: TEAM RANK and FORMAT read "—" on every row,
because this seed populates neither `TeamResult.rank` nor `Tournament.format`.

### Next

1. Decide whether `/sample` should show a deep record. It is still Maya Rao,
   fictional, 5 rows. **Do not publish this record as-is** — Ritabrata Mitra
   is a real person who has not asked for a public CV. The local database now
   has `publicCvEnabled: true` for reviewing the template, which is safe while
   it stays local and is not a decision to carry into a deploy. A fictional
   record at 50+ tournaments, or this person's consent, are the honest routes.
2. The badge clipping and the soft 404 above.
3. The page-weight finding above.
4. Unchanged from 2026-09-15: round label on `SpeakerRoundScore`, outround
   `TeamResult` keying, landing-page judge history.

## 2026-09-15 — Corpus-driven parser overhaul, one round nomenclature, red team

**Merged:** PR #114 → `main` as `dcf1165`; production deploy green (migrations applied at build).
**Tests:** 902 passing / 33 skipped (was 658); `tsc` + `eslint` clean.
**`PARSER_VERSION`:** `20260915.0` — every cached tournament re-parses on its next touch.

### How the work was done

625 real Tabbycat tournaments (offline HTML corpus) were parsed with the repo's
own parsers, loaded into a local Postgres (`corpus` database in the
`debate-cv-pg` Docker container), and interrogated with SQL. Every defect below
was found that way or proven by an executed repro. A five-agent red team then
attacked the result (stage labels, stand-in names, round numbering, an
old-vs-new differential parse of every corpus cell, migration/deploy safety);
everything it confirmed is fixed.

The tooling now lives in the repo — before, it was only in a session scratch
directory:

- `tests/__corpusdb.live.test.ts` — corpus → CSVs (`RUN_CORPUS_DB=1 CORPUS_DIR=… CSV_OUT=…`)
- `tests/corpusdb/schema.sql`, `load.sql`, `checks.sql` — each check states its
  expected answer; every "expect 0" check returns 0. The header lists five
  first-generation checks that were wrong in ways that read like a clean parse.
- `tests/__motionsweep.live.test.ts` — re-fetches `/motions/` pages (network).

The corpus itself is NOT in the repo (gzipped pages + `index.json`, ~1,500
files). It sat in a session scratchpad; if it is gone, it has to be re-crawled.

### What changed

| Area | Before → after | Key files |
|---|---|---|
| Tied places ("5=") | 9,896 of 14,371 speakers and 316 teams stored unranked → ranked | `parseTabs.ts` `parseRank` |
| Scores `78<small>.50</small>` | 12 speaker tabs (all Australs) had no scores → 13,570 speeches recovered. Only the `<small>` decimal wrapper is unwrapped; any other markup still leaves a cell unread | `parseTabs.ts` `parseNumber` |
| Two-team results | outcome lives only in the popover title ("Won against X"); 1,083/1,084 prelim rows had none → all read; a " vs X" cell is decided by the title alone | `outcomeFromPopoverTitle` |
| Trainees | Ⓣ read as chair (5,310 marks) → role `trainee` | `parseAdjudicatorCell`, ingest round-results writer |
| Outround detection | English word list → stage lexicon ("Novice GF", "Octavos", "Cuartos") | `parseRoundResults` |
| Round numbering | speaker scores/motions keyed by the label's digit, team results by URL → both by URL sequence: match by round key ("R1A" = "Round 1A"), then by column position, digit only where nav labels prove it safe; repeated labels via motion heading order. Was dropping 404 scores (R1A/R1B collision) and shifting rounds at 15 tournaments | `lib/calicotab/roundNumbers.ts`, ingest, `MotionRow.roundIndex` |
| Motions | fetched from `/motions/statistics/` → `/motions/`; 13 → 870 corpus motions; pasted markup stripped, literal "<" kept | `parseNav.ts`, `parseMotions.ts` |
| Stand-in names | "Speaker 2" (53 tabs), "Swing B", "&lt;em&gt;Redacted&lt;/em&gt;" (36 tabs) each one shared claimable Person → no Person; claimed ones kept; registration/onboarding can't claim one; redacted-owner fallback ignores stand-ins | `lib/calicotab/names.ts`, ingest, `redactedSpeaker.ts`, onboarding confirm |
| Stand-in cleanup | migration `20260915000000` deletes unclaimed, unsuppressed, ASCII-named stand-in Persons (cascades to participations) after indexing `JudgeAssignment.personId` + `DiscoveredUrl.registrationPersonId`; daily `prunePlaceholderPersons` in the 03:00 cron repeats it | migration, `provenance.ts`, cron route |
| Attendance tags | anu's "[o] "/"[i] " stripped from every name cell and the registration block | `names.ts` `stripAttendanceTag` |
| Dash team "—" | a team (158 speakers became mutual teammates) → no team | `parseTabs.ts` `nameText` |
| New fields read | speaker break categories, team rosters, BP firsts/seconds, adj-core/independent flags, CJK round names | migrations `20260914152207`, `20260914172007` |
| Derived speaker totals | tried and **reverted**: tabs without a Total column rank by average, so sum-of-speeches misplaced speakers (13th-ranked → 365th of 413) | `parseTabs.ts` |
| Code review (start of branch) | break category kept in outround labels; stuck drain no longer reports "Done"; retries gated on status; Stop interrupts waits | `formatStage.ts`, `lib/ingest/` |

### Round nomenclature (owner-directed)

Rungs are named by the rooms a full round has: Final 1, Semifinals 2,
Quarterfinals 4, Octofinals 8, Double Octofinals 16, Triple Octofinals 32.
A round run with byes is **"Partial &lt;rung&gt;"**. Pre and Partial name the
same round from opposite sides (BP: Final = 4 teams, Pre-Final = Partial
Semis = 6, Semis = 8):

    Pre-Final = Partial Semifinals        Pre-Quarters = Partial Octofinals
    Pre-Semis = Partial Quarterfinals     Pre-Octos    = Partial Double Octofinals

"Double X" is its own rung (Double Quarters = Octofinals), so "Partial Double
Quarters" = Partial Octofinals. Partial ranks just below its full rung; no two
stages share a rank (`JUDGE_STATS_RANK`). The CV shows one name per round.
Documented at the top of `lib/calicotab/stageLexicon.ts`.

## Operator checklist (2026-09-15)

- [x] PR #114 merged, production deploy green.
- [ ] Confirm the three migrations in `/api/admin/schema-probe` → `recentMigrations`
      (`20260914152207_speaker_categories`, `20260914172007_team_firsts_seconds`,
      `20260915000000_remove_placeholder_persons`).
- [ ] `/admin` → **Re-ingest all**, so corrected ranks, recovered scores, two-team
      results, trainee roles and the new stage names reach every tournament now
      rather than on each one's next touch. Expect a heavier drain than usual.
- [ ] Spot-check a CV at a split-round tournament (anu, cmdlp2021), a two-team
      tournament (australs, 2ndaristotlecup) and a WUDC with Partial Double
      Octofinals.
- [ ] Carried forward, still unverified: GitHub repo secrets `CRON_SECRET` +
      `APP_URL` for the 15-minute drain; `ANTHROPIC_API_KEY` for the Haiku
      motion classifier (now worth running: motions were almost never read
      before this release, and the corpus sweep yielded 870 from 70 tabs).

## Next steps (priority order)

1. **Store the round label on `SpeakerRoundScore`.** The stats page labels
   rounds by sequence ("R6" for anu's "Round 5"). Needs a column + re-parse.
2. **Outround `TeamResult` rows** are keyed by URL number and pollute the
   by-position slice; they stay because the cache-staleness check counts them
   against every nav round. Change both together.
3. **Landing-page judge history** (`parseNav.stageInfoFromLabel`) still takes
   the round number from the label; align it with `roundNumbers.ts`.
4. Auto-drain after scan, admin tournament-merge tool, region auto-suggestion
   — unchanged from the 2026-06-11 list below.

## Landmines added this session

- `PLACEHOLDER_NAME_PATTERN` (`names.ts`) is used verbatim by the migration and
  by `prunePlaceholderPersons`; `tests/calicotab.names.test.ts` holds the
  migration to it. Write it only in the regex subset JS and Postgres share
  (JS and Postgres gave identical verdicts on all 14,648 corpus names), and
  keep the ASCII-only guard — `normalizePersonName` drops non-Latin scripts.
- Any change to the stage vocabulary needs `OutroundStage`, `JUDGE_STATS_RANK`,
  `STAGE_DISPLAY` and the depth view in `tests/corpusdb/checks.sql` together.
- Never derive `speakerScoreTotal`; field placement and the derived rank order
  by it.
- Round numbers for scores and motions must go through `roundNumbers.ts`, not
  the digit in a label.
- A check in `checks.sql` that passes is only as good as the check — read the
  header before trusting a zero.

---

## 2026-07-25 (later) — Seeded local data; migrations fixed; review items closed

**Branch:** merged to `main`. **Tests:** 658 passing (was 636).

### The project could not bootstrap a new database

`prisma migrate deploy` failed on any fresh database, and had done since
2026-05. Two "idempotent cleanup" migrations were only idempotent against the
exact production state they were written for:

- `20260428200000_person_disambiguation_cleanup` caught `duplicate_object`
  when adding a UNIQUE constraint. `ADD CONSTRAINT ... UNIQUE` builds an
  index, so the collision raises `duplicate_table` (42P07) — a code the
  handler never sees. It also added a *constraint* where `init` had created
  an *index*.
- `20260524130000_restore_gmailtoken_constraints` added
  `GmailToken_userId_key` unguarded, assuming an orphan migration (applied to
  prod, absent from this repo) had dropped it first.

Both now use `CREATE UNIQUE INDEX IF NOT EXISTS`, which no-ops on production
and restores the index on a fresh database. **Verified safe for prod:**
`migrate deploy` does not re-verify checksums of already-applied migrations
(tested), so editing them cannot trigger a re-run. This unblocks new Vercel
preview databases, local dev, and restore-from-schema.

### Local data (`npm run seed:dev`)

`scripts/seed-dev-data.mjs` seeds 14 tournaments, ~1,300 people, full speaker
fields, per-round scores, team results, 110 motions and a signed-in session
token. Deterministic (fixed-seed LCG), refuses to run off localhost. The
dataset is deliberately awkward — see the header comment; every edge case
maps to a display branch. Setup is documented in `CLAUDE.md`.

### What rendering against it exposed (all fixed)

| Defect | Detail |
|---|---|
| Percentile chart plotted on a −4…104 axis | A bounded series was auto-fitting its domain. `TrendChart` now takes `domain`. |
| 11 x-axis labels overlapped into a smear | Labels thin past 8 points; the percentile chart labels by year. |
| Baseline label overprinted a data point | Now placed at whichever end has the most clearance, on the far side of that end's point. |
| Self-contradictory field row: "+3.4 above the field mean, placed 89th of 89" | A partial draw. Placement ranks on TOTAL score so a missed round sinks it while the average is untouched. `CvFieldStat` now carries `userScoredRounds`/`prelimRoundCount`; such rows are flagged in the UI and excluded from the career aggregates. |
| Field figures blank whenever `prelimRoundCount` was unknown | `pickPrelimRoundCount` gained a third source: `MAX(SpeakerRoundScore.roundNumber)` across the tab (one aggregate query, no rows transferred). |
| "Hart House IV 2023 2023" | Highlights appended the year to names that already contained it. |
| "−0.0" and "+0pp" in the splits tables | Signed zeros — now signed by what the value rounds to. |
| Motions from judged tournaments were invisible | The join went through speaker rows only. Judged tournaments now appear, marked, and excluded from "debated" counts. |

### Also closed from the review

- **`buildCvData` round trips: 7 → 4.** Measured over a 6ms-RTT link
  (a latency-injecting TCP proxy in front of Postgres): **215ms → 161ms**.
  No gain on loopback — the benefit is proportional to network RTT, which is
  what production actually has.
- `pickHeaderMetrics` → `lib/cv/headerMetrics.ts`, `buildMotionEntries` →
  `lib/cv/motionEntries.ts`, both now unit-tested (14 new tests).
- `loading.tsx` for `/cv/stats` and `/cv/motions`.
- `resetPrismaMock` now defaults `$queryRaw`/`$executeRaw` to `[]`/`0` — a
  bare `mockReset()` returned `undefined` and blew up any raw-query caller.

### Still open

- The speaking ledger still scrolls horizontally below ~1320px (it fits at
  1440 now). Mobile gets cards, so this only bites 13" laptops.

---

## 2026-07-25 — Front-end rebuild ("Ledger"), motions surfaced, statistics engine

**Branch:** `claude/frontend-rebuild-motions-stats-yuzub3`
**Test baseline:** 636 vitest tests passing (was 604); typecheck / lint / `next build` clean.
**Migrations:** none. This session is display + pure-computation only; no schema change, no `PARSER_VERSION` bump, no re-ingest required.

### What shipped

| Area | What exists now | Key files |
|---|---|---|
| Design language | Replaced "Tab Room Terminal" with **Ledger** — a bank/brokerage-statement register. New token layer (cool-white/graphite canvas, hairline rules, one emerald accent, `pos`/`neg` directional colours, `surface`/`surface-2`/`surface-3` tiers), `.ledger` table mechanics, `.data-label` / `.eyebrow` / `.figure` / `.num` type roles, tabular numerals as a base rule. All editorial signatures (serif italic headings, drop caps, "Vol." kickers, pull quotes) removed; `font-serif` swept out of 24 files. Legacy `ink`/`paper`/`oxblood` aliases kept and re-pointed. | `app/globals.css`, `tailwind.config.ts`, `docs/DESIGN_INSTRUCTIONS.md` §6 |
| New primitives | `StatTile`/`StatRow`/`DeltaChip`, `DataTable` (`Table`/`Th`/`Td`/`Tr`/`Nil`/`TableScroll`), `Sparkline`, `Meter`, `Histogram`, `SectionHeader`. `TrendChart` rewritten (gridlines, gradient area, baseline marker). Button/Card/Badge/EmptyState/NavLink/BrandMark/CvSubNav restyled. | `components/ui/*`, `components/CvSubNav.tsx` |
| Motions end-to-end | Motions were scraped since `20260611.0` but never displayed. `buildCvData` now carries text/roundLabel/seq/infoSlide; the CV row expands into a **round ledger** (round · side · motion · score · points · result); new **`/cv/motions`** lists every motion joined to the round the user debated it in, with info slides and tags. | `lib/cv/buildCvData.ts`, `app/(app)/cv/page.tsx`, `app/(app)/cv/motions/page.tsx` |
| Field context (new data) | `buildCvData` now summarises the FIELD per tournament from every published speaker's score total: speaker count, field mean/median/p90/σ in score units, and how many finished above the user. This is what makes "18th of 412" and a placement percentile possible. Totals-only projection on purpose — per-round field data would be an order of magnitude larger. | `CvFieldStat` in `lib/cv/buildCvData.ts` |
| Statistics engine | `lib/cv/speakerStats.ts` — pure, 26 unit tests. Score profile (mean/median/σ/IQR/p10–p90/histogram/best+worst speech with its motion), field placement (Δ, z, percentile, placement), round dynamics (per-round profile, opening vs closing, OLS slope, within-event σ), results (win rate, BP points distribution, streaks across the career, break rate, finals/titles, deepest outround), splits by seat / motion stem / topic / format / region / field-size bucket / season each with a delta against the user's own baseline, partner splits, and auto-derived findings that must contain their number and clear a sample floor. | `lib/cv/speakerStats.ts`, `tests/cv.speakerStats.test.ts` |
| Surfaces | `/cv` rebuilt (account header, KPI strip, ledger tables, per-round detail). `/cv/analytics` → permanent redirect to new **`/cv/stats`**. `/u/<slug>` rebuilt with a summary strip. Landing + `/sample` rebuilt with a statistics showcase and a preview built from the real primitives. Imports, settings, tags, verify, onboarding, admin restyled. Header nav is now Record · Statistics · Imports · Settings, with a mobile strip instead of a hamburger. | `app/(app)/cv/**`, `app/u/[slug]/page.tsx`, `app/page.tsx`, `app/sample/page.tsx`, `app/(app)/layout.tsx` |

### Notes for whoever picks this up

- **Nothing here needs a re-ingest**, but the new surfaces are much richer on tournaments ingested since `PARSER_VERSION 20260611.0` (positions + motions). The operator checklist item "Re-ingest all" below is now worth more than it was.
- Field figures in score units divide the tab's score *totals* by the prelim round count — exact when everyone spoke every round, slightly low otherwise. The rank-based placement carries no such assumption and both are shown; the page says so.
- Motion joins are by `(tournament, round)`. Rounds that released several motions credit all of them and are flagged in the UI — there is no per-room draw data to disambiguate.
- Findings ("quirks") are suppressed below `MIN_QUIRK_ROUNDS` / `MIN_QUIRK_TOURNAMENTS`. If a user reports "my stats page says nothing", that is usually the sample floors doing their job, not a bug.

---

**Date:** 2026-06-11 (supersedes the 2026-05-24 handoff; unresolved items from it are carried forward below)
**Last commit on `main`:** `b439ed1 feat(ingest): harden ingest-once invariant + free 15-min queue drain`
**Test baseline:** 604 vitest tests passing; typecheck/lint/`next build` clean.
**Production:** Vercel + Neon Postgres. Five migrations shipped this session (`20260611*`), all additive / `IF NOT EXISTS`-guarded, applied automatically at deploy via `migrate-if-configured.mjs`.

> Read `CLAUDE.md` first for conventions — this doc is status only.

---

## What shipped this session (2026-06-11, all on `main`)

| Area | What exists now | Key files |
|---|---|---|
| Analytics | `/cv/stats` (`/cv/analytics` permanently redirects there): speaker avg by season, round-by-round profile, break record, by-seat, by-format, by-region, by-motion (type + topic), judging trend. Pure aggregation over `buildCvData` rows; coverage notes on thin samples; hand-rolled SVG charts (no chart lib). `computeCvAnalytics` was deleted 2026-07-25 — it duplicated seven of `computeSpeakerStats`'s splits in a weaker shape and the page rendered only the two season trends, which now live on `stats.seasons` / `stats.judgingSeasons`. | `lib/cv/speakerStats.ts`, `components/ui/TrendChart.tsx`, `components/ui/BarList.tsx` |
| Configurable export | `GET /api/cv/export?format=csv\|xlsx&fields=...` driven by one field registry; "Export" picker popover on `/cv` with localStorage prefs; XLSX via exceljs (one sheet per role). Bare GET = legacy CSV. **Column order is append-only.** | `lib/cv/exportFields.ts`, `components/CvExportButton.tsx` |
| Parser expansion | Motions tab scraped (3 markup generations), per-round team positions persisted (`TeamResult.position` — was parsed-and-discarded before), gzipped raw HTML retained (`SourceDocument.bodyGzip`, 5MB raw cap) so future fields can re-derive from storage. `PARSER_VERSION = '20260611.0'`. | `lib/calicotab/parseMotions.ts`, `ingest.ts`, `fetch.ts`, `version.ts` |
| Moderated tags | Fixed vocabularies: REGIONS; MOTION_TYPES (stems THBT/THW/THS/THO/THR/THP/Other); MOTION_TOPICS (14 subject areas). Users propose at `/cv/tags` (only for tournaments on their CV), admins review at `/admin/tags`; **only approval writes canonical columns** (`Tournament.region`, `Motion.motionType/topic`). `TagProposal` = queue + audit trail; one live proposal per (user, kind, target). | `lib/tags/vocabulary.ts`, `app/api/tags/propose/`, `app/api/admin/tag-proposals/`, `components/TagProposalControls.tsx`, `components/AdminTagProposals.tsx` |
| Haiku classifier | `/admin/tags` → "Suggest motion tags (Haiku)" → `POST /api/admin/tags/classify`: claude-haiku-4-5 via `@anthropic-ai/sdk`, structured outputs constrained to the vocabulary, re-validated with zod; files PENDING proposals authored by the admin (approval gate intact). 40 motions/click, reports backlog. 503 without `ANTHROPIC_API_KEY` — feature is optional. | `lib/tags/classifyMotions.ts`, `app/api/admin/tags/classify/route.ts` |
| DB hygiene (audit-driven) | Dropped verified-dead columns (`TeamResult.losses`, `TournamentParticipant.wins`); `SpeakerRoundScore.positionLabel` NOT NULL DEFAULT `''` (was a NULL-in-unique-key hazard); JudgeAssignment round_results writer = atomic deduped replace (was findFirst+create TOCTOU); motion writes = id-preserving upserts (protects TagProposal audit rows); composite indexes `(userId, status)` on IngestJob + CvErrorReport; dropped redundant DiscoveredUrl `(userId)` index; `@updatedAt` on IngestJob/DiscoveredUrl. Kept deliberately (documented in schema comments): `DiscoveredUrl.subject/token/tournamentSlug` (in the account data export), `EliminationResult.result` dual history. | migrations `20260611150000`, `20260611160000`; `lib/queue.ts` |
| Legacy rank:N | Break-page rows no longer write `rank:N` into `EliminationResult.result` (verified unread); historical rows nulled; break upsert has empty `update` so it can't clobber won/lost. | `ingest.ts`, migration `20260611160000` |
| Retention | `pruneIngestArtifacts()` at end of cron drain, **gated to the 03:00 UTC hour**: 90-day retention; always keeps newest SourceDocument per URL (raw-HTML archive) and each doc's latest successful ParserRun (load-bearing for cache freshness + /cv/verify + admin parser health). | `lib/calicotab/provenance.ts`, `app/api/cron/process-queue/route.ts` |
| Ingest-once hardening | (a) `Tournament.parserVersion` — tournament-scoped cache check; fixed real bug where a 2nd user's first touch of a cached tournament always full-re-scraped (old check was per-landing-SourceDocument). (b) `candidateFingerprints()` probes year/null/year±1 when year was inferred from email date → year-boundary duplicates converge on one row; explicit-year names get exactly one candidate. (c) `Tournament.scrapeClaimedAt` claim (conditional UPDATE, 2-min TTL, 15s bounded wait) so concurrent cache-miss ingests don't both run the ~16-fetch tab phase. | `lib/calicotab/fingerprint.ts`, `ingest.ts`, migration `20260611170000` |
| UI/UX pass (2026-06-11, late) | Three-agent audit (inventory, nav/IA, visual consistency) then implemented with owner sign-off: CvSubNav tab bar (Record/Analytics/Tags/Verify) replacing the buried "More" dropdown + footnote-only Tags path; /cv actions 4→2 (Share + merged Download popover = print-to-PDF + column-picker export; CvExportButton→CvDownloadButton); Dashboard renamed "Imports" with calm summary default (URL table behind ?filter=, editorial table style, dupes removed, Export-errors→/admin, AutoScanOnVisit on /cv only); conditional Admin NavLink (isAdminEmail in lib/admin.ts); app-wide editorial-token migration (new text-ui 14px token, Button/Badge/StatusPill/popovers/settings/verify/onboarding/admin off raw px + shadcn family, secondary Button variant = deprecated alias of outline, admin pages aligned to max-w-5xl). | `components/CvSubNav.tsx`, `CvDownloadButton.tsx`, `app/(app)/dashboard/page.tsx`, `tailwind.config.ts` |
| Free 15-min drain | `.github/workflows/drain-queue.yml` curls `POST /api/cron/process-queue` every 15 min (GH Actions schedules are free; Vercel Hobby crons are daily-only). Needs **repository** secrets `APP_URL` + `CRON_SECRET`; no-ops green until set; concurrency-grouped. Vercel 03:00 cron = guaranteed backstop + owns the prune. | `.github/workflows/drain-queue.yml` |

### Ingestion dedup audit — verdict (2026-06-11)

The "ingest once, extract thereafter" invariant **holds** across all three entry paths (admin re-queue, user private URL / Gmail scan, name-only claiming — the last never scrapes). Cache hit = 1 landing fetch + ~6 DB ops, no tab fetches; full scrape only on >30-day staleness, parser-version change, round-count growth, or `force`. Residual known gaps (deliberate, low-frequency): duplicate Tournament rows possible if the same event is served from two hostnames or renamed mid-event on the tab site. Conclusions are encoded as code comments in `ingest.ts` and `fingerprint.ts`.

---

## Operator checklist (human steps — check off as completed)

- [ ] Verify Vercel deploy of `b439ed1` green; five `20260611*` migrations applied; smoke-check `/cv/analytics`, `/cv/tags`, `/admin/tags`, Export button on `/cv`.
- [ ] Add GitHub **repository** secrets `CRON_SECRET` + `APP_URL` (Settings → Secrets and variables → Actions → *Repository* secrets — NOT environment secrets; the workflow job has no `environment:` key and would skip silently). Verify: Actions → "Drain ingest queue" → Run workflow → step prints JSON. **Until this is done, the queue still only drains daily at 03:00 UTC.**
- [ ] (Optional) `ANTHROPIC_API_KEY` in Vercel env → enables the Haiku classifier button.
- [ ] `/admin` → **Re-ingest all** to backfill positions/motions under the new parser version. Dead Heroku tabs going `abandoned` is expected.
- [ ] After backfill: `/admin/tags` → run the Haiku classifier until backlog clear + approve; set regions at `/cv/tags` + approve. Region/motion analytics sections appear once approved tags exist.

## Next steps for the next agent (priority order)

1. **Auto-drain after scan** (discussed + accepted in spirit, NOT yet built): `components/AutoScanOnVisit.tsx` already knows when a scan found new URLs — chain it into the same `/api/ingest/drain` loop the dashboard's "Ingest all" button uses (see `DashboardActions`), so on-page users see tournaments appear live instead of waiting ≤15 min for the GH tick. Client-side only.
2. **Admin tournament-merge tool** for the residual duplicate cases (host change, mid-event rename — see audit verdict above).
3. **Region auto-suggestion**: parse the institutions page (`nav.institutions` is discovered but never fetched) → majority institution country → region, filed as a pre-filled TagProposal through the same moderation flow as the Haiku classifier.
4. **Speaker order within a round** (1st vs 2nd speaker): needs per-ballot pages — deliberately not scraped; build only on real user demand.
5. **Post-rollout watches**: Sentry `stage: 'prune'` + ingest errors; Neon storage growth from `bodyGzip` (knob: `RETENTION_DAYS` in `lib/calicotab/provenance.ts`).

## Landmines / invariants (read before touching)

- `PARSER_VERSION` bump = fleet-wide re-scrape. Bundle parser changes; never bump casually.
- Export field registry / CSV columns: **append-only** (positional consumers).
- Tag vocabularies: **append-mostly** — rename/removal needs a data migration for approved rows.
- The scrape claim is a conditional UPDATE on purpose — session-level advisory locks are unsafe on the pgbouncer-pooled connection. The tx-scoped `pg_advisory_xact_lock` in the write phase is fine. Don't merge the two.
- Prune must keep: newest SourceDocument per URL + latest successful ParserRun per doc.
- Queue lock ordering: rerun `tests/calicotab.deadlock.test.ts` after touching `lib/queue.ts` or the ingest tx.
- Raw SQL UPDATEs on IngestJob/DiscoveredUrl must set `"updatedAt" = NOW()` (Prisma `@updatedAt` fires only on client ops).

---

## Carried forward from the 2026-05-24 handoff (status unknown — verify before assuming)

1. **Reconnect Gmail token write** — was broken (OAuth consent completes but `GmailToken` row not written; diagnostic logging shipped in `lib/auth.ts` on `65d4915`). Not touched this session. If still broken: pull Vercel runtime logs for `auth.signIn` / `auth.linkAccount` traces and branch per the diagnosis table in the 2026-05-24 handoff (git history of this file).
2. **Two orphan migrations in prod** (`20260428100000_person_disambiguation`, `20260512000000_multi_gmail_tokens`) — in `_prisma_migrations` but not in the repo; `prisma migrate status` exits 1, `migrate deploy` unaffected.
3. **Cloudflare blanket-blocked ingests** (`iitmpd`, `sbsdebate`) — may need FlareSolverr on Oracle Always-Free if recurring (ScraperAPI rejected: must be truly free).
4. **Deploy pipeline improvement** — move `prisma migrate deploy` out of `npm run build` into a gated separate step (a failed migration inside build blocks all deploys until manual `prisma migrate resolve`). Recovery path exists: `.github/workflows/prisma-resolve.yml`.
5. Minor UI advisories from the editorial-redesign review (dead `mono`/`accent` props, Failed-tile hint when count is 0, `enqueueUrl` doesn't reset `abandoned → pending`).

## Reference locations

- Repo: `https://github.com/DrftingWood/debate_cv` (npm-only; owner often works from Windows/PowerShell or mobile)
- Vercel project: `prj_zFvbnnORfRVVayf5TBs2Lh1xZBDo` (team `team_rwui4f7Nb7InhcNLs5v9BowM`)
- Failed-migration recovery: run `.github/workflows/prisma-resolve.yml` with `migration_name` + `action`, then redeploy.

## User preferences

- **Truly free infrastructure only** — no freemium/trial tiers dressed up as free.
- Design language: **Tab Room Terminal** (owner-directed retheme 2026-06-11, replacing the locked editorial theme): dark green-black terminal + phosphor #3DDC84 accent with a light "ballot paper" mode; Space Grotesk display (fills the old font-serif slot), IBM Plex Mono numerals via `.num`/`font-mono`, Inter body. Theme = `data-theme` on <html> (inline no-FOUC script in app/layout.tsx, ThemeToggle in the app header, localStorage + OS fallback). Public CV (/u) and print are FORCED light — credential artifacts must not depend on viewer theme. Token NAMES kept (ink/paper/oxblood = fg/bg/accent contract); only values moved.
- Prefers tight, decisive options over open-ended discussion; uses sub-agents deliberately (Haiku for context reads, Sonnet for parsing tasks).

---

## How to resume in the next session

Paste this to start:

> Resume from `docs/HANDOFF.md` — read the 2026-09-15 entry at the top first (corpus-driven parser overhaul, round nomenclature, stand-in names), then 2026-07-25 (front-end, statistics engine) and 2026-06-11 (pipeline state). Confirm the 2026-09-15 operator checklist with me (migrations visible in schema-probe? re-ingest-all run? drain secrets set?) before picking up new work.
