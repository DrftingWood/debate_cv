# Runbook: which tournaments the identity phase 7 re-ingest needs

Owner-run. Earlier runs on the real export (855 tournaments with a tab page): 238 affected before (b) was split into classes; 146 with PR #171's classes (speaker+judge not counted). PR #176 then counted every speaker+judge pair as a collision. That rule has since been **refined by the owner** (below: "not in the same round"), and the check now compares rounds. Run on the 2026-10 export with this version: **158 of 855 affected**, **221 if every rounds-unknown group is counted too**; (a) 23 tournaments / 44 names; overlapping rounds 139 tournaments / 203 groups; disjoint speaker+judge 19 / 37; disjoint same role 10 / 12; rounds unknown 87 / 161; duplicates 14 / 18. **Re-run** it yourself (section 1) before acting on the list. Design: `docs/superpowers/specs/2026-10-27-person-identity-option-b-design.md`, section 10, phase 7, and open question 1 ("first measure how often...").

**What it answers.** Phase 7 changes two things about how ingest handles names. The spec expects this to need a `PARSER_VERSION` bump and a re-ingest of every tournament. This check counts the tournaments where either change would make any difference, so you can see the real size of the re-ingest:

- **(a) Lost names.** The name has letters, but its current key (`normalizePersonName`, `lib/calicotab/fingerprint.ts`) is empty: "李明", "Иван". `preCommitPersons` skips the name (`lib/calicotab/ingest.ts`, `if (!norm) continue`), so the person has no participant row at all.
- **(b) Merged entries.** Two or more different entries in one list at one tournament share a key, and ingest keeps them as one participant. The cases are namesakes, "José Silva" / "Jose Silva", and "王欣月2" / "李明2" (both key to "2"). The merge happens in two places: the participants-list merge in `ingest.ts` (the `participantByName` map, about lines 965-982) and the `(tournamentId, personId)` unique key on `TournamentParticipant`. A shared key is not always two people, so each one is put in a class (below) by comparing the rounds each entry was in.

### What ingest writes today

From `lib/calicotab/ingest.ts`:

- Speakers come from the speaker tab only. Each row is upserted on `(tournamentId, personId)`, so two rows with one key end as one `TournamentParticipant`; the second overwrites the first's team, rank and total.
- Judges come from the participants list (the HTML page, or the API list in its place) only, after `participantByName` has collapsed it to one row per key. `Map.set` keeps the **last** row with a key, and only rows still marked adjudicator get a judge role.
- Roles live in `ParticipantRole`, keyed `(tournamentParticipantId, role)`. The schema lets one participant hold both `speaker` and `judge`.

### The owner's rule: not in the same round

**A person cannot speak and judge in the same round.** Nor can they speak for two teams in one round, or sit on two panels in one round. They can do different things in different rounds: speak in the prelims and judge the outrounds, replace a missing speaker in one round, or (as an organiser or stop-gap) be entered on several "swing" teams so every room has its 4 teams (BP) or 2 (two-team formats). This replaces the earlier rule ("never both a speaker and a judge at one tournament") that PR #176 counted by.

So two entries with one key are judged by their **rounds**:

| Class | What it is | Counted as affected? |
| --- | --- | --- |
| **overlapping rounds** | Some round has both entries in it: two speaker entries both scored (or both teams drawn) in round N; a speaker entry in round N while the name judged round N; or two judges with the name on round N's results. **Two people.** One of them is lost or overwritten today. | **Yes** |
| **disjoint rounds, speaker and judge** | A speaker entry and a judge entry, both with known rounds, never in the same round: someone who spoke, then judged (often the outrounds). **Plausibly one person.** Not a collision. | No (but see "judge role lost" below) |
| **disjoint rounds, same role** | Two speaker entries on different teams (or two judge spellings) never in the same round: a swing, a replacement, an organiser filling rooms. **Plausibly one person.** | No |
| **rounds unknown** | At least one pair cannot be decided: one side has no round data in the export (below). Reported on its own. | Only in the second number, `Affected if unknown counted` |
| **duplicate** | The same role with the same team and institution: one person listed twice. | No |

Within one list, a group with several entries takes its strongest pair: any overlap, else any unknown, else disjoint. A key that shows several classes in different lists takes the strongest (overlap, unknown, disjoint, duplicate). Per-class tournament counts overlap; both `Affected` numbers are unions and count each tournament once.

**How `unknown` is counted.** It is not in `Affected` and not in the `.txt` list, because nothing shows two people. It is in `Affected if unknown counted`, the upper bound, and the CSV's `affected_if_unknown_counted` column marks those tournaments, so you can add any you want re-ingested to the list by hand after reading their examples.

**Where the rounds come from** (all from stored pages; no network):

- **A speaker entry:** its own speaker-tab row (the rounds with a score; a blank cell means the speaker did not speak that round), else a speaker-tab row with the same name key and team, else the rounds its **team** has a result in on the round-results pages (`/results/round/N/`). The team proxy assumes the listed speaker spoke whenever the team debated; a replaced speaker breaks that, so an overlap whose evidence says `team results` is a little weaker than one that says `speaker tab`.
- **Judges:** the adjudicator column of the round-results pages, by name key. Ingest stores no per-judge round list outside these pages, and the API `pairings` endpoint is not in the export.
- **Round names:** the landing page's nav ("Round 1A", "Quarterfinals"), as ingest reads it. A prelim compares by its number, so the halves of a split round (R1A, R1B) are **one round**; an outround by its stage and break category, so the Novice final and the Open final are two rounds.

**Limits, in the order they matter:**

- **Judge rounds exist only where results pages were stored.** No results page means every speaker+judge or judge+judge pair at that tournament is `unknown` (the summary's `Tournaments with no results page` line).
- **Two judges spelled identically.** `parseRoundResults` keeps one entry per name and panel role in a round, so two namesakes who both chaired round 3 read as one chair. Two judge entries with one spelling are therefore `unknown` unless some round shows the name twice (a chair and a panellist, or two spellings), which is an overlap.
- **Teams with no results.** Swing teams are often missing from the public results, and a withdrawn team has none, so a speaker on such a team has no rounds unless the speaker tab gives them: `unknown`.
- **Outround labels.** A speaker tab whose outround column reads "QF" and a nav that says "Quarterfinals" are matched through the stage lexicon; an unrecognised label compares only to itself.

**Same institution.** Each speaker+judge group (any class) is also marked by whether the speaker row and the judge row name the same institution: **same** (eyeball these; a data-entry slip is plausible), **different**, or **unknown** (one side names none; Tabbycat's Speakers table often shows a team and no institution). The flag does not change the class.

**Judge role dropped, and lost.** Tabbycat lists the Adjudicators table before the Speakers table. When a judge and a speaker share a key there, `participantByName` keeps the speaker row, so ingest writes **no** judge role for that key. On an **overlap** group that is the collision itself (the judge namesake loses their row). On a **disjoint speaker+judge** group it is one person losing their judge credit: a real ingest bug of its own, not a collision, counted as `judge_role_lost_one_person`. Phase 7's merge must keep both roles for such a person (spec, "The owner's rule"). Re-ingesting today does not fix it. The API participants list puts adjudicators last, so there the judge role is written.

**What it does not do.** It does not connect to a database or the network, and it never writes outside the two output files. It reads the export folder that `scripts/export-source-documents.mjs` wrote (`*.html.gz` and `index.jsonl`). It runs the ingest parsers unchanged (`parseTeamTab`, `parseSpeakerTab`, `parseParticipantsList`, `parseRoundResults`, `extractNavigation`, and `mapParticipants` for stored API JSON). The counting rules are in `lib/identity/affectedTournaments.ts`; tests are in `tests/identity.affectedTournaments.test.ts`.

## 1. Run it (PowerShell)

From a checkout of `main` with `npm ci` done:

```powershell
cd "C:\Users\achar\Documents\6. Projects\2. Debate CV\debate_cv"
node scripts/find-identity-affected-tournaments.mjs --in "$HOME\Documents\source-docs"
```

- `--in` defaults to `$HOME\Documents\source-docs`, so you can leave it out if the export is there.
- It writes two files into the export folder, not into the repository, because they contain participants' names:
  - `identity-affected-tournaments.csv` has one row per tournament: affected ones first, then those affected only if unknown groups count. It opens in Excel with non-Latin names intact.
  - `identity-affected-tournaments.txt` lists the affected tournament URLs (the strict number), one per line. Step 3 takes this file as input.
- Use `--out <file>` and `--list <file>` to write them somewhere else.
- It reads every stored results page too, so it takes about three minutes on the 26,000-document export. You can run it as often as you like.

The summary at the end is the number you need:

```
Documents in index:              <documents>
  distinct document URLs:        ...
Tournament URLs with a tab page: <total> (on <hosts> hosts)
  slug case and http/https folded: ...
  of which API-only next to a root-hosted tab: ... (so about ... tournaments)
  ...

Tournaments with a tab page:     <total>
Affected (a or overlapping rounds): <N> of <total>   (union; each tournament counted once; the .txt list)
Affected if unknown counted:     <M> of <total>   (upper bound: every rounds-unknown group taken as two people)
  (a) names with an empty key:   ... tournaments, ... names
  (b) shared key in one list:    ... tournaments, ... groups
      overlapping rounds:        ... tournaments, ... groups   (two people: counted)
        of which speaker+judge:  ... tournaments, ... groups
      disjoint rounds, plausibly one person (not counted):
        speaker and judge:       ... tournaments, ... groups   (spoke in some rounds, judged others)
        same role:               ... tournaments, ... groups   (swing, replacement, organiser on several teams)
      rounds unknown:            ... tournaments, ... groups   (one side has no per-round data; counted only in the upper bound)
      duplicate rows:            ... tournaments, ... groups   (same role, same team and institution; not counted)
  speaker+judge, same institution: ... tournaments, ... groups   (any class but duplicate; eyeball these)
  judge role dropped by the participants merge: ... tournaments, ... groups
    of which one plausible person (disjoint speaker+judge): ... tournaments, ... groups   (judge credit lost today: an ingest bug, not a collision)
Tournaments with no results page: ...   (judge rounds unknowable there)
Tournaments that failed to parse: ...
```

`Affected` is (a) or an overlapping-rounds group, and the `.txt` list holds exactly those tournaments. `Affected if unknown counted` adds the tournaments whose only uncertain groups are `unknown`. The `(b) shared key` line's groups are the sum of overlapping, disjoint (both kinds), unknown and duplicate. Everything above the blank line is printed only and never written to a file.

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
| `affected` | true if (a) or `overlap_groups` is non-zero. The `.txt` list. |
| `affected_if_unknown_counted` | true if `affected`, or `unknown_round_groups` is non-zero. The upper bound. |
| `empty_key_names` | (a): distinct raw names with letters and an empty key. |
| `shared_key_groups` | (b): the number of keys that two or more entries share, all classes. |
| `shared_key_entries` | The total number of entries in those groups. |
| `overlap_groups` | (b) entries in the same round: two people. Counted. |
| `disjoint_speaker_judge_groups` | A speaker and a judge entry in different rounds: plausibly one person who did both. Not counted. |
| `disjoint_same_role_groups` | One role, different teams or spellings, different rounds: plausibly a swing, replacement or organiser. Not counted. |
| `unknown_round_groups` | Some pair has no round data on one side. Counted only in `affected_if_unknown_counted`. |
| `duplicate_groups` | One person listed twice (same role, team and institution). Not counted. |
| `cross_role_same_institution` | Speaker+judge groups (any class but duplicate) whose two rows name the same institution. Eyeball these. |
| `judge_role_dropped` | Keys whose judge row the participants merge drops. |
| `judge_role_lost_one_person` | Of those, disjoint speaker+judge groups: one plausible person losing their judge credit today. |
| `results_pages` | Round-results pages read for this tournament. 0 means judge rounds are unknowable here. |
| `empty_key_examples`, `shared_key_examples` | Up to five of each; overlaps first, then unknown, disjoint, duplicate. A shared example reads `Dee Rao (x2, overlapping rounds, speaker+judge, different institution, participants)`: the spellings, how many entries, the class, the roles, the institution match for speaker+judge groups, and which list showed it. |
| `round_evidence` | One entry per shared example, in the same order, with rounds only (no names). Overlap: the first shared round and each side's source, `R2: speaker (team results) and judge (results)`. Disjoint: each side's rounds, `speaker R1-R5 (speaker tab); judge quarterfinal (results)`. Unknown: which side has no rounds, `no rounds for the judge`, or `one spelling, can't tell one judge from two`. |
| `pages_read` | Which stored pages were found: `teamTab speakerTab participants apiTeams apiAdjudicators`, then `landing` and `results:<n>`. |
| `error` | A parser failure on this tournament. The row then counts as not affected, so check it by hand. |

### How to read the numbers

- **(b) is judged within one list at a time.** The lists are the team-tab rosters, the speaker tab, the participants list and the API participants. Tabbycat names each person once per list and role, so two rows with one key in one list are two entries. The same person also appears in every list, so pairing across lists would count everyone. Rows identical in every field count once, so a page read twice does not create a namesake. Rounds, though, are looked up across pages: a participants-list speaker gets their rounds from the speaker tab or their team's results.
- **Left out of (b):** redacted names ("&lt;em&gt;Redacted&lt;/em&gt;", "Anonymous") and stand-ins ("Speaker 1", "Swing 2"). They share a key by design, and ingest already handles them (`lib/calicotab/names.ts`).
- **Left out of (a):** cells with no letters or digits ("—", "?"). They are not people.
- **What can still be off.** See "Limits" above. An overlap read off team results (not the speaker tab) assumes the listed speaker spoke whenever their team debated. A disjoint group is "plausibly" one person, not proven: two namesakes who happened never to share a round also read as disjoint. Read the examples and evidence before acting on a borderline row.
- **Coverage.** The total is the number of tournaments that have a team tab, speaker tab or participants page in the export, not the number of rows in `Tournament` (see "Why the export total is not the `Tournament` count" above). These are not covered:
  - tournaments whose bodies were never stored. Bodies have been off by default since `STORE_SOURCE_BODIES`.
  - private-URL pages, which are excluded from the export by default.
  - judge names that appear only in round results (they are used for rounds, but a judge on no list is never in a group).

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
