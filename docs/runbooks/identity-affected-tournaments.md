# Runbook: which tournaments the identity phase 7 re-ingest needs

Owner-run. First run on the real export (2026-10, before (b) was split into classes): 855 tournaments with a tab page, 238 affected; (a) 23 tournaments / 44 names, (b) 219 tournaments / 431 groups. Re-run for the split. Design: `docs/superpowers/specs/2026-10-27-person-identity-option-b-design.md`, section 10, phase 7, and open question 1 ("first measure how often...").

**What it answers.** Phase 7 changes two things about how ingest handles names. The spec expects this to need a `PARSER_VERSION` bump and a re-ingest of every tournament. This check counts the tournaments where either change would make any difference, so you can see the real size of the re-ingest:

- **(a) Lost names.** The name has letters, but its current key (`normalizePersonName`, `lib/calicotab/fingerprint.ts`) is empty: "李明", "Иван". `preCommitPersons` skips the name (`lib/calicotab/ingest.ts`, `if (!norm) continue`), so the person has no participant row at all.
- **(b) Merged entries.** Two or more different entries in one list at one tournament share a key, and ingest keeps them as one participant. The cases are namesakes, "José Silva" / "Jose Silva", and "王欣月2" / "李明2" (both key to "2"). The merge happens in two places: the participants-list merge in `ingest.ts` (the `participantByName` map, about lines 965-982) and the `(tournamentId, personId)` unique key on `TournamentParticipant`. Not every shared key is a lost person, so each one is put in one of three classes (below), and only the first makes a tournament affected.

### The three classes of (b)

What ingest actually writes, from `lib/calicotab/ingest.ts`:

- Speakers come from the speaker tab only. Each row is upserted on `(tournamentId, personId)`, so two rows with one key end as one `TournamentParticipant`; the second overwrites the first's team, rank and total.
- Judges come from the participants list (the HTML page, or the API list in its place) only, after `participantByName` has collapsed it to one row per key. `Map.set` keeps the **last** row with a key, and only rows still marked adjudicator get a judge role.
- Roles live in `ParticipantRole`, keyed `(tournamentParticipantId, role)`. So one participant holding both `speaker` and `judge` is part of the model, not a collision.

So:

| Class | What it is | Counted as affected? |
| --- | --- | --- |
| **same-role** (real namesake collision) | Two speaker rows, or two adjudicator rows, with one key and a different team or institution. One of the two people is lost or overwritten today. | **Yes** |
| **cross-role** | One key on a speaker row and an adjudicator (or other) row, with no same-role pair. ingest gives one participant two roles, before and after phase 7. Whether the rows are one human or two cannot be told from the key. | No |
| **duplicate** | The same role with the same team and institution: one person listed twice, not a namesake. | No |

A key that shows several classes in different lists takes the strongest (same-role, then cross-role, then duplicate).

**A separate finding: judge role dropped.** Tabbycat lists the Adjudicators table before the Speakers table. When a judge and a speaker share a key there, `participantByName` keeps the speaker row, so ingest writes **no** judge role for that key. A person who both spoke and judged loses the judge credit on their CV today, with or without a namesake. This is a v1 bug in the participants merge, not something phase 7's key change fixes, so it is reported (`judge_role_dropped`) but does not make a tournament affected. The API participants list puts adjudicators last, so tournaments read through the API do not lose it.

**What it does not do.** It does not connect to a database or the network, and it never writes outside the two output files. It reads the export folder that `scripts/export-source-documents.mjs` wrote (`*.html.gz` and `index.jsonl`). It runs the ingest parsers unchanged (`parseTeamTab`, `parseSpeakerTab`, `parseParticipantsList`, and `mapParticipants` for stored API JSON). The counting rules are in `lib/identity/affectedTournaments.ts`; tests are in `tests/identity.affectedTournaments.test.ts`.

## 1. Run it (PowerShell)

From a checkout of `main` with `npm ci` done:

```powershell
cd "C:\Users\achar\Documents\6. Projects\2. Debate CV\debate_cv"
node scripts/find-identity-affected-tournaments.mjs --in "$HOME\Documents\source-docs"
```

- `--in` defaults to `$HOME\Documents\source-docs`, so you can leave it out if the export is there.
- It writes two files into the export folder, not into the repository, because they contain participants' names:
  - `identity-affected-tournaments.csv` has one row per tournament, affected ones first. It opens in Excel with non-Latin names intact.
  - `identity-affected-tournaments.txt` lists the affected tournament URLs, one per line. Step 3 takes this file as input.
- Use `--out <file>` and `--list <file>` to write them somewhere else.
- It takes a minute or two for a few thousand pages, and you can run it as often as you like.

The summary at the end is the number you need:

```
Documents in index:              <documents>
  distinct document URLs:        ...
Tournament URLs with a tab page: <total> (on <hosts> hosts)
  slug case and http/https folded: ...
  of which API-only next to a root-hosted tab: ... (so about ... tournaments)

Tournaments with a tab page:     <total>
Affected (a or real collision):  <N> of <total>
  (a) names with an empty key:   ... tournaments, ... names
  (b) shared key in one list:    ... tournaments, ... groups
      real namesake collisions:  ... tournaments, ... groups
      cross-role:                ... tournaments, ... groups
      duplicate rows:            ... tournaments, ... groups
  judge role dropped by the participants merge: ... tournaments, ... groups
```

`Affected` is (a) or **real namesake collisions**, and the `.txt` list holds exactly those tournaments. The `(b) shared key` line is the old, over-counting total; its three class lines add up to it. Everything above the blank line is printed only and never written to a file.

### Why the export total is not the `Tournament` count

The total counts tournament **addresses** in the export (`https://host/slug/`), not rows in `Tournament`, and the two are built differently. From the code, not guessed:

- **Documents outlive, and predate, tournament rows.** `storeSourceDocument` (`lib/calicotab/fetch.ts`) writes the `SourceDocument` at fetch time, before the write transaction, and `SourceDocument` has no link to `Tournament`. So pages fetched by an ingest or pre-scrape that then failed, hit the regression guard, or wrote nothing, are in the export with no tournament row. Deleting a tournament (the B9 partial rollback, a manual delete) leaves its documents too. This is the likely cause of most of a large gap, and the script cannot measure it offline.
- **One tournament, several addresses.** `index.jsonl` holds one line per stored document: `{id, url, status, contentHash, contentLength, fetchedAt, file}`, with no tournament id. The script groups lines by the address in the URL, keeping the slug's case and the scheme. A tournament is found again in the database by a fingerprint of host, lower-cased slug, name and year (`lib/calicotab/fingerprint.ts`), or by host and slug case-insensitively on either scheme (`findTournamentByHostSlug`). The `slug case and http/https folded` line applies the same folding.
- **Root-hosted sites split in two.** A tournament at the site root (`https://host/tab/team/`) is keyed `https://host/`, while its stored API JSON is keyed `https://host/<slug>/` (the API path names the slug). The `API-only next to a root-hosted tab` line counts these second addresses; `so about` subtracts them.
- **Not a cause:** host aliases (`x.herokuapp.com` and `x.calicotab.com`). The fingerprint includes the host, so the database also holds them as two tournaments.
- **The other direction:** tournaments whose bodies were never stored (bodies are off by default) are in the database but not the export, and one address can hold two `Tournament` rows when the year was inferred differently (`candidateFingerprints`).

To compare exactly, run in the Neon SQL editor (read-only) and diff against the export's addresses:

```sql
SELECT count(DISTINCT lower(substring("sourceUrlRaw" from '^https?://([^/]+/[^/]*)'))) FROM "Tournament";
```

### CSV columns

| Column | Meaning |
| --- | --- |
| `tournament_url` | Public tournament address `https://host/slug/`. It is the same value as `Tournament.sourceUrlRaw`, and the same input the pre-scrape runner takes. The export has no tournament id (`index.jsonl` holds URLs only), so step 3 finds the id from this URL. |
| `affected` | true if (a) or `same_role_groups` is non-zero. |
| `empty_key_names` | (a): distinct raw names with letters and an empty key. |
| `shared_key_groups` | (b): the number of keys that two or more entries share, all classes. |
| `shared_key_entries` | The total number of entries in those groups. |
| `same_role_groups` | (b) real namesake collisions. Each is a person who loses a row or has their scores overwritten. |
| `cross_role_groups` | (b) speaker and judge on one key. Not counted. |
| `duplicate_groups` | (b) one person listed twice. Not counted. |
| `judge_role_dropped` | Keys whose judge role the participants merge drops (any class). Not counted. |
| `empty_key_examples`, `shared_key_examples` | Up to five of each, real collisions first. A shared example reads `José Silva / Jos Silva (x2, cross-role, participants)`: the spellings, how many entries, the class, and which list showed it. |
| `pages_read` | Which stored pages were found: `teamTab speakerTab participants apiTeams apiAdjudicators`. |
| `error` | A parser failure on this tournament. The row then counts as not affected, so check it by hand. |

### How to read the numbers

- **(b) is judged within one list at a time.** The lists are the team-tab rosters, the speaker tab, the participants list and the API participants. Tabbycat names each person once per list, so two rows with one key in one list are two entries. The same person also appears in every list, so matching across lists would count everyone. Rows identical in every field count once, so a page read twice does not create a namesake.
- **Left out of (b):** redacted names ("&lt;em&gt;Redacted&lt;/em&gt;", "Anonymous") and stand-ins ("Speaker 1", "Swing 2"). They share a key by design, and ingest already handles them (`lib/calicotab/names.ts`).
- **Left out of (a):** cells with no letters or digits ("—", "?"). They are not people.
- **What can still be off.** Speaker namesakes are also taken from the team-tab rosters and the participants list, which ingest does not write people from; they stand in for the speaker tab when it is missing from the export, and are the same namesakes when it is not. A speaker the tab lists under two different teams (a swing moved between teams) reads as two namesakes. Read the examples before acting on a borderline row.
- **Coverage.** The total is the number of tournaments that have a team tab, speaker tab or participants page in the export, not the number of rows in `Tournament` (see "Why the export total is not the `Tournament` count" above). These are not covered:
  - tournaments whose bodies were never stored. Bodies have been off by default since `STORE_SOURCE_BODIES`.
  - private-URL pages, which are excluded from the export by default.
  - judge names that appear only in round results.
  
  If many tournaments in the database are missing from the export, the result is a lower bound.

## 2. Before any re-ingest: what a re-ingest can and cannot fix

**Re-ingesting today changes nothing for (a) or (b).** Ingest uses the same normaliser, so a re-ingest produces the same merge and the same dropped names. The re-ingest only fixes them once the phase 7 code has shipped. That means the per-tournament entry key in place of `@@unique([tournamentId, personId])`, and names with an empty key no longer dropped. Run step 3 after that deploy, never before.

**Skipping the global `PARSER_VERSION` bump is only safe when phase 7 produces the same rows as today for every tournament not on the list.** By construction that holds for (a) and (b). It does not hold for the other half of phase 7, switching `Person.normalizedName` from v1 to v2 (accents folded, non-Latin letters kept). That changes the key of every accented name in every tournament, and it is a re-key and merge of the `Person` table. It is a data migration from `Person.displayName`, not a re-scrape, and it must run before step 3. Otherwise the re-ingested tournaments upsert v2 keys next to v1 rows that were never moved. Any new column phase 7 adds (the per-tournament entry key) will also be NULL on tournaments that are not re-ingested, so its readers and unique index must accept that.

## 3. Re-ingest the short list, one tournament at a time

The existing re-ingest paths are:

- **`/api/ingest/reingest-mine`** re-queues the signed-in user's own URLs.
- **`/api/admin/reingest-all`** re-queues every URL and marks every tournament stale.
- **The queue** never passes `force`.
- **`POST /api/ingest/url` with `{ url, force: true }`** is a forced ingest of a single tournament. It only accepts a **private URL** held by the signed-in user, and it must finish within one 60 s request. So it is useful only for a tournament where you yourself have a private URL.
- **The pre-scrape runner** re-scrapes any tournament named by its public URL. This is `prescrapeTournament` in `lib/calicotab/ingest.ts`, run by `tests/__prescrape.live.test.ts`. It runs on GitHub Actions (`.github/workflows/prescrape.yml`), because a laptop is too far from Neon (`docs/runbooks/B9-prescrape-load.md`). It reads public pages only, claims and links nothing, and runs the same tab and write phases as a user's ingest. **Use this one for the list.**

Put the list in the repository so the workflow can read it. It contains only public tournament addresses, no names:

```powershell
Copy-Item "$HOME\Documents\source-docs\identity-affected-tournaments.txt" scripts\prescrape\identity-phase7.txt
# delete any line you decided not to re-ingest, then commit and push it on a branch, merged to main
```

Then use one of the two options below. **Option A is recommended.**

### Option A: mark the listed tournaments stale, then run the normal load (regression guard on)

1. Neon SQL editor. Count first; the number must equal the number of lines in the list:

   ```sql
   SELECT id, name, "sourceUrlRaw" FROM "Tournament"
   WHERE "sourceUrlRaw" = ANY(ARRAY['https://a.calicotab.com/open26/', '...']);
   ```

   A URL that matches nothing was stored under another host (a `herokuapp.com` alias). Find it by slug and use the stored value.
2. Mark them stale. This is the same marker "Re-ingest all" writes, applied to these rows only:

   ```sql
   UPDATE "Tournament" SET "scrapedAt" = to_timestamp(0)
   WHERE "sourceUrlRaw" = ANY(ARRAY['https://a.calicotab.com/open26/', '...']);
   ```
3. Actions → **Pre-scrape (B9)** → Run workflow: mode `load`, list `scripts/prescrape/identity-phase7.txt`, shards `1` (or more for a long list), confirm `LOAD`, **force unticked**.

A stale tournament is re-scraped even at the current `PARSER_VERSION`; nothing else is touched. The regression guard stays on, so a tournament whose site now serves a degraded page (more than half the teams, participants or ranks missing) is reported `blocked` and keeps its stored data. A user who ingests one of these tournaments before the runner reaches it triggers the same re-scrape.

### Option B: force (the existing `force` path)

The same run with **force ticked** (`PRESCRAPE_FORCE=1`, which the workflow passes through to `prescrapeTournament(url, { force: true })`). It needs no SQL. But force **skips the regression guard** and always runs the tournament-wide refresh. If a listed site still answers its home page but its speaker tab now returns 404 or a degraded page, the stored results for that tournament are replaced with less. Only use force for tournaments whose pages you have just opened in a browser and found complete. If the home page is gone, the run fails before writing and nothing is lost.

## 4. What a single-tournament re-ingest rewrites, and what it costs

**It rewrites the whole tournament, not just the names.** In `writeIngestTransaction`, `prepareTournamentWideRefresh` deletes all of the tournament's `TeamResult`, `EliminationResult`, `SpeakerRoundScore` and `ParticipantRole` rows. It also deletes every `TournamentParticipant` whose person nobody has claimed and who has no judge rows. Then it writes everything again from the fresh pages: team results, speaker totals and round scores, participants and roles, break and elimination results, and motions. The runner then rewrites every judge's panels from the round results. Claimed participants and judges' private-URL history are kept. This happens under force, and without force whenever the fetch produced no warnings. So expect every number for those tournaments to be re-derived from the live site. A tab the organisers have corrected since the first scrape will show the correction.

**Cost per tournament.**

- **Fetches:** the landing page, team tab, speaker tab, participants list, motions, one page per result round and one per break tab. That is about 16 for a typical tournament, at least 400 ms apart per host. `estimateIngestMs` in `lib/calicotab/fetch.ts` puts it at about 21 s with the parse and write. Add the runner's 3 s pause: about **25 s per tournament**, so about 4 minutes for 10 tournaments and about 40 minutes for 100, on one shard.
- **Storage:** rows are replaced, not added, so the net change is roughly zero. New `SourceDocument` rows are written only for pages whose content changed, and without bodies (off by default). One `ParserRun` is written per page. The daily prune removes the old ones.
- **Neon compute:** a fraction of a CU-hour for under 100 tournaments, against 100 a month on the free plan.
- **Users:** none are notified. Their CVs show the re-derived rows on the next page load.

Compare this with the full re-ingest that a `PARSER_VERSION` bump causes. That covers every stored tournament (hundreds after the B9 load, about 25 s each, so several hours of Actions time and every site fetched again), and it invalidates the cached parse of every user. If the summary in step 1 shows only a handful of affected tournaments, the short list is the cheaper route by roughly the ratio of the two counts.

## 5. Afterwards

- Run the step 3 count query again. `scrapedAt` should be recent for every listed tournament.
- Spot-check one tournament from (b) in the app: the two namesakes are now two participants.
- Spot-check one from (a): the non-Latin name is now listed.
- Delete `scripts/prescrape/identity-phase7.txt` in a follow-up commit, or keep it as the record of what was re-ingested.
