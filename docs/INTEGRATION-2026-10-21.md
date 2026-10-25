# Integration 2026-10-21: filterable stats, Tabbycat API, JSON Resume

Branch `integration/debate-2026-10-21`, cut from `main` at `c03cd47`. It lives in its own
worktree (`../debate_cv-integration`). The main checkout was clean and on
`feat/filterable-stats`, and it was not touched. **Nothing has been pushed or deployed.**

Approved plan: *enable the Tabbycat API in production after one local re-ingest; merge
feat/filterable-stats first, then feat/tabbycat-api and feat/json-resume.*

## 1. Merges

| Order | Commit | Merged | Branch tip | Conflicts |
|---|---|---|---|---|
| 1 | `1573ad3` | `feat/filterable-stats` (14 commits) | `ae31a1d` | none |
| 2 | `ee6079a` | `feat/tabbycat-api` (5 commits) | `47e884a` | none |
| 3 | `a4d2af0` | `feat/json-resume` (3 commits) | `a9638ee` | none |
| fix | `8b31fa1` | fix(tabbycat-api): an all-ghost round counts for nothing | — | — |

All three are `--no-ff`. There were no conflicts to resolve. `feat/tabbycat-api` and
`feat/json-resume` were both cut from `feat/filterable-stats` at `ae31a1d`, and they touch
different files. Tabbycat touches `lib/calicotab/ingest.ts`, `lib/calicotab/tabbycatApi.ts`,
`docs/HANDOFF.md` and tests. JSON Resume touches `app/cv.json`, `app/api/cv/export`,
`components/CvDownloadButton.tsx`, `lib/cv/jsonResume.ts`, `package.json`/lock (adds the
`ajv` devDependency) and tests.

`8b31fa1` is the one code change made on this branch. It fixes a bug found by the
re-ingest (§3). It is a separate commit, so it can be reverted or cherry-picked onto
`feat/tabbycat-api` on its own.

## 2. Checks (on `8b31fa1`)

| Check | Result |
|---|---|
| `npm run lint` | 0 errors, 1 warning (`scripts/test-scrape.mjs` unused `ROOT`; this was already there) |
| `npm run typecheck` | clean (exit 0) |
| `npm test` | **1,239 passed / 40 skipped**, 101 files passed, 15 skipped (live suites) |

Before the fix the count was 1,238 passed. The fix added one test. `npm run build` was
not run.

## 3. Local re-ingest: API mode vs HTML mode

**Setup.** A throwaway `postgres:16-alpine` container on `127.0.0.1:55440` held two
databases, `dcv_api` and `dcv_html`. Both got `prisma migrate deploy` (36 migrations). The
connection strings were in temporary env files in the session scratchpad. No repo `.env`
was read or written, and the driver refused to start on any host other than localhost. The
driver called the app's own `ingestPrivateUrl(url, userId, { force: true })`, the same
function `/api/ingest/url` uses. It ran once per database: with `TABBYCAT_API_TABS` unset
(API, the default) and with `TABBYCAT_API_TABS=0` (HTML). It then claimed the
registration person, standing in for the identity-review click, and ran `buildCvData`. The
private URLs came from the user's own files: the URL already committed in
`scripts/test-scrape.mjs`, and the ingest-error exports in `1. Exports and notes/`. Their
tokens are not repeated here.

**Results.**

| Tournament | User's role | API mode | HTML mode | Per-tab source (API mode) |
|---|---|---|---|---|
| ILNU RR 2026 | speaker | ingested, 16 teams / 41 people | same | team `api`, speaker `api` |
| WUDC 2024 | judge | ingested, 300 teams / 812 people | same | team `api`, speaker `api` |
| IIT Madras PD 2025 | — | fails: participants 403 | fails: team, speaker, participants 403 | both `private` (tabs not released) |
| SBS Debate 2026 | — | fails: participants 403 | fails: 3 tabs 403 | both `private` |
| HKPDS 2022, OxWSDC 2021 | — | fails: participants 403 | same | `html` (standings 401) |
| ASO Winter 2024 | — | landing timeout (transient) | speaker tab 403 | — |

These hosts fail in production too (see the 2026-05-23 errors export). The 403s come from
pages the tournament has not released. The API is not the cause.

**Differences, ILNU RR 2026.** None. 100 team results, 41 participants and 160 round
scores are identical, field by field.

**Differences, WUDC 2024, first run.** All 3,076 team results and every speaker's total,
published rank, categories and team matched. There were two differences:

1. **Three speakers got a round score the HTML tab leaves empty** (Kevin Hammill R8,
   Riko Mimura R6, Shihara Ferdinando R3). I checked the public API: in each case every
   speech in that round is flagged `ghost` (a lone ghost, or both halves of an
   iron-person pair). The mapping fell back to `speeches[0]` and so took a score that the
   published total excludes. The rounds then summed to more than the total, which would
   inflate those speakers' averages. **Fixed in `8b31fa1`.** A round with no counted
   speech is now null, with a regression test. On a fresh re-run after the fix, the round
   scores are identical (5,274 rows each).
2. **`speakerRankOpenDerived` differs for 288 of 808 participants.** The value comes from
   `ROW_NUMBER() OVER (ORDER BY speakerScoreTotal DESC, id ASC)`. Speakers on the same
   total are ordered by insertion, and the API lists speakers in a different order from
   the HTML tab. **No visible effect**: the CV uses it only when `speakerRankOpen` (the
   published rank) is null, and that happens for none of the 288. Both modes already
   number tied speakers arbitrarily. Not changed.

**`buildCvData` output is byte-identical between the modes** after the fix (1 speaking
row, ILNU RR 2026; 1 judging row, WUDC 2024).

**Speed.** About the same: WUDC took 51 s with the API and 45 s with HTML, ILNU 14 s and
10 s. This is a single run, and network jitter outweighs the difference.

**Other behaviour changes to know about** (by design in `feat/tabbycat-api`, confirmed
here):

- When a tournament's `/preferences` says a tab is unreleased, API mode fetches **neither**
  the API standings **nor** the HTML tab. In the runs above the participants page still
  failed, so the outcome matched HTML mode. If participants succeeds, though, such a
  tournament now ingests with zero team and speaker rows and no warning. Before, the HTML
  tab's 403 aborted the ingest, and the queue retried up to 3 times.
- A full API ingest makes about 6 more same-host requests. `FETCHES_PER_INGEST` was not
  changed.
- API-sourced tabs store no `SourceDocument` snapshot, so they leave the re-derivation
  archive. This is an open decision in HANDOFF.
- I did not re-run the live parity suite (`tests/__tabbycatApi.live.test.ts`). It had
  reported 0 diffs on WUDC 2024 before, so it does not exercise the all-ghost case. Look
  at that before trusting it as a gate.

## 4. Migrations and environment for production

- **Prisma migrations: none added** by any of the three branches. `prisma/` is unchanged
  from `main`. The newest migration is still `20260915000000_remove_placeholder_persons`.
- **`TABBYCAT_API_TABS`: confirmed on by default.** `tabbycatApiTabsEnabled()` returns
  `process.env.TABBYCAT_API_TABS !== '0'`. Leave it unset in Vercel to enable the API.
  Set it to `0` to switch back to HTML without a redeploy; an env change needs a redeploy
  on Vercel to take effect.
- `TABBYCAT_USER_AGENT` (optional, already in `.env.example`) now also applies to API
  requests.
- No new required env vars. `ajv` is a devDependency, used only by tests.
- `.env.example` does not document `TABBYCAT_API_TABS`. I did not edit it (no env files
  were touched). Add a line by hand if you want it listed.
- `PARSER_VERSION` is unchanged. Cached tournaments keep their HTML-derived rows until
  re-ingested.

## 5. Deploy checklist

Do these in order. Each step is for the owner. Nothing below has been done.

1. Review this branch: `git log --oneline c03cd47..integration/debate-2026-10-21`. Pay
   particular attention to `8b31fa1`.
2. Push it: `git push -u origin integration/debate-2026-10-21`. Open a PR into `main`.
3. In Vercel → Settings → Environment Variables, check that **no** `TABBYCAT_API_TABS`
   variable exists for Production (unset means the API is on). If one exists with value
   `0`, delete it, or keep it on purpose to ship with the API off.
4. Check the Vercel preview deployment of the PR. The build must pass, and
   `migrate-if-configured` should report that no migrations are pending (none are added).
5. On the preview, smoke-test `/cv`, `/cv/stats` (filters: partner, pairing, seat), the
   CSV/XLSX/JSON Resume downloads, and `/cv.json` while signed in (401 when signed out).
6. Merge the PR into `main`. The production build runs `prisma migrate deploy`, which is a
   no-op. Watch the build log.
7. In production, re-ingest **one** tournament with released tabs (Dashboard → Ingest now
   on a single row, or a forced `/api/ingest/url`). In the Vercel runtime logs, look for
   `[ingest] tabbycat api { teams: 'api', speakers: 'api' }`, then compare that
   tournament's `/cv` row with what it showed before.
8. Watch Sentry and the ingest-errors export for 24 h. Look for new `Aborting ingest`
   failures, or tournaments with 0 team or speaker rows.
9. Then run the pending `/admin → Re-ingest all` (the 2026-09-15 / 09-17 checklist item).
   It backfills formats from `feat/filterable-stats`, and it now reads team and speaker
   tabs from the API.
10. **Rollback:** set `TABBYCAT_API_TABS=0` in Vercel Production and redeploy. This
    restores HTML tab fetching with no code change. For a full rollback, revert the merge
    commit on `main`.
11. Afterwards: append a HANDOFF entry. Decide on the open questions there (request budget,
    API snapshots, and whether to fetch the HTML tab anyway when preferences say a tab is
    unreleased).
