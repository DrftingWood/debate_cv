# Assumptions register: ingest, parsing and identity (2026-10-27)

Docs only. No code changed. Scope: `lib/calicotab/**`, `lib/identity/**`,
`lib/gmail/extract.ts` (and `run.ts` / `scanUser.ts`, which feed it),
`app/api/ingest/**`, `scripts/prescrape/**`, name normalisation, and the
tournament freshness / re-scrape rules. A second register covers CV, stats,
auth, privacy and operations, so those areas appear here only where ingest
writes the data they read.

Basis: `origin/main` at `8ab4509` (#179). All 106 merged PRs that touch these
paths were listed (`gh pr list --state merged --limit 300`); the bodies of the
ones that set a rule were read (#72/#73, #71, #108, #143, #144, #153, #158,
#174), and the code was read at the current revision. Line numbers are for
that revision.

## How to use this

Each entry has:

- **Says**: the assumption in plain language.
- **Where**: file:line.
- **Kind**: D = debate domain, T = Tabbycat data format, N = identity and names, L = limits and operations.
- **Source**: owner decision / owner statement / documentation (code comment, PR, spec) / UNVERIFIED guess.
- **If false**: what the code does then, with an example.
- **Check**: a query on stored data, a fixture, or a question for you.
- **Status**: confirmed by owner / contradicted by owner / unverified.

Strike the wrong ones. The question table at the end puts the open ones to
you as yes/no or one-line questions.

### The seven owner rules, checked against the code

| # | Owner rule | What the code does | Verdict |
|---|---|---|---|
| 1 | One person cannot speak and judge, speak for two teams, or sit on two panels in the same ROUND; across rounds it can be one person (speaker turned judge, organiser on swing teams) | The offline checker (`lib/identity/affectedTournaments.ts:54-90`) applies the rule. **Live ingest does not.** It merges everything with one normalised name into one Person and one participant, whatever the rounds (I40, I41, I42) | Followed offline, contradicted in ingest |
| 2 | No re-scrape by age; only when rounds or tabs are missing, or on force | `storedTournamentFresh` ignores age (`prescrape.ts:55-57`). A parser-version bump is a third trigger the rule does not name (I50). Some tournaments can never pass the check, so they re-scrape on every load (I47, I48) | Followed, with two gaps |
| 3 | Re-scrape only while result rounds are not fully released | Nav round count against stored round count (`ingest.ts:704-713`), plus released tabs (`:717-735`) | Followed. Motions released after the last round are never picked up (I49) |
| 4 | Only speaker stats are built; judge stats are separate | Derived speaker rank counts speaker-role rows only (`ingest.ts:1629-1648`). Judge history goes to `JudgeAssignment` | Followed |
| 5 | edudrift and wolce are Southeast Asia; 14 topics | `MOTION_TOPICS` has 14 entries (`lib/tags/vocabulary.ts:50-65`). edudrift and wolce are Southeast Asia in the approved tag data (HANDOFF line 17), not in code | Followed (in data) |
| 6 | Decision A: a registration name close to the Google profile name is acceptable proof of identity | Proximity is only displayed (`app/api/onboarding/names/route.ts:89`, "it blocks nothing"). Claims still need the user's tick, and nothing holds a `different` URL (I36, I37) | Not built. The code is stricter than the decision |
| 7 | Page bodies are not stored on the server | Bodies are written only when `STORE_SOURCE_BODIES=1` (`fetch.ts:446`). Bodies stored before #158 stay until the runbook clears them | Followed for new fetches (I58) |

---

## A. Debate domain

**I1. A BP team "won" a prelim only if it came first.**
Where: `parseTabs.ts:374-382` (`parseBpPlacing`: `won: place === 1`); API path `tabbycatApiRounds.ts:231` (`points === 3`).
Kind D. Source: documentation (code comment).
If false: anything that reads "won" as "took points" or "top half" undercounts. A team that came 2nd in every room has 0 wins. Points are stored separately (3/2/1/0), so nothing is lost; only what "won" means is.
Check: question Q11.
Status: unverified.

**I2. BP points are 4 minus the place (3/2/1/0).**
Where: `parseTabs.ts:381`.
Kind D. Source: documentation.
If false: a tournament that scores BP rooms differently (some schools events give 4/3/2/1 or score only a win) would have wrong per-round points. Only applies when the result cell gives a placing and no points column exists (`:901`).
Check: `SELECT DISTINCT points FROM "TeamResult" WHERE "roundNumber" > 0;` should hold only 0-3 for BP tournaments.
Status: unverified (standard WUDC rule).

**I3. In an outround, "advancing" means won and "eliminated" means lost.**
Where: `parseTabs.ts:418-428`.
Kind D/T. Source: documentation (PR #114 corpus audit).
If false: in a BP outround two teams advance, and both are recorded `won`. "Won the grand final" therefore needs the final itself, not "advanced". In a BP final Tabbycat may mark only one team, and anything that reads two `won` rows in a final as two champions would be wrong.
Check: `SELECT "tournamentId", stage, count(*) FROM "EliminationResult" WHERE result='won' AND stage ILIKE '%final%' AND stage NOT ILIKE '%semi%' AND stage NOT ILIKE '%quarter%' GROUP BY 1,2 HAVING count(*)>1;`
Status: unverified.

**I4. A team "broke" if it appears on a break tab.**
Where: `ingest.ts:1696-1714` writes an `EliminationResult` row for every break-tab row, with or without a rank; `breakCategoryResolve.ts:59` takes the break rank only from ranked rows.
Kind D. Source: documentation.
If false: Tabbycat's break page can list teams with a remark and no break rank (ineligible, capped, withdrawn, "different break"). Those rows still get an `EliminationResult` row, which readers treat as "broke". Example: a team capped out of the Open break would show as broken in Open. See the Tabbycat docs, "Breaks and Break Rounds" ([tabbycat.readthedocs.io](https://tabbycat.readthedocs.io/en/v2.5.7/index.html)).
Check: fixture: a break page with a remark row. Query: break rows whose team has `teamBreakRank IS NULL` but an `EliminationResult` stage of Open/ESL/etc.
Status: unverified.

**I5. When a team breaks in several categories, Open counts first, then ESL, EFL, Novice, then the rest.**
Where: `breakCategoryResolve.ts:23-30`, used at `ingest.ts:1056`, `:1559-1561`.
Kind D. Source: documentation (PR #107).
If false: the single break rank stored on the participant is the Open one. Example: ESL rank 1 and Open rank 15 shows "Open #15". A main bracket not called "Open" ("Main", "Varsity", "Senior", "Abierto") ranks 40 with every other category, so the order among them is first-seen.
Check: Q9. Query: `SELECT DISTINCT stage FROM "EliminationResult" WHERE "entityType"='team';` and look at what main brackets are called.
Status: unverified.

**I6. An outround label with no category belongs to the Open bracket.**
Where: `breakCategoryResolve.ts:113-130` (`cat = category ?? 'Open'`).
Kind D. Source: documentation.
If false: a schools event whose main bracket is "Senior" but labels rounds "Grand Final" files the deepest run under "Open". This is a display label only.
Check: Q9.
Status: unverified.

**I7. EUDC is the only tournament that runs Open and ESL outrounds side by side, and it is recognised by name.**
Where: `breakCategoryResolve.ts:151-154`.
Kind D. Source: documentation.
If false: other events that run brackets side by side (WUDC ESL/EFL; regional Opens with Novice) do not get the dual-break display. "EUDC 2025" is caught; "Europeans 2025" is not.
Check: Q10.
Status: unverified.

**I8. The outround ladder: Grand Final 100, Final 95, Semis 90, Partial Semis 85, and so on down; a Partial round ranks just below its full rung.**
Where: `judgeStats.ts:158-175`; `stageLexicon.ts:39-76`.
Kind D. Source: owner decision (HANDOFF "Round nomenclature (owner-directed)") for the Partial and Pre mapping. Not owner-decided: Grand Final ranked above Final.
If false: your nomenclature has one Final rung, but the code ranks "Grand Final" above "Final". Comparing a "Novice Final" (95) with an "Open Grand Final" (100) is fine. Ranking two tournaments' finals against each other, or picking a career's deepest run, prefers "Grand Final" wording.
Check: Q8.
Status: Partial/Pre mapping confirmed by owner; GF above Final unverified.

**I9. "Pre-X" is the Partial round of the rung below X; "Partial Final" means Partial Semifinal.**
Where: `stageLexicon.ts:104-127`, `:195-208`.
Kind D. Source: owner decision.
If false: n/a.
Check: none.
Status: confirmed by owner.

**I10. A label with a round number in it is a prelim, whatever else it says.**
Where: `stageLexicon.ts:215`; `judgeStats.ts:75`.
Kind D/T. Source: documentation (corpus: no outround label carries one).
If false: an outround named "Round 7 – Semifinal" reads as a prelim. Its winner is not recorded and it counts toward the prelim total.
Check: `SELECT DISTINCT stage FROM "JudgeAssignment" WHERE stage ~* 'round\s*\d' AND "roundNumber" IS NULL;`
Status: unverified.

**I11. A "Debate-off" is neither a prelim nor an outround.**
Where: `ingest.ts:1037-1041` (`isPrelimRoundLabel`).
Kind D. Source: documentation.
If false: n/a. Flagged because tie-break rounds ("swing-off", "break-off") use other names that may not be caught.
Check: Q12.
Status: unverified.

**I12. A split round (R1A / R1B) is ONE round for the same-round identity rule.**
Where: `affectedTournaments.ts:340-348` (`roundKey` uses only the number).
Kind D. Source: documentation.
If false: a person who speaks in R1A and judges R1B (halves run one after the other) is counted as two people sharing a name, an "overlap", when your rule would allow one person.
Check: Q4.
Status: unverified. **Owner rule implemented in the offline checker only (2026-10-27):** a results page that lists one team twice is read as an HWS-style double-panel round (two panels, independent rankings and speaks, aggregated). A judge repeated in such a round is no longer counted as an overlap (the pair is reported `unknown`). Speaker/judge overlaps in that round are still flagged. Live ingest is unchanged.

**I13. Two finals in different brackets are different rounds.**
Where: `affectedTournaments.ts:344` (stage + category).
Kind D. Source: documentation.
If false: if Open and Novice finals run at the same time, one person cannot be in both. The checker would call such a pair "disjoint" (plausibly one person) when it is really two.
Check: Q4.
Status: unverified. **Owner rule implemented in the offline checker only (2026-10-27):** two entries sharing a name where one reaches an Open final (or Grand Final) and the other a Novice final are an `overlap` (two people). ESL/other brackets are unchanged: EUDC is the only event where one person may be in both Open and ESL outrounds, and the checker does not know the event. Live ingest merging is NOT changed (too risky): it still keys on the normalised name and the round-overlap test is not applied there.

**I14. The tournament format is inferred from room shape, then team size, then name: 4 teams a room means BP; 2 a side means two-team; 3 a side means AP unless the seats say Proposition/Opposition (WSDC) or Affirmative/Negative with an Australs-circuit name.**
Where: `format.ts:59-66`, `:84-97`, `:131-160`, `:186-260`.
Kind D. Source: documentation (PR #114, #65).
If false: an Australs-format event without an Australs-circuit name is stored as AP; a WSDC event that labels sides Government/Opposition is stored as AP; "MalaysiaBP" is matched as BP by name. The format feeds stat splits.
Check: `SELECT format, count(*) FROM "Tournament" GROUP BY 1;` and look at a sample of each.
Status: unverified.

**I15. When the team tab has no points column, the team's speaker-score column stands in for points.**
Where: `parseTabs.ts:659-660`.
Kind D/T. Source: UNVERIFIED guess (comment says "fall back to speaker score").
If false: `TeamResult.points` on the tab row is a speaker total (e.g. 1,520) instead of team points (e.g. 15). Anything ranking teams by points mixes the two scales.
Check: `SELECT "tournamentId", max(points) FROM "TeamResult" WHERE "roundNumber"=0 GROUP BY 1 HAVING max(points) > 60;`
Status: unverified.

**I16. A missing rank column means the tab's row order is the rank, ties numbered one after another.**
Where: `parseTabs.ts:756-787`.
Kind D/T. Source: documentation.
If false: "5=" and "5=" become 5 and 6, and a tab sorted by something other than total gives wrong ranks. Only fires when no rank, ESL or EFL column exists.
Check: fixture: a speaker tab with a "Pos" header.
Status: unverified.

**I17. A tied place ("5=") is stored as the number alone; whether it was tied is dropped.**
Where: `parseTabs.ts:511-513`; API `tabbycatApi.ts:272,279` parses `tied` but nothing stores it.
Kind D/T. Source: documentation (PR #114: 69% of speakers were tied).
If false: the CV cannot print "5=" and shows "5th". Two speakers tied 5th both read 5, which is right, but nothing marks the tie. Derived ranks (`speakerRankOpenDerived`, `ingest.ts:1629-1648`) break ties by row id, so a tie becomes an arbitrary order.
Check: Q6.
Status: unverified.

**I18. A missing Total column means no total: never sum the speeches.**
Where: `parseTabs.ts:806-811`.
Kind D. Source: documentation (australs2020 example).
If false: n/a. The decision is sound, but it causes I47 (endless re-scrapes).
Check: none.
Status: unverified (reasoned in code).

**I19. Adjudicators on a break tab have no meaningful rank: a judge either breaks or does not.**
Where: `parseTabs.ts:1041-1047`.
Kind D. Source: documentation (PR #40).
If false: an adjudicator break that ranks judges (some events publish a ranked list) loses the order.
Check: none needed unless you want judge break ranks.
Status: unverified.

**I20. Participant roles: "adjud"/"judge" in the role text means a judge; Chief/Deputy Chief Adjudicator, adj core, Tab Director or a bare "CA"/"DCA" means core; "subsid" means subsidised; "invited"/"independent" means invited; anything else is a normal judge.**
Where: `parseTabs.ts:456-483`.
Kind D/T. Source: documentation (PR #104).
If false: an "Equity Officer" or "Convenor" listed as an adjudicator is a normal judge. A role in another language ("Juez", "Adjudicador") becomes `other`, with no judge role written. "Tab Director" counts as adjudication core; you may not agree.
Check: Q13.
Status: unverified.

**I21. On a registration card, a single unlabelled bullet means an adjudicator.**
Where: `parseTabs.ts:1257-1262`.
Kind D/T. Source: UNVERIFIED guess.
If false: a speaker or observer with a one-line card is filed as a judge.
Check: fixture: landing pages of speakers whose card has one bullet.
Status: unverified.

**I22. A URL owner whose registration line has something in brackets is a speaker (the brackets hold the team).**
Where: `parseNav.ts:233-237`; used as `isLikelySpeaker = !!teamName` at `ingest.ts:753`, `:1785`, `:1803`.
Kind D/T. Source: UNVERIFIED guess.
If false: if Tabbycat prints an adjudicator as "Private URL for Name (Institution)", the judge is treated as a speaker. Their round-results judging fallback is skipped, so a finished tournament (where the Debates card is gone) gives them no judging history at all.
Check: fixture: an adjudicator private-URL page with an institution. Query: `DiscoveredUrl` rows whose person has a judge role and no speaker role, compared with registrations that had a team.
Status: unverified.

---

## B. Tabbycat data format

**I23. Tabbycat's interface text is English: "Private URL for", "Hi/Hello/Welcome", "Team name:", "Speakers:", "Institution:", "Registration (…)", table titles "Adjudicators"/"Speakers", nav labels "Team tab", "Speaker tab", "Motions tab".**
Where: `parseNav.ts:228-305`, `:168-187`; `parseTabs.ts:1149-1151`, `:1245`, `:1267`.
Kind T. Source: documentation (`stageLexicon.ts:7-9`: every install in a 625-tournament sweep was `lang="en"`, v2.11).
If false: a tournament with Tabbycat's interface in another language gives no registration name. Nothing is linked to the user, and the participants list falls back to column guessing. Round NAMES are handled in several languages; interface text is not.
Check: Q14. Query: `SELECT count(*) FROM "DiscoveredUrl" WHERE "registrationName" = '';` (landing page reached, no name found).
Status: unverified.

**I24. The greeting fallback needs a name that starts with a capital Latin letter.**
Where: `parseNav.ts:250`.
Kind T/N. Source: UNVERIFIED guess.
If false: "Hi ana" or "Hi 李明" gives no name (last-resort path only).
Check: none needed unless I23 fails.
Status: unverified.

**I25. Round names are free text and are read with a lexicon covering English, Spanish, Portuguese and Chinese/Japanese stage words; any other language is a prelim or unknown.**
Where: `stageLexicon.ts:104-176`; `parseTabs.ts:996-999`.
Kind T/D. Source: documentation (PR #114).
If false: "Viertelfinale" (German), "Demi-finale" (French) or "Perempat Final" (Malay/Indonesian) are not outrounds. Their winners are not recorded, and they may count as prelims. "Perempat Final" contains "Final" and so reads as THE final.
Check: Q14. Query: `SELECT DISTINCT stage FROM "EliminationResult"` and `"JudgeAssignment"` for labels outside the lexicon.
Status: unverified.

**I26. Results pages live at `/results/round/<N>/`, the number is the round's order in the tournament, and outrounds are numbered after the prelims.**
Where: `parseTabs.ts:976-1001`; `parseNav.ts:139-149`.
Kind T. Source: documentation.
If false: round numbers and motions land on the wrong round. `roundNumbers.ts` already maps by nav label for split or zero-based rounds.
Check: covered by `tests/parseTabs.*`.
Status: unverified (corpus-backed).

**I27. Outround results are also written as per-round TeamResult rows; the comment says "prelims only".**
Where: `ingest.ts:1377-1406` (skips only `roundNumber == null`; outround URLs carry a number).
Kind T. Source: UNVERIFIED (the comment and the code disagree).
If false (that is, if readers assume prelims only): an outround's points/wins count as a prelim round wherever `TeamResult.roundNumber > 0` is read. Example: a team that won QF, SF and GF gets three extra "wins".
Check: `SELECT count(*) FROM "TeamResult" tr JOIN "EliminationResult" er ON er."tournamentId"=tr."tournamentId" AND er."entityName"=tr."teamName" WHERE tr."roundNumber" > (SELECT "prelimRoundCount" FROM "Tournament" t WHERE t.id=tr."tournamentId");`
Status: unverified. Owned by the CV register for the read side.

**I28. The nav's round list, sorted as text, is the round order.**
Where: `parseNav.ts:191` (`.sort()` on URLs, so `/round/10/` sorts before `/round/2/`).
Kind T. Source: UNVERIFIED (ingest comments say "nav order is kept").
If false: anything that relies on list position rather than the number in the URL gets 10+ round tournaments out of order. Current readers mostly key by URL, so the risk is low.
Check: a tournament with 10 or more rounds; compare `prelimRoundsFromNav` output.
Status: unverified.

**I29. The team, speaker, participants and motions pages are at fixed paths, so when the landing page does not link them the URLs are built.**
Where: `parseNav.ts:198-207`.
Kind T. Source: documentation.
If false: one wasted request per page (404 is treated as "withheld", `fetch.ts:106-109`).
Check: none.
Status: unverified (low impact).

**I30. A results-table cell's outcome is read only from known words: placing ("1st".."4th"), "advancing/eliminated", "won/win/lost/loss", ✓; for two-team "vs X" cells, only the popover's first word ("Won"/"Lost").**
Where: `parseTabs.ts:394-428`, `:893-896`.
Kind T. Source: documentation.
If false: a cell in another language ("Ganó", "1º") or a points-only cell gives `won = null`, so the round counts as neither a win nor a loss. Ordinals in other languages are not read.
Check: `SELECT count(*) FROM "TeamResult" WHERE "roundNumber">0 AND wins IS NULL AND points IS NULL;` per tournament.
Status: unverified.

**I31. In a panel cell without markup, judges are separated by "," ";" newline or " / ", and "(c)", "(chair)" or "chief" marks the chair; with markup, the Ⓒ/Ⓣ symbol gives chair/trainee.**
Where: `parseTabs.ts:316-342`, `:935-946`.
Kind T. Source: documentation (PR #114 fixed 5,310 trainees read as chairs).
If false: a judge whose name contains a comma ("Smith, Ann") is split into two judges; a team or judge called "Chief…" reads as a chair.
Check: fixture.
Status: unverified.

**I32. A speaker who opted out keeps their row as "Redacted", and the URL owner's own hidden row can be found as the single unmatched row on their team.**
Where: `redactedSpeaker.ts:26-56`; `ingest.ts:1500-1516`.
Kind T/N. Source: documentation (PR #105).
If false: if a teammate is ALSO redacted, nothing is attributed, which is the safe failure. If the owner's team name on the landing page differs from the speaker tab ("MIT A" vs "MIT A 1"), nothing is attributed.
Check: none.
Status: unverified.

**I33. A tab that the tournament's `/preferences` marks unreleased must not be read from either source; "limited" (top N) counts as released.**
Where: `tabbycatApi.ts:21-29`, `:316-337`, `:414-417`.
Kind T. Source: owner decision (the organisers' choice wins; HANDOFF "use the API, don't reparse", 2026-10-20).
If false: n/a.
Check: none.
Status: confirmed by owner (privacy intent).

---

## C. Identity and names

**I34. A person is identified by their name, normalised to lower-case a-z, 0-9 and spaces, across ALL tournaments.**
Where: `fingerprint.ts:73-85`; `Person.normalizedName @unique` (`prisma/schema.prisma:274`); `preCommitPersons` `ingest.ts:1929-1961`. #72 tried to change this and was reverted in #73.
Kind N. Source: documentation; you chose to replace it (option B, `docs/superpowers/specs/2026-10-27-person-identity-option-b-design.md`), but that is not built.
If false: two different "John Smith"s at two tournaments are one Person. Whoever claims it gets both careers.
Check: spec report V5 (namesake participations).
Status: contradicted by owner (option B chosen; not yet implemented).

**I35. Accents, case, punctuation and anything outside a-z are irrelevant to identity: "José" = "jos", "Zoë" = "zo", "李明" = "" (not a person at all).**
Where: `fingerprint.ts:73-85`; `ingest.ts:1936` skips empty keys; `names.ts:70-82`. Only `nameProximity.ts:32-35` folds accents first.
Kind N. Source: documentation.
If false: non-Latin names get no Person or participant, so they are invisible. "José Silva" and "Jose Silva" merge, and accented names lose letters. Checker finding: 23 tournaments, 44 names with empty keys (spec section 9).
Check: `scripts/find-identity-affected-tournaments.mjs` (emptyKeyNames).
Status: contradicted by owner (phase 7 of option B accepted).

**I36. Owning a private URL is NOT proof of identity; a Person is claimed only when the user has ticked that name on /onboarding.**
Where: `ingest.ts:2031-2078` (`linkRegistrationPerson`), PR #75.
Kind N. Source: documentation (teammates' URLs are forwarded).
If false: n/a. Decision A relaxes this: a close name should be enough. The code still needs a tick for every new name, so a user with a close-but-different registration name ("Abhi Acharya") gets nothing on the CV until they tick it.
Check: Q1.
Status: stricter than owner decision A.

**I37. Name proximity (match / close / different) is advice on the picker only; it never holds or blocks a URL.**
Where: `app/api/onboarding/names/route.ts:18-22`, `:89`; `nameProximity.ts:1-22` says "Below that the URL is held", but no code holds anything. PR #153: "Not included: the name-closeness hold for Gmail-found URLs."
Kind N. Source: owner decision A says hold Gmail-found URLs whose name is `different`.
If false: a user can tick a name that is "different" from their profile name and claim it, with no hold.
Check: Q1.
Status: contradicted by owner (hold not built).

**I38. "Close" means: surname equal (one letter of slack if 5+ letters long), and first name equal, an initial, a shared 3+ letter prefix, or one typo (4+ letters); surname is the LAST word (or first, crosswise); middle names are ignored; bracketed text is dropped.**
Where: `nameProximity.ts:55-89`.
Kind N. Source: owner decision A (threshold set by an agent, "tested rather than tuned").
If false: the ordering fails for names whose family name is not first or last as expected. Spanish double surnames: "Ana García López" vs "Ana García" share first and first-surname but the last word differs, so the result is "different". Mononyms and single-word profile names always give "different". Siblings ("A. Acharya" vs "Abhishek Acharya") give "close".
Check: Q2.
Status: unverified (thresholds). **Owner rule implemented (2026-10-27):** a one-word name, a hyphenated or particle surname ("de la Cruz", "van Dijk"), and any name of three or more words whose middle words are not initials is "ambiguous" (`isAmbiguousNameShape`). If either side is ambiguous, `nameProximity` returns at most `close`. Onboarding pre-ticks only `isMine` or `match` rows, so `close` (and every ambiguous name) always needs the user's own tick. The claim route uses the separate `personNameMatches` and is unchanged.

**I39. A pasted or CSV-uploaded private URL belongs to whoever pasted it, and needs no DiscoveredUrl row.**
Where: `app/api/ingest/url/route.ts`, `app/api/ingest/csv/route.ts:41` (`enqueueUrl` only). The only `DiscoveredUrl` writer is `lib/gmail/scanUser.ts:52`.
Kind N/L. Source: UNVERIFIED (no PR says so).
If false: for a pasted URL `linkRegistrationPerson` finds no DiscoveredUrl to update, so the registration name never reaches /onboarding. A paste-only user (Gmail is optional under decision C) cannot claim a new name from that tournament. Re-ingest-mine and Lock also work only on Gmail URLs.
Check: `SELECT count(*) FROM "IngestJob" j WHERE NOT EXISTS (SELECT 1 FROM "DiscoveredUrl" d WHERE d."userId"=j."userId" AND d.url=j.url);` Also Q3.
Status: unverified.

**I40. Within one tournament, rows with the same normalised name in the participants list are one person; the last row wins, and a judge role is kept only if that row is the adjudicator one.**
Where: `ingest.ts:972-989` (`participantByName`); adjudicator loop `:1656-1686`.
Kind N/D. Source: documentation; the checker documents the bug (`affectedTournaments.ts:91-99`).
If false (owner rule 1): two same-named people who are in the same round become one participant. A speaker who judged the outrounds (one person, disjoint rounds) loses the judge role, because the Speakers table comes after Adjudicators. Corpus: 37 disjoint speaker+judge groups in 19 tournaments all lose their judge role; 203 groups overlap (two people merged) in 139 tournaments (spec section 9).
Check: `scripts/find-identity-affected-tournaments.mjs`, `judgeRoleLostByOnePerson`.
Status: contradicted by owner.

**I41. One person has one participant row per tournament, with one team.**
Where: `TournamentParticipant` unique `(tournamentId, personId)`; primary team `primaryTeam.ts:26-46`.
Kind N/D. Source: documentation (iron-man rationale, PR #97).
If false (owner rule 1: an organiser on several swing teams): only the team with the most scored rounds is kept; ties go to whichever team came first. That is fine for one person. Two namesakes on different teams become one row with one team.
Check: Q5.
Status: partly contradicted (namesakes), partly confirmed (swing organiser is one person).

**I42. A name that appears as both speaker and judge in the SAME round is two people (the offline checker); disjoint rounds may be one person; the same role with the same team and institution is one person listed twice.**
Where: `affectedTournaments.ts:54-90`, `:501`.
Kind N/D. Source: owner statement (refined rule, 2026-10-27).
If false: n/a for the overlap and disjoint cases. The "duplicate" class (same role, team and institution) is an agent rule: two same-named speakers on one team would be called one.
Check: Q4.
Status: confirmed by owner (overlap/disjoint); duplicate class unverified.

**I43. For an undecided pair, different institutions suggest two people; the same institution with no shared known round suggests one; a blank institution gives no evidence.**
Where: `unknownRounds.ts:81-94`.
Kind N. Source: owner statement ("the owner's simple rule").
If false: a swing-team organiser whose swing team carries a blank or "Swing" institution while their judge entry names a university is suggested as "two people". The suggestion never moves the list on its own.
Check: none (advisory column).
Status: confirmed by owner (as a hint).

**I44. Fuzzy name match: names are the same if one normalised string contains the other (both 2+ words), or every word of one is in the other.**
Where: `personMatch.ts:92-110`; used for the URL owner's judging from results pages (`ingest.ts:2307`), the landing Debates card (`parseNav.ts`), and `findPersonId` fallbacks.
Kind N. Source: documentation (PR #93).
If false: the containment is on characters, not words. "Ann Lee" matches "Joann Lee", "Susann Lee" and "Ann Leeson". The owner "Ann Lee" is credited with every panel those judges sat on (written as `JudgeAssignment` rows), and they count in the chaired and paneled totals. `nameProximity.ts:12-14` already calls this "too loose".
Check: `SELECT "tournamentId", "personId", "roundNumber", count(*) FROM "JudgeAssignment" WHERE source='round_results' AND "roundNumber" IS NOT NULL GROUP BY 1,2,3 HAVING count(*)>1;` (two seats in one round means two people).
Status: unverified (and in tension with owner rule 1).

**I45. Names in "Speaker 1", "Swing B", "Iron 2", "Judge 1", "Redacted", "Anonymous", "TBA", pure-number form (ASCII only) are stand-ins, not people.**
Where: `names.ts:50-68`, `:75-87`.
Kind N/T. Source: documentation (PR #114, corpus).
If false: a real one-word name matching the shape ("Irona", "Swingb") is dropped. A real organiser who entered themselves as "Swing 1" to fill a room is not credited, which matches owner rule 1 (stop-gaps are not the swing team's record).
Check: Q7.
Status: unverified.

**I46. A hybrid tournament's "[o]" / "[i]" prefix is an attendance tag, never part of a name.**
Where: `names.ts:11-23`.
Kind N/T. Source: documentation.
If false: n/a.
Check: none.
Status: unverified (low risk).

---

## D. Freshness and re-scrape rules

**I47. A stored tournament is complete only if some participant has a speaker TOTAL whenever the landing page links the speaker tab.**
Where: `ingest.ts:717-735` (`speakerScoreTotal: { not: null }`); `prescrape.ts:69-76`.
Kind L/T. Source: documentation (PR #144); the PR notes the trade-off.
If false: a tab with no Total column (ranked by average: Australs and other AP events; I18) never stores a total. Every private-URL load of that tournament is then a cache miss and a full re-scrape, forever, which goes against owner rule 2.
Check: `SELECT t.id, t.name FROM "Tournament" t WHERE NOT EXISTS (SELECT 1 FROM "TournamentParticipant" p WHERE p."tournamentId"=t.id AND p."speakerScoreTotal" IS NOT NULL) AND EXISTS (SELECT 1 FROM "TournamentParticipant" p JOIN "ParticipantRole" r ON r."tournamentParticipantId"=p.id AND r.role='speaker' WHERE p."tournamentId"=t.id);`
Status: unverified; likely wrong.

**I48. Every results round the nav links produces at least one stored TeamResult row.**
Where: `ingest.ts:704-713` (nav count > distinct stored rounds means stale).
Kind L/T. Source: documentation (PR #66, "smart cache bust").
If false: a round whose page parses to no teams (a silent round shown with no results, an outround page in another layout, an API round with no team results), or a nav that links both `/round/3/` and `/round/3/by-team/`, never satisfies the count. That tournament re-scrapes on every load.
Check: compare `navigation.resultsRounds.length` with `count(DISTINCT "roundNumber")` per tournament from a fresh landing parse; or count ParserRun rows per tournament over a week.
Status: unverified.

**I49. Nothing is released after the last round and both tabs.**
Where: `prescrape.ts:59-68`; `ingest.ts:714-716`.
Kind D/L. Source: owner statement (rule 3, as implemented in #143/#144).
If false: motions often go public after the final, and some events publish the break or speaker tab days later. Motions released after the stored scrape are never fetched, because no check looks at them.
Check: Q15. Query: tournaments with `"Motion"` count 0 whose landing nav now links `/motions/`.
Status: confirmed by owner for rounds; motions not covered by the rule.

**I50. A PARSER_VERSION bump re-scrapes every stored tournament on its next load.**
Where: `ingest.ts:697-699`, `:736`; `version.ts:59`; prescrape `ingest.ts:308`.
Kind L. Source: documentation (CLAUDE.md).
If false (owner rule 2 says only missing rounds/tabs or force): a bump is a code-side force for everyone. Today that is the only way parser fixes reach old data.
Check: Q16.
Status: unverified against rule 2.

**I51. The pre-scrape treats a stored row as current on parser version alone; it does not check rounds or tabs.**
Where: `ingest.ts:308-310`.
Kind L. Source: documentation.
If false: a tournament pre-scraped mid-event is not refreshed by the pre-scrape runner. A user's own private-URL load does check, so they still get fresh data.
Check: none.
Status: unverified (low impact).

**I52. "Re-ingest all" marks rows stale by writing an epoch `scrapedAt`, and anything before 2000-01-01 is never fresh.**
Where: `prescrape.ts:39-57`; `app/api/admin/reingest-all/route.ts:50`.
Kind L. Source: documentation (PR #124).
If false: n/a.
Check: none.
Status: confirmed in code.

**I53. Any signed-in user may force a re-scrape by pasting a URL with `force: true`, which also skips the regression guard.**
Where: `app/api/ingest/url/route.ts:20`; `ingest.ts:1118`, `:1343-1345`.
Kind L. Source: UNVERIFIED (no owner decision found).
If false: during a Cloudflare block, one user's forced paste can overwrite a shared tournament's good data with a degraded parse for everyone. It is rate-limited.
Check: Q17.
Status: unverified.

**I54. A re-scrape that would drop teams, participants or ranks below half (when there were more than 5) is a degraded page and is refused.**
Where: `ingest.ts:1120-1159`.
Kind L. Source: documentation (PR #66, #174).
If false: a genuine correction (e.g. the organiser removed a duplicated tab) is blocked unless forced.
Check: Sentry "Regression guard" messages.
Status: unverified.

**I55. Tournament-wide rows are refreshed only when the scrape had no warnings at all (or force).**
Where: `ingest.ts:1343-1345`.
Kind L. Source: documentation.
If false: a tournament that always gives a harmless warning (a private speaker tab gives `tabs:`, a withheld participants list gives `optional:`) never clears old rows on re-scrape. Old outround or break rows stay beside the new ones.
Check: ParserRun warnings per tournament against how often it re-scrapes.
Status: unverified.

---

## E. Tournament identity (fingerprint)

**I56. A tournament is host + slug + lower-cased name + year; a year in the name is authoritative; otherwise the year of the earliest email carrying the private URL is used, trying year ±1 and null to find an existing row.**
Where: `fingerprint.ts:3-71`; `ingest.ts:627-656`; `extract.ts:236-248` (earliest message wins).
Kind L/D. Source: documentation (PR #102).
If false: emails for a January event sent in December store the previous year (only a NEW row is affected; existing rows are matched). A name with two years ("2023-24") takes the first. Pre-scrape uses no inferred year, so an undated event pre-scraped and then ingested meets only through the null-year candidate or the host+slug fallback.
Check: `SELECT name, year FROM "Tournament" WHERE name !~ '(19|20)\d\d' ORDER BY year;` and look for off-by-one years.
Status: unverified.

**I57. Within a Tabbycat site a slug names exactly one tournament, so host + slug can adopt a stored row when the fingerprint misses.**
Where: `ingest.ts:198-229` (`findTournamentByHostSlug`), used at `:655` and `:291`.
Kind T/L. Source: documentation (B9 design).
If false: an organiser who reuses one site and slug every year ("edudrift.calicotab.com/novice/") has "Novice Open 2025" adopt the 2024 row, overwriting its name, year and results. That breaks the "Oxford IV 2024 and 2025 must never merge" rule (`fingerprint.ts:49-51`).
Check: Q18. Query: tournaments whose stored `year` changed between scrapes (ParserRun history), or sites with several years in the pre-scrape lists sharing one slug.
Status: unverified.

---

## F. Limits, hosts and operations

**I58. Page bodies are not kept on the server.**
Where: `fetch.ts:433-456` (`STORE_SOURCE_BODIES=1` to keep). `version.ts:8-11` still says "fetch.ts retains gzipped page bodies" (stale comment).
Kind L. Source: owner decision (#158).
If false: n/a for new fetches. Bodies written before #158 remain until the runbook's `UPDATE … SET "bodyGzip" = NULL` is run. The private URL itself is still stored as `SourceDocument.url` for landing pages, and on `DiscoveredUrl`; retention question B is unanswered.
Check: `SELECT count(*) FROM "SourceDocument" WHERE "bodyGzip" IS NOT NULL;` and `… WHERE url ILIKE '%/privateurls/%'`.
Status: confirmed by owner (bodies); private-URL retention open (Q19).

**I59. Tabbycat lives only on `*.calicotab.com`, `*.herokuapp.com` and `*.yellowtabs.com`.**
Where: `extract.ts:13-36`; Gmail query `run.ts:5-6`.
Kind T/L. Source: documentation (PR #150 added Yellow Tab).
If false: self-hosted Tabbycat on other hosts (own domains, Render, Fly, Railway; Heroku's free tier ended in 2022) is never found in Gmail and cannot be pasted. Also any `*.herokuapp.com` app is trusted: someone can host a fake "Tabbycat" page there, paste its private-URL-shaped link, and write invented results into the shared database (threat model item 6).
Check: Q20. Search your Gmail for "privateurls" on other hosts.
Status: unverified.

**I60. A private URL has exactly the shape `https://<one-label>.<host>/<slug>/privateurls/<key>/`, with an alphanumeric key.**
Where: `extract.ts:13-14`, `:55-71`.
Kind T. Source: documentation.
If false: a two-label subdomain or a key with "-" is not found in email. Root-hosted tournaments cannot have one, which is consistent.
Check: fixture.
Status: unverified (low risk).

**I61. A user has at most 500 relevant emails; the first scan reads the newest 500, and later scans only read mail newer than the newest URL found, minus one day.**
Where: `run.ts:8`, `:84-89`; `scanUser.ts:37-44`.
Kind L. Source: documentation (PR #67, #108).
If false: a long-time debater or judge (or anyone with Heroku notification mail, which the query also matches) loses everything older than the 500th match, permanently. No later scan looks back.
Check: compare a heavy user's oldest `DiscoveredUrl.messageDate` with their debating history; or count Gmail results for the query by hand.
Status: unverified; likely wrong for heavy users.

**I62. Fetch politeness and timing: 400 ms per host by default (comment says 600 ms), up to 1.5-3 s after push-back; 15 s per request; retries at 0 / 1 s / 3 s on 403/408/425/429/5xx; one retry on a network error; 5 redirects; 15 s API timeout.**
Where: `fetch.ts:44-49`, `:120`, `:183`, `:189`, `:274-309`; `fetchSession.ts:34-44`; `tabbycatApi.ts:353`.
Kind L. Source: documentation.
If false: a 403 that is the tournament's own "permission denied" costs two retries on a required tab before it fails.
Check: none.
Status: unverified (operational).

**I63. A 404/410, or a 403 that is not from the CDN, is the tournament withholding the page; the participants list and guessed motions page may be missing without failing the ingest; any other failed tab, round or break page fails the whole ingest.**
Where: `fetch.ts:98-109`; `ingest.ts:813-870`, `:426-430`.
Kind T/L. Source: documentation (PR #116).
If false: a tournament that 404s one outround results page (deleted round) can never be ingested: every attempt aborts.
Check: `IngestJob.lastError LIKE '%fetch: round%'`.
Status: unverified.

**I64. A URL whose last error mentions "HTTP 404" is dead and skipped by Re-ingest mine.**
Where: `app/api/ingest/reingest-mine/route.ts:34-45`.
Kind L. Source: documentation.
If false: a temporary 404 (site rebuilding) is never retried from that button.
Check: none.
Status: unverified.

**I65. Time budgets: 55 s per paste, 45 s write transaction live, 15 min for the pre-scrape, 2 min scrape-claim TTL, 15 s wait for a concurrent scrape, 3 attempts per queued job.**
Where: `url/route.ts:26`; `ingest.ts:505-510`, `:1257-1258`; `app/api/cron/process-queue/route.ts:22`.
Kind L. Source: documentation (PRs #123, #128, #135, #139).
If false: n/a. This is operational detail for the other register.
Check: none.
Status: unverified (operational).

**I66. A root-hosted site with several tournament links stands for all of them except slugs whose year is after the current one; non-tournament path names are a fixed list.**
Where: `prescrape.ts:125-169`.
Kind T/L. Source: documentation (PR #136).
If false: a root page linking an archived or unrelated slug pre-scrapes something no user attended. That is harmless except for cost.
Check: none.
Status: unverified (low impact).

**I67. Region comes from tag data, not from the host name.**
Where: `lib/tags/classifyTournaments.ts:66`; `lib/tags/vocabulary.ts:21-33`.
Kind D. Source: owner statement (edudrift/wolce = Southeast Asia, applied in data).
If false: a new edudrift or wolce tournament arrives untagged until the next tagging pass. The classifier cannot place it from the host name.
Check: `Download untagged` after each load.
Status: confirmed by owner (in data).

---

## Ranked top 15: most likely wrong or highest impact

| Rank | ID | Why it ranks here |
|---|---|---|
| 1 | I40 | Live ingest merges same-named people per tournament and drops a speaker-turned-judge's judge role; contradicts owner rule 1; measured at 139 + 19 tournaments |
| 2 | I34 | One name = one person across all tournaments; claiming a name claims a namesake's career; owner chose option B, not built |
| 3 | I44 | Character-level containment credits "Ann Lee" with "Joann Lee"'s panels; writes judging history to the wrong person |
| 4 | I47 | Tabs with no Total column re-scrape on every load, forever; against owner rule 2 |
| 5 | I39 | Pasted/CSV URLs never create a DiscoveredUrl, so paste-only users cannot claim a new name |
| 6 | I61 | Gmail first scan stops at 500 newest matches and never looks back; heavy users lose old tournaments |
| 7 | I35 | Non-Latin names get no Person; accents silently merge or truncate names |
| 8 | I37 / I36 | Decision A is not built: no hold on `different`, no auto-link on `close` |
| 9 | I59 | Any `*.herokuapp.com` page is trusted as a real tab, so results can be invented; other self-hosts are missed |
| 10 | I57 | Host + slug fallback can merge two editions of a tournament run on a reused site |
| 11 | I22 | An adjudicator with brackets in their registration line is treated as a speaker and loses round-results judging |
| 12 | I48 | A linked round that parses to no teams re-scrapes the tournament on every load |
| 13 | I4 | Every break-tab row, ranked or not, records the team as broken |
| 14 | I25 / I23 | English-only interface text and a four-language stage lexicon; "Perempat Final" reads as the final |
| 15 | I17 | Tie markers ("5=") are dropped; derived ranks break ties arbitrarily |

## Questions for the owner (20)

| Q | Question | Entries | Owner answer |
|---|---|---|---|
| Q1 | Should a Gmail-found URL whose registration name is `close` link automatically (decision A), or still need your tick? And should a `different` one be held? | I36, I37 | **Owner (2026-10-27): contradicted by owner.** a close name always needs the user's tick; no auto-link (decision A dropped). |
| Q2 | Is "close" right for Spanish/Portuguese double surnames and one-word names, or should those always go to the user? | I38 | **Owner (2026-10-27): contradicted by owner.** double surnames and one-word names always go to the user. |
| Q3 | Should a pasted or CSV URL be treated exactly like a Gmail one (appear on /onboarding for claiming)? | I39 | **Owner (2026-10-27): confirmed by owner.** pasted/CSV URLs use the same /onboarding claim flow. |
| Q4 | Are R1A and R1B one round (nobody can be in both), and can someone sit in an Open final and a Novice final at one tournament? | I12, I13, I42 | **Owner (2026-10-27): contradicted by owner.** HWS-style double-panel round robins are an exception; nobody can be in both an Open and a Novice final. |
| Q5 | When an organiser fills several swing teams, should they get any speaking credit at all? | I41, I45 | **Owner (2026-10-27): confirmed by owner.** swing credited only if clearly 1-2 real people over many rounds; keep dropping swings. |
| Q6 | Should the CV show "5=" for tied ranks? | I17 | **Owner (2026-10-27): contradicted by owner.** show "5=" for tied ranks. |
| Q7 | Is a real person ever entered under a stand-in-looking name ("Swing 1") that should count as theirs? | I45 | **Owner (2026-10-27): confirmed by owner.** stand-in names are not normally a real person. |
| Q8 | Is "Grand Final" the same rung as "Final" (equal rank)? | I8 | **Owner (2026-10-27): contradicted by owner.** Grand Final is the same rung as Final (same rank). |
| Q9 | What do tournaments call their main bracket besides "Open", and should it outrank ESL/EFL the same way? | I5, I6 | **Owner (2026-10-27): confirmed by owner.** only "Open" is the main bracket. |
| Q10 | Which events besides EUDC run two brackets' outrounds side by side? | I7 | **Owner (2026-10-27): confirmed by owner.** only EUDC runs Open and ESL outrounds side by side. |
| Q11 | In BP, is a prelim "win" only first place? | I1 | **Owner (2026-10-27): contradicted by owner.** do not say "win" in BP; use straights (points >= 2 x rounds), firsts tracked separately. |
| Q12 | Other names for a tie-break round besides "Debate-off"? | I11 | **Owner (2026-10-27): confirmed by owner.** "Debate-off" is the only tie-break round name. |
| Q13 | Is a Tab Director "adjudication core"? Should Equity/Convenor roles count as judging? | I20 | **Owner (2026-10-27): contradicted by owner.** CAs usually judge, TDs usually do not; a judging TD counts as a break. |
| Q14 | Have you seen tournaments whose Tabbycat interface (not just round names) is not in English, or round names in German/French/Malay? | I23, I25 | **Owner (2026-10-27): contradicted by owner.** English default; at least one Spanish-language comp, so add a Spanish stage lexicon. |
| Q15 | Should a later motions release trigger a re-scrape? | I49 | **Owner (2026-10-27): contradicted by owner.** a later motions release triggers a re-scrape. |
| Q16 | Is a parser-version bump an acceptable re-scrape trigger under rule 2? | I50 | **Owner (2026-10-27): confirmed by owner.** a parser-version bump is an acceptable re-scrape trigger. |
| Q17 | Should only admins be able to force a re-scrape? | I53 | **Owner (2026-10-27): contradicted by owner.** only admins can force a re-scrape. |
| Q18 | Do organisers reuse one Tabbycat site and slug across years? | I57 | **Owner (2026-10-27): confirmed by owner.** many tournaments share a site; slugs believed unique (keep host+slug, monitor). |
| Q19 | Delete the stored private URL once the ingest succeeds and the person is linked (retention question B)? | I58 | **Owner (2026-10-27): contradicted by owner.** delete the stored private URL after ingest, but later (backlog). |
| Q20 | Are there tournaments on hosts other than calicotab / herokuapp / yellowtabs that you want covered, and should herokuapp stay trusted? | I59 | **Owner (2026-10-27): confirmed by owner.** keep hosts as is; herokuapp stays trusted. |

Sources: [Tabbycat User Guide, v2.5.7 (Breaks and Break Rounds; Standings Rules)](https://tabbycat.readthedocs.io/en/v2.5.7/index.html); [Tabbycat User Guide, v2.1.3](https://tabbycat.readthedocs.io/en/v2.1.3/).
