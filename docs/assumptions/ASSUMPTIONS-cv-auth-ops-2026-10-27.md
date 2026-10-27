# Assumptions register: CV, statistics, auth, privacy, operations (2026-10-27)

**Purpose.** Every assumption the code makes in this area, written so the owner can strike the wrong ones. Docs only: no code was changed.

**Scope.** `lib/cv/**`, `lib/motions/**`, `lib/tags/**`, `components/stats/**`, `components/CvHighlights.tsx`, `app/(app)/cv/**`, `app/u/[slug]`, `lib/auth*.ts`, `lib/crypto.ts`, `lib/gmail/**`, `lib/rateLimit.ts`, `lib/queue*.ts`, the cron route, sharing, notifications, account export and delete. Where a CV figure rests on a parser rule (BP "win" = 1st, stage ranks in `lib/calicotab/judgeStats.ts`), the CV-side use is listed here. The parser rule itself is in the ingest/identity register.

**Method.** Read every in-scope file at `origin/main` 8ab4509, checked the merged PRs that touched these paths (#4, 5, 7, 10, 12, 14, 18, 24, 26, 33, 43, 49, 50, 52, 55, 58, 61, 62, 67, 70, 76, 77, 79, 81, 82, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 99, 100, 103, 104, 107, 108, 109, 111, 113, 114, 115, 117, 118, 121, 122, 123, 130, 131, 133, 146, 147, 150, 153, 155, 157, 159, 164, 167, 169, 173, 175), and checked against the design docs (`docs/superpowers/specs/2026-09-17-filterable-stats-design.md`, the paste-a-URL threat model, the private-URL redaction design, `docs/HANDOFF.md`, `docs/DESIGN_INSTRUCTIONS.md`). Two claims were tested by running the code: the majors regex (C21) and the stage ranks and brackets (C8, C9).

**How to read an entry.**
- **Source** says where the assumption came from: owner decision, owner statement, documentation (a doc or PR that states it), or UNVERIFIED guess (no record of anyone deciding it).
- **Status** is one of: confirmed by owner, contradicted (the code or another part of the code says otherwise), or unverified.
- Line numbers are at 8ab4509.

**Owner-confirmed rules, and what the code does with them.**

| Rule | Entry | Code |
|---|---|---|
| Break depth = furthest outround reached | C1 | Follows it. C8 and C9 are cases where the stage ranking undermines it |
| Placement and "top % of break" use team rank | C2, C3 | Follows it. The ceil rounding (C3) was the agent's call |
| One team per speaker; swing organisers can be on several | C61 | One row per tournament. A swing organiser's other teams are dropped |
| No speaking and judging in the same round | C62 | No check on the CV side; enforcement is in the identity area |
| A: a close name match is acceptable | C87 | Only the onboarding names route checks it |
| B: delete the stored private URL after ingest | C88 | **Not implemented** |
| C: keep the Gmail scope | C67 | Follows it |
| D: keep the daily limit and 20 URLs per paste | C85, C86 | CSV has a daily cap. A single paste is limited per hour, with no daily cap |
| Only speaker stats are built | C60 | The judging sections are also on /cv/stats |

---

## A. Placement, breaks and titles

### C1. Break depth is the furthest outround the team reached, not speaker rank.
- Where: lib/cv/teamPlacement.ts:92-116 (`breakDepth`), :145-173 (`compareBreakStrength`); lib/cv/headerMetrics.ts:35-39
- Category: debate-domain
- Source: owner decision (PR #167, "Owner feedback implemented" 1)
- If false: n/a, owner rule.
- Check: tests/cv.teamPlacement.test.ts
- Status: **confirmed by owner**

### C2. "How high did I place" and "top N%" use the TEAM tab rank against the number of teams, never the speaker-tab rank.
- Where: lib/cv/teamPlacement.ts:5-19, :48-76; lib/cv/speakerStats.ts:663-703; lib/cv/exportFields.ts:193-203; lib/cv/jsonResume.ts:111-118
- Category: debate-domain
- Source: owner decision (PR #167 point 2; docs/DESIGN_INSTRUCTIONS.md "Placement is a team fact")
- If false: n/a, owner rule.
- Check: tests/cv.teamPlacement.test.ts
- Status: **confirmed by owner**

### C3. "Top 10%" means team rank <= ceil(0.10 x teams on the tab).
- Where: lib/cv/teamPlacement.ts:63-76, :202-205; components/CvHighlights.tsx:74-80
- Category: statistics and thresholds
- Source: UNVERIFIED guess. PR #167 lists it under "decisions on ambiguous points", which the agent made. Using the team rank is owner-confirmed; the rounding is not.
- If false: rounding up lets small tabs in. With 15 teams, ceil(1.5) = 2, so rank 2 of 15 (top 13%) shows as a "Top-10% team finish". With 11 teams, rank 2 (top 18%) qualifies. With floor instead, a tab under 10 teams would have no top-10% place at all.
- Check: owner picks ceil, floor or the strict reading, rank / teams <= 10%.
- Status: unverified

### C4. Team "top N%" = rank / teams; team percentile = (teams - rank) / teams.
- Where: lib/cv/teamPlacement.ts:25-40, :55-60
- Category: statistics and thresholds
- Source: UNVERIFIED guess (PR #167 "decisions on ambiguous points")
- If false: rank 1 of 40 is "top 2.5%" and the 97.5th percentile, never 100. Tied teams (two teams on "=3") get whatever rank the tab, or the fallback in C18, gave them.
- Check: owner confirms the wording "3 of 40 teams · top 8%".
- Status: unverified

### C5. The speaker-tab percentile uses a different convention from the team percentile.
- Where: lib/cv/speakerStats.ts:634-637 (`(1 - betterThanUser / speakerCount) * 100`) vs lib/cv/teamPlacement.ts:58 (`(teams - rank) / teams * 100`)
- Category: statistics and thresholds
- Source: UNVERIFIED guess
- If false (if the two should match): 1st of 40 speakers reads as the 100th percentile, while 1st of 40 teams reads as 97.5. The two "average placement" figures on /cv/stats are on slightly different scales, and the team figure is always the lower one.
- Check: pick one convention, then compare both figures on a record where the user is 1st on both tabs.
- Status: unverified (the code is inconsistent with itself)

### C6. On the speaker tab, a speaker tied with others on total takes the best of the tied places.
- Where: lib/cv/buildCvData.ts:1224-1225 (`sorted.filter((v) => v > myTotal).length`)
- Category: statistics and thresholds
- Source: UNVERIFIED guess
- If false: three speakers on 754 after 9 rounds all show "12th of 214". The tab may list them 12th, 13th and 14th on a tiebreak, so the CV shows a slightly better place than the published tab.
- Check: compare `field_placement` in the export with the published speaker tab for a tournament that has ties.
- Status: unverified

### C7. At equal depth, an Open-bracket run outranks a category run (ESL, EFL, Novice).
- Where: lib/cv/teamPlacement.ts:109-112, :161
- Category: debate-domain
- Source: UNVERIFIED guess (PR #167 "decisions on ambiguous points", the agent's call)
- If false: an Open semifinal and an ESL semifinal at different tournaments would sort the other way.
- Check: owner confirms.
- Status: unverified

### C8. "Grand Final" is one step deeper than "Final", and a category round carries the depth of its stage.
- Where: lib/calicotab/judgeStats.ts:158-175 (grand_final 100, final 95); lib/cv/teamPlacement.ts:108. Probe results: "ESL Grand Final" = 100, "Open Final" = 95, "Silver Final" = 95, "Novice Final" = 95.
- Category: debate-domain
- Source: UNVERIFIED guess
- If false: C7 ("Open first at equal depth") never applies between a "Final" and a "Grand Final", because their ranks differ. A team that won an "ESL Grand Final" sorts above a team that reached the Open "Final" at a tournament that calls its last round "Final". Elsewhere the code treats "Final" and "Grand Final" as the same round (lib/cv/roundLedger.ts:96-100, motion matching), so it disagrees with itself.
- Check: owner: are "Final" and "Grand Final" ever two different rounds at one tournament? If not, they should share a rank.
- Status: unverified

### C9. A consolation bracket (Silver, Plate, Bronze, Consolation, Lower) is not a break, a final or a title.
- Where: applied in lib/cv/outroundFunnel.ts:58-76 and lib/cv/milestones.ts:113-128. NOT applied in lib/cv/speakerSignals.ts:36 (`broke = eliminationReached != null || teamBreakRank != null`), lib/cv/buildCvData.ts:1239-1241 (summary.breaks), lib/cv/teamPlacement.ts:183-193 (deepest breaks), lib/cv/speakerStats.ts:872, :887, :932 (break count, break rate, season break rate), or lib/cv/jsonResume.ts:108.
- Category: debate-domain
- Source: documentation (the comment in outroundFunnel.ts). The other modules never adopted it.
- If false / as built: take a team that missed the break and reached the "Silver Final". The /cv header ("Breaks: 6 · 40% of entries"), /u, the break-rate finding and JSON Resume ("Broke — reached Silver Final") all count it as a break. The funnel and milestones on /cv/stats do not. In "Deepest breaks" a Silver Final (95) sorts above an Open Semifinal (90).
- Check: grep the `bracketOf` call sites; render a record with one Silver run.
- Status: **contradicted** (the code disagrees with itself; the funnel's rule looks like the intended one)

### C10. Winning any final makes the user a "Champion", whatever the bracket.
- Where: lib/cv/buildCvData.ts:950-970 (`stageRank >= finalRank` and the result is 'won'). Used by highlights.championships (:1250-1253), components/CvHighlights.tsx:49-53, lib/cv/jsonResume.ts:107 ("Champion"), lib/cv/exportFields.ts:82-93 ("(W)") and lib/cv/speakerStats.ts:889. components/stats/StatsSections.tsx:688 labels it "any bracket".
- Category: debate-domain
- Source: UNVERIFIED guess
- If false: an ESL, Novice or Silver final win shows as "Won 2 titles" on /cv and "Champion" in JSON Resume, and readers take that to mean the Open title. lib/cv/milestones.ts and outroundFunnel.ts already keep Open titles apart from category titles and drop consolation titles.
- Check: owner rule: is a category title a "title" on the CV? Is a Silver final win ever one?
- Status: unverified

### C11. A partial round (one run with byes) ranks just below the full round of the same name.
- Where: lib/calicotab/judgeStats.ts:161-174 (partial_quarterfinal 75 < quarterfinal 80, and so on); lib/cv/outroundFunnel.ts:30-38, :114-116 (the funnel counts a partial round on its full rung)
- Category: debate-domain
- Source: documentation (the "One nomenclature" comment in stageLexicon); not owner-confirmed
- If false: a team out in "Pre-Semifinals" (stored as Partial Quarterfinals, 75) sorts below a team out in a full Quarterfinal (80) in Deepest breaks, though both lost the round before the semis. The funnel counts both on the quarterfinal rung, so the two surfaces disagree.
- Check: owner: is losing a partial quarter the same depth as losing a full quarter?
- Status: unverified

### C12. An outround label the lexicon does not recognise still counts as a break, ranked below every known stage.
- Where: lib/cv/teamPlacement.ts:80-88, :108 (rank 0); lib/calicotab/judgeStats.ts:198-204 (falls back to the round number)
- Category: debate-domain
- Source: documentation (comment)
- If false: an unusual or non-English stage name ("Top 8", a Spanish variant missing from the lexicon) sorts below a triple octofinal.
- Check: list stored `eliminationReached` values for which `outroundRankStrict` returns null.
- Status: unverified

### C13. Break seed is the team's rank on the break tab, preferring the Open break; "of N" is shown only when the Open break tab exists and lists the team.
- Where: lib/cv/teamPlacement.ts:118-133; lib/cv/exportFields.ts:204-213
- Category: debate-domain
- Source: UNVERIFIED guess (PR #167 decisions)
- If false: a team seeded 3rd on the ESL break, at a tournament with no stored Open break, shows "#3" with no denominator, and nothing says it is the ESL seed.
- Check: owner confirms.
- Status: unverified

### C14. Break strength tie order: depth, then Open before category, then won the final, then the better break seed, then the better team-tab share.
- Where: lib/cv/teamPlacement.ts:145-173
- Category: debate-domain
- Source: depth first is owner-confirmed (C1). The rest of the order is an UNVERIFIED guess (PR #167).
- If false: two semifinal exits are ordered by seed, so a 1st seed losing a semi ranks above an 8th seed losing a semi at a much bigger tournament. Field size is only the last key.
- Check: owner orders three real semifinal runs by hand.
- Status: partly confirmed

### C15. "Best team finish" takes the best share of the field (ties go to the bigger field), but the milestone "Best team-tab rank" takes the smallest absolute rank.
- Where: lib/cv/teamPlacement.ts:195-216; lib/cv/milestones.ts:287; lib/cv/speakerStats.ts:693-701
- Category: statistics and thresholds
- Source: UNVERIFIED guess (PR #167 decisions)
- If false: in the milestone record, "1st of 8" at a club IV ties with "1st of 300" at Worlds. The /cv tile instead prefers whichever share is smaller.
- Check: owner picks one rule.
- Status: unverified

### C16. "Best speaker-tab rank" is the smallest Open speaker rank anywhere, ignoring field size.
- Where: lib/cv/buildCvData.ts:1257-1263; lib/cv/headerMetrics.ts:97-99; lib/cv/milestones.ts:288; lib/cv/speakerStats.ts:933, :940
- Category: statistics and thresholds
- Source: UNVERIFIED guess
- If false: "#3" at a 20-speaker novice event beats "#5" at a 400-speaker major, in the header and in highlights.
- Check: owner: the raw rank, or rank as a share of speakers?
- Status: unverified

### C17. "Best speaker average" compares raw averages across formats.
- Where: lib/cv/buildCvData.ts:1265-1276; lib/cv/headerMetrics.ts:94-96
- Category: statistics and thresholds
- Source: UNVERIFIED guess
- If false: an average from a circuit that scores high, or from a short novice event, beats a BP major. The filterable stats page avoids this with per-format baselines (C48); the header does not.
- Check: owner: should this record be per format?
- Status: unverified

### C18. When the team tab has no rank column, rank is computed by wins, then team points, then team name; teams level on both share a rank.
- Where: lib/cv/teamRanks.ts:23-74
- Category: debate-domain
- Source: UNVERIFIED guess
- If false: BP tabs usually split teams level on points by total speaker score. Two teams on 15 points both get "4th", so the lower one shows a better rank than the tab gives it. Also, a row that already has a published rank returns before the "previous" tie values are updated (teamRanks.ts:57), so the computed row after it can miss a shared rank.
- Check: compare computed ranks with the published tab for a BP tournament with no rank column.
- Status: unverified

### C19. Tournament.totalTeams is the size of the team tab the rank is read against.
- Where: lib/cv/teamPlacement.ts:48-61 (rejects rank > teams); lib/cv/speakerStats.ts:522-528 (field-size buckets)
- Category: debate-domain
- Source: UNVERIFIED guess (the count is set at ingest, outside this area)
- If false: if the count includes swing teams or teams that withdrew, every "top N%" is slightly better than the tab. If it is a category tab's count, ranks past it are dropped without a message.
- Check: compare totalTeams with the number of rows on the team tab for a few tournaments with swings.
- Status: unverified

### C20. No user has more than five titles, top-10% finishes or breaks worth listing.
- Where: lib/cv/buildCvData.ts:1250-1253 (`.slice(0, 5)`); lib/cv/teamPlacement.ts:183-186, :202-205; components/CvHighlights.tsx:49-53, :60-64, :74-78
- Category: product and privacy
- Source: UNVERIFIED guess
- If false: each highlight title takes its count from the capped list. A user with 7 titles reads "Won 5 titles"; one with 12 top-10% team finishes reads "Top-10% team finish × 5".
- Check: seed a record with 6 or more titles.
- Status: unverified (looks like a bug)

### C21. A "major" is any tournament whose name matches one regex.
- Where: lib/cv/buildCvData.ts:1247-1248, :1281-1286; components/CvHighlights.tsx:120-124
- Category: debate-domain
- Source: UNVERIFIED guess
- If false: probe results. NOT matched: "World Universities Debating Championship 2024", "Worlds 2024", "European Universities Debating Championship", "Australasian Intervarsity Debating Championships", "North American Universities Debating Championship", "PAUDC 2024", "Asian BP 2024", "World Schools Debating Championships". Matched: "WUDC 2025", "Australs 2024", "United Asian Debating Championship", "World University Debating Championship".
- Check: owner lists the majors; test the regex against real stored tournament names.
- Status: unverified (the spelled-out names fail)

### C22. Only EUDC lets one team run in two brackets, so only EUDC gets a per-bracket breakdown.
- Where: lib/cv/buildCvData.ts:972-983; lib/calicotab/breakCategoryResolve.ts:151-154
- Category: debate-domain
- Source: documentation (PR #107 "EUDC dual-break")
- If false: at any other tournament where a team debates both Open and ESL outrounds, only the single deepest stage is kept, and the other bracket disappears from the CV.
- Check: owner: which tournaments let a team run in Open and a category bracket at once?
- Status: unverified

### C23. A title requires the team's deepest stage to be a final whose result reads "won". A missing result is unknown, not a loss.
- Where: lib/cv/buildCvData.ts:959-970; lib/cv/outroundFunnel.ts:139-179
- Category: debate-domain
- Source: documentation (comments, PR #100)
- If false: if the final's result appears only on a page that was not scraped, the champion shows as a finalist with no result.
- Check: count finals with `wonTournament === null`.
- Status: unverified

### C24. "Broke" means the team has any outround stage OR any break-tab rank.
- Where: lib/cv/speakerSignals.ts:25-38
- Category: debate-domain
- Source: UNVERIFIED guess
- If false: a team listed on the break that withdrew before the first outround still counts; a category break counts the same as an Open break in the header and the break rate; a Silver run counts (C9).
- Check: owner: is "broke" Open only, any non-consolation bracket, or any outround?
- Status: unverified

### C25. A judge "broke" when they judged any outround or are on the adjudicator break list, and judge breaks count in the same "Breaks" total as speaker breaks.
- Where: lib/cv/buildCvData.ts:895-903, :1125, :1239-1241; lib/cv/headerMetrics.ts:72-82; lib/cv/jsonResume.ts:124-133
- Category: debate-domain
- Source: UNVERIFIED guess (PR #175 fixed the double count but kept the merge)
- If false: a user who mostly speaks, and who judged one outround at a tournament where their team did not break, gets "Breaks: N+1" in the header. That reads as a speaking break.
- Check: owner: should the header's "Breaks" count speaker breaks only?
- Status: unverified

### C26. The header break rate divides by every tournament on the record, including judge-only and unmatched ones. The stats page divides by tournaments spoken.
- Where: lib/cv/buildCvData.ts:1232 (`totalTournaments = tournamentIds.length`, every ingested URL); lib/cv/headerMetrics.ts:77; lib/cv/speakerStats.ts:887
- Category: statistics and thresholds
- Source: UNVERIFIED guess
- If false: take 10 tournaments spoken with 5 breaks, plus 5 judged and 2 unmatched. The header says "29% of entries" (5 of 17) while /cv/stats says 50%.
- Check: compare the two figures on one record.
- Status: unverified

### C27. A user is "speaker-leaning" when speaking tournaments are at least 3 times judging tournaments (and the reverse for "judge-leaning"); the header shows at most 4 tiles.
- Where: lib/cv/headerMetrics.ts:56-57, :117
- Category: product and privacy
- Source: UNVERIFIED guess
- If false: a user with 10 tournaments spoken and 4 judged gets the mixed strip (Breaks, Prelims chaired, Outrounds chaired) and loses "Best team finish".
- Check: owner picks the ratio.
- Status: unverified

### C28. Adjudication core (CA, DCA, tab director) is a judging role and gets a judge row.
- Where: lib/cv/judgingLens.ts:110-120; lib/cv/buildCvData.ts:1279
- Category: debate-domain
- Source: UNVERIFIED guess (PR #104 added Tab Director to the core tag)
- If false: a tab director counts as having judged the tournament, and if they appear on outround panels, as having "broken as adjudicator".
- Check: owner: is a tab director a judge on the CV? Is a CA's outround a "break"?
- Status: unverified

### C29. When a person has several judge participations at one tournament, the richest one is kept, by a score: appointment tag +1, +1 per prelim chaired, +5 for an outround chaired, +3 for an outround paneled.
- Where: lib/cv/buildCvData.ts:1046-1058
- Category: debate-domain
- Source: UNVERIFIED guess
- If false: the weights are arbitrary. A row with 6 chaired prelims outweighs a row with an outround chair (5).
- Check: count tournaments where one user has more than one judge participation.
- Status: unverified

## B. Rounds, scores and averages

### C30. Rounds numbered above the prelim count are outrounds; when the prelim count is unknown, every round is treated as a prelim.
- Where: lib/cv/speakerStats.ts:1061-1080 (`prelimScope`); lib/cv/statsFacts.ts:230; lib/cv/roundLedger.ts:43. Only lib/cv/milestones.ts:218-241 bounds prelims by the last round with team points.
- Category: debate-domain
- Source: documentation (comments)
- If false: with no prelim count, an outround speaker score (if the tab publishes one) enters the score profile, splits and round curve on /cv/stats, while milestones excludes it. Outround "advancing" results also count as round wins.
- Check: count speaker rows with `prelimRoundCount == null` that have round scores above the last round with team points.
- Status: unverified

### C31. Speaker average: the tab's "Average" cell; else total / rounds with a parsed score; else the mean of parsed scores; else total / prelim count.
- Where: lib/cv/computeSpeakerAvg.ts:21-53; lib/cv/buildCvData.ts:935-948
- Category: statistics and thresholds
- Source: documentation (PR #76, #100)
- If false: a 9-round total of 675 with only 8 parsed cells gives 675 / 8 = 84.4 instead of 75.0. Also, `numericScores` drops round 0 and 'average' rows but not outrounds, so an outround speech cell would enter the count.
- Check: find rows where total / prelimsSpoken differs from the mean of roundScores by more than 1.
- Status: unverified

### C32. Reply speeches (World Schools, Australs, Asian Parliamentary) need no special handling.
- Where: nothing in lib/ mentions "reply" (grep). Scores are keyed by round number only; lib/cv/statsFacts.ts:141-149 keeps one score per round.
- Category: debate-domain
- Source: UNVERIFIED guess
- If false: if a tab publishes a reply score as a separate cell for the same round, one of the two overwrites the other in the round table (a Map keyed by round), and the speaker average mixes a reply of about 37/50 with substantives of about 75/100.
- Check: look at a stored WSDC tournament's SpeakerRoundScore rows for two scores in one round.
- Status: unverified

### C33. A tournament's field average = the mean of every speaker's TOTAL / prelim count, including swings and speakers who missed rounds.
- Where: lib/cv/buildCvData.ts:1162-1229; comment at :287-292
- Category: statistics and thresholds
- Source: documentation (the comment calls it "approximate otherwise")
- If false: swing speakers and late arrivals pull the field mean down and widen its spread, so "+3.4 vs field" overstates the gap and z-scores come out smaller than they should.
- Check: recompute one tournament's field mean from per-round scores and compare.
- Status: unverified

### C34. z-score = (your average - field mean) / the field's population standard deviation, per tournament. The career figure is a plain, unweighted mean of the per-tournament z-scores.
- Where: lib/cv/speakerStats.ts:619-661; lib/cv/buildCvData.ts:1203-1221
- Category: statistics and thresholds
- Source: UNVERIFIED guess
- If false: a 20-speaker novice IV counts as much as an 800-speaker Worlds. No minimum field size applies to a z-score, and the career mean has no minimum number of tournaments (the finding needs 3; the tile needs none).
- Check: owner: weight by field size, or set a minimum field?
- Status: unverified

### C35. A tournament where the user was scored in fewer rounds than the prelim count is left out of the career speaker-tab aggregates.
- Where: lib/cv/speakerStats.ts:639-661; lib/cv/buildCvData.ts:311-325
- Category: statistics and thresholds
- Source: documentation (comment, from a real "+3.4 above the field, placed 89th of 89" case)
- If false: one unparsed cell excludes the whole tournament. The export's field columns (C57) do not apply the same exclusion.
- Check: compare `incompleteDraws` with the number of tournaments where the user really missed a round.
- Status: unverified

### C36. Within a season, tournaments are ordered by when their private-URL emails arrived.
- Where: lib/cv/speakerStats.ts:397-419; lib/cv/buildCvData.ts:397-422. Contrast lib/cv/milestones.ts:11-30, which says the order within a season is unknown.
- Category: statistics and thresholds
- Source: documentation (stats task map R1); PR #175 limited it to the user's own URLs
- If false: private URLs are often sent weeks before a tournament, and sometimes re-sent later, so streaks (C41) can run across tournaments in the wrong order. Milestones refuses to use this date, so the two sections hold different views of the same order.
- Check: compare emailDate with real tournament dates for one season.
- Status: unverified (the code is inconsistent with itself)

### C37. A season is the calendar year stored on the tournament.
- Where: lib/cv/speakerStats.ts:918-959 (`seasons`, `judgingSeasons`), :822 (`byYear`); lib/cv/milestones.ts:133-141, :252-263; lib/cv/buildCvData.ts:1288-1293
- Category: debate-domain
- Source: UNVERIFIED guess
- If false: university circuits run from about September to August, and Worlds straddles New Year. "2024" then mixes the end of one season with the start of the next, and "first break: 2021" may belong to the 2020-21 season.
- Check: owner: calendar year or academic season, and which month starts it?
- Status: unverified

### C38. Undated tournaments are treated as recent: they sort last in the streak order and are left out of seasons, firsts and runs. But on the newest-first /cv tables and in JSON Resume they appear at the bottom, the position of the oldest.
- Where: lib/cv/speakerStats.ts:397-411, :918-928; lib/cv/milestones.ts:25-30, :133-141; lib/cv/buildCvData.ts:1038-1043, :1129-1134; lib/cv/jsonResume.ts:141-142
- Category: statistics and thresholds
- Source: documentation (comments say an undated row is "usually a recent ingest")
- If false: an old undated tournament breaks or extends the most recent streak; on the CV table, a recent undated event sits below the oldest one.
- Check: count undated tournaments and look up their real dates.
- Status: unverified

### C39. Years active = last year - first year + 1, counting speaking and judging together.
- Where: lib/cv/speakerStats.ts:962-984; lib/cv/buildCvData.ts:1288-1293
- Category: statistics and thresholds
- Source: UNVERIFIED guess
- If false: a gap year still counts, and one judged tournament five years later stretches the span.
- Check: owner confirms the wording.
- Status: unverified

### C40. A BP round counts as "won" only when the team placed 1st. Career win rate, streaks, partner win rate and the field-size finding pool BP rounds with two-team rounds.
- Where: lib/calicotab/parseTabs.ts:374-382 (won = 1st place); lib/cv/buildCvData.ts:886. Pooled at lib/cv/speakerStats.ts:847-870, :893-906, :1236-1256 and lib/cv/teammateStats.ts:41-50.
- Category: debate-domain
- Source: documentation for the definition (design doc: "a win means 1st of four in BP"). The pooling is an UNVERIFIED guess.
- If false / as built: a mostly-BP career has a win rate near 25-35%, a mostly two-team one near 50%, so the pooled rate moves with the mix of formats. The field-size finding ("your round win rate drops 14 points at 100+ team events") can come purely from majors being BP and small events being AP. lib/cv/statsFilter.ts:113-123 hides only "seat-spread" and "motion-type" for this reason; "field-size", "streak" and "topic-weakness" still show.
- Check: owner: is a BP 2nd a "win" for streaks? Should the remaining findings be per format?
- Status: unverified

### C41. A win streak is the longest run of won rounds across the whole career in date order, counting only rounds with a recorded result; it becomes a finding at 5.
- Where: lib/cv/speakerStats.ts:850-870, :1258-1266
- Category: statistics and thresholds
- Source: UNVERIFIED guess
- If false: depends on C36 and C40. Five BP 1sts in a row is rare and five two-team wins is ordinary, yet both meet the same bar.
- Check: owner picks a threshold per format.
- Status: unverified

### C42. Thresholds for findings ("quirks").
- Where: lib/cv/speakerStats.ts:59-61 (MIN_QUIRK_ROUNDS 6, MIN_QUIRK_TOURNAMENTS 4) and :1141-1279:
  - momentum: a gap of at least 0.3, over at least 3 tournaments with 6+ scored rounds;
  - consistency: at least 15 speeches;
  - team and speaker percentile: at least 3 tournaments;
  - seat spread: at least 12 points;
  - motion type: at least +10 points;
  - topic weakness: -0.5 or lower, with at least 2 topics;
  - field size: a gap of at least 12 points, with at least 2 tournaments in each bucket;
  - streak: 5 or more;
  - break rate: at least 4 tournaments;
  - "positive" tone: break rate of 50% or more, team top-% of 50% or less.
- Category: statistics and thresholds
- Source: documentation for the 6 rounds (filterable-stats design, "approved in conversation 2026-09-17"). Every other number is an UNVERIFIED guess.
- If false: for example, "topic weakness" fires on 6 rounds at -0.5, which can be a few judges' half points.
- Check: owner reviews the list.
- Status: unverified (except the 6 rounds, which is documented)

### C43. Momentum = the mean of the last three scored prelims minus the mean of the first three, and it reflects the speaker's form.
- Where: lib/cv/speakerStats.ts:728-736, :1141-1156
- Category: debate-domain
- Source: UNVERIFIED guess
- If false: power pairing puts stronger teams together in later rounds, and many tournaments hold silent final rounds, so a late-round shift in score may come from the draw rather than the speaker.
- Check: owner's judgement.
- Status: unverified

### C44. Field-size buckets are under 24, 24-47, 48-99 and 100+ teams.
- Where: lib/cv/speakerStats.ts:516-531
- Category: debate-domain
- Source: UNVERIFIED guess
- If false: the owner may think in other bands (for example under 32 / 32-63 / 64+).
- Check: owner.
- Status: unverified

### C45. Small-sample floors in round dynamics: a slope needs 3 scored rounds, a standard deviation needs 2, and a "best round number" needs 2 speeches in that round.
- Where: lib/cv/speakerStats.ts:355-378, :722-727, :748-767
- Category: statistics and thresholds
- Source: UNVERIFIED guess
- If false: "your best round is R9" can rest on two speeches.
- Check: owner.
- Status: unverified

### C46. A split row is "thin" (shown without figures) below 6 rounds, 6 scored speeches or 6 decided rounds, and the topic x type heatmap uses the same 6. Cross-tab findings also need 2 tournaments and an interaction of at least 0.5 points, with 3 shown each way.
- Where: lib/cv/roundSplits.ts:29-30, :119-123; lib/cv/statsHeatmap.ts:73-84; lib/cv/crossTabs.ts:29-32
- Category: statistics and thresholds
- Source: documentation for the 6 (design doc). The 0.5, the 2 tournaments and the 3 findings are UNVERIFIED guesses.
- If false: a 6-round heatmap cell can come from one weekend at one tournament, because the heatmap has no tournament minimum.
- Check: owner.
- Status: partly documented

### C47. Cross-tab findings assume effects add up: interaction = cell delta - (row effect + column effect).
- Where: lib/cv/crossTabs.ts:126-156
- Category: statistics and thresholds
- Source: documentation (comment)
- If false: with few rounds, both effects are noisy and the interaction inherits both errors.
- Check: nothing needed unless the owner wants a simpler rule.
- Status: unverified

### C48. On the filterable stats page, deltas are per format: each round is compared with the user's own mean score (and win rate) in that format. A four-seat position counts as BP whatever the tab's format says.
- Where: lib/cv/roundSplits.ts:1-24, :56-74; lib/cv/statsFacts.ts:96-119
- Category: statistics and thresholds
- Source: documentation (design doc, approved in conversation 2026-09-17)
- If false: n/a. Listed because the older engine figures (C17, C40) do not follow it.
- Check: none.
- Status: documented

### C49. Pro-am: you are the pro when your average is MORE than 1.5 points above your partners' mean, and the am when it is more than 1.5 below; exactly 1.5 is peers. Averages use only scored prelim speeches, and a teammate with no scored speech is ignored.
- Where: lib/cv/statsFacts.ts:21-25, :121-173
- Category: debate-domain
- Source: documentation (design doc "approved in conversation 2026-09-17"; docs/HANDOFF.md)
- If false: 1.5 points on a BP scale is a modest gap; a real pro-am pairing (a novice with a WUDC breaker) is usually 3 points or more apart.
- Check: owner confirms 1.5.
- Status: documented, not confirmed by the owner in this register

### C50. A round counts as "level" in the carry index when you are within half a point of your partners.
- Where: lib/cv/roundViews.ts:20-26, :54-60
- Category: statistics and thresholds
- Source: documentation (the comment cites the reference record)
- If false: the owner may see a full point as level.
- Check: owner.
- Status: unverified

## C. Motions and tags

### C51. When a round releases several motions, all of them are credited to the round. The round gets a type only if every motion shares it; otherwise it goes in a "mixed" bucket.
- Where: lib/cv/statsFacts.ts:175-199; lib/cv/statsHeatmap.ts:52-60; lib/cv/motionEntries.ts:46-49; lib/cv/exportFields.ts:250-264
- Category: debate-domain
- Source: documentation (design doc)
- If false: n/a (per-room motion data is not scraped).
- Check: none.
- Status: documented

### C52. Motion type is read from the wording:
- THW / "will" = Policy
- THBT / "predicts" = Belief
- THS, THO, "condemns", "rejects", "welcomes" = Stance
- THR = Regret
- THP / "hopes" = Preference
- "TH, as X, would" = Actor
- an Australs "That ..." motion is Belief unless it says "we" or "should"

- Where: lib/motions/classify.ts:1-28, :49-75, :193-226
- Category: debate-domain
- Source: documentation (design doc table, approved in conversation 2026-09-17). The extensions (will, hopes, condemns, welcomes, THC) are UNVERIFIED.
- If false: "THBT states should ban X" is classed as Belief, though some circuits treat it as close to policy. THO is grouped with THS.
- Check: owner reviews the stem table.
- Status: partly documented

### C53. Two motion-type systems exist side by side.
- Where: lib/tags/vocabulary.ts:36-48 defines THBT/THW/THS/THO/THR/THP/Other (admin-approved, suggested by Haiku at lib/tags/classifyMotions.ts:88-94). It feeds lib/cv/speakerStats.ts:824-827 and lib/cv/exportFields.ts:162-166. lib/motions/classify.ts (Policy/Actor/...) feeds lib/cv/statsFacts.ts:180.
- Category: product and privacy
- Source: documentation (the design doc keeps both)
- If false: the export's "Motion types" column and the engine's motion-type split say "THBT" where the filterable page says "Belief"; an actor motion is "Other" in one system and "Actor" in the other.
- Check: owner: retire the stem tag?
- Status: unverified

### C54. Topics are 14 fixed subject areas, one per motion. Regions are 11, one per tournament, and never scraped. Approving one proposal also approves identical pending ones; proposals with a different value stay pending.
- Where: lib/tags/vocabulary.ts:21-66; lib/tags/approve.ts:11-62
- Category: debate-domain
- Source: documentation (comments)
- If false: a motion about AI in warfare fits both "Science & Technology" and "Conflict & Security", and an online tournament can have only one region.
- Check: owner.
- Status: unverified

### C55. Haiku (claude-haiku-4-5) suggests tags in batches of 20 motions or 30 tournaments. An "Unsure" region is dropped, and nothing is applied without admin approval.
- Where: lib/tags/classifyMotions.ts:17-29; lib/tags/classifyTournaments.ts:11-19
- Category: operations and limits
- Source: documentation (CLAUDE.md)
- If false: n/a.
- Check: none.
- Status: documented

### C56. The motion archive lists every motion of a tournament the user spoke at, including outrounds they did not reach. The export lists only motions of rounds they debated, and a judge-only tournament lists only the rounds the user sat.
- Where: lib/cv/motionEntries.ts:33-51, :72-101; lib/cv/exportFields.ts:243-264
- Category: product and privacy
- Source: documentation (comments, PR #130)
- If false: /cv/motions shows the Grand Final motion under a tournament where the user went out in the prelims; the export does not. Where the user both spoke and judged at one tournament (for example, judged an outround after not breaking), the judged rounds are not marked.
- Check: owner: should the archive match the export?
- Status: unverified

## D. Exports and outputs

### C57. Export column meanings.
- Where: lib/cv/exportFields.ts:95-214
- Category: product and privacy
- Source: documentation (CLAUDE.md: the column list is "append-only")
- What the columns mean:
  - `field_placement` is the speaker tab by total ("12/214"), not flagged when the draw was incomplete (C35);
  - `field_delta` is your average minus the field mean (C33);
  - `team_points` falls back to "NW" (number of wins);
  - `last_outround_spoken` gets "(W)" for any final won (C10);
  - `broken` follows C24;
  - `motion_types` is the stem tag (C53).
- If false: a spreadsheet reader takes "(W)" for an Open title, and "89/89" for a bad result when the user simply missed rounds.
- Check: owner reads one exported row against the tab.
- Status: unverified

### C58. JSON Resume awards: "Champion" if any final was won; else "Broke" if the team broke; else "Nth best speaker" if the Open speaker rank is 10 or better, at any field size. Judges get an award only if they broke.
- Where: lib/cv/jsonResume.ts:40, :102-133
- Category: product and privacy
- Source: documentation (docs/OPUS_TASKS.md: "the report recommended top 10")
- If false: "3rd best speaker" at a 12-speaker event; "Champion" from a Silver final (C10).
- Check: owner.
- Status: documented, not owner-confirmed

### C59. When the tab's rank cell does not parse, the Open speaker rank falls back to a rank derived at ingest from speaker totals.
- Where: lib/cv/buildCvData.ts:1006-1010
- Category: statistics and thresholds
- Source: documentation (comment)
- If false: if the derived rank uses ROW_NUMBER, tied speakers get different ranks in arbitrary order. C6 does the opposite for the speaker-tab placement, so the two figures can differ by a few places.
- Check: read the ingest SQL for speakerRankOpenDerived (ingest area).
- Status: unverified

### C60. Only speaker statistics are built.
- Where: lib/cv/speakerStats.ts. But lib/cv/judgingLens.ts and components/stats/JudgingViews.tsx (commit bdb818c) render a judging lens and a "speaking vs judging" section on /cv/stats (components/stats/FilterableStats.tsx:133-134, :239-240).
- Category: product and privacy
- Source: owner statement
- If false / as built: judging sections exist: chair rate by season, judging depth, appointments, and the speaking-vs-judging turn (MIN_LEADING_SIDE = 3 at judgingLens.ts:287).
- Check: owner: does "only speaker stats" mean the deep statistics engine only, or should the judging sections go?
- Status: **contradicted** in part (judging sections are on the page)

### C61. A speaker sits on one team per tournament. When a person has several speaker participations at one tournament, the richest one is kept (score total +4, team name +2, outround +1).
- Where: lib/cv/buildCvData.ts:905-922; lib/cv/speakerStats.ts:830-832
- Category: debate-domain
- Source: owner statement (one team per speaker in Tabbycat; swing-team organisers can be listed on several)
- If false / as built: a swing-team organiser listed on three swing teams gets one row from one team, and the other teams' rounds are dropped from their CV. That suits normal speakers but not organisers.
- Check: find users with more than one speaker participation at one tournament.
- Status: **confirmed by owner** (the rule); the organiser case is not handled

### C62. A person cannot speak and judge in the same round.
- Where: on the CV side, buildCvData keeps separate speaker and judge rows per tournament and counts the tournament once (lib/cv/buildCvData.ts:1232-1241), and the motion archive prefers the speaker row (lib/cv/motionEntries.ts:74-77). Nothing in lib/cv checks the rule.
- Category: debate-domain
- Source: owner statement
- If false: n/a. Enforcement belongs to identity (the other register).
- Check: none.
- Status: **confirmed by owner**

### C63. Score histograms assume a 50-100 style scale: whole-point bins up to a 20-point spread, 2-point bins up to 40, wider beyond that.
- Where: lib/cv/speakerStats.ts:1029-1060
- Category: statistics and thresholds
- Source: documentation (comment)
- If false: a record that mixes in reply speeches (C32), or uses another scale, gets wider bins.
- Check: none.
- Status: unverified

### C64. Break margin: the Open break line is the points (BP) or wins (every other format) of the lowest team on the Open break tab. "Missed by one" means 1 team point in BP or 1 win elsewhere. A tournament is BP only if its format string is "british parliamentary".
- Where: lib/cv/breakMargin.ts:1-38, :140-171
- Category: debate-domain
- Source: documentation (the comment cites two corpora)
- If false: a tab whose format reads "BP" is measured in wins. In BP, one point short is common, while one win short in a two-team format is a bigger gap, yet both are "missed by one".
- Check: list the distinct `Tournament.format` values.
- Status: unverified

### C65. On the per-round ledger, outround names are counted back from the deepest stage. This assumes consecutive outround numbers on the plain ladder (triple octofinals to final).
- Where: lib/cv/roundLedger.ts:15-60
- Category: debate-domain
- Source: documentation (comment)
- If false: a partial round or an extra round shows "Round 11" instead of a name, which is a safe fallback.
- Check: none.
- Status: documented

### C66. The public CV does not need field placement, so /u calls buildCvData without field stats.
- Where: lib/cv/buildCvData.ts:345-355; app/u/[slug]/page.tsx:88
- Category: product and privacy
- Source: documentation (comment)
- If false: n/a. Listed so the owner knows /u shows the user's own figures only (privacy entries below).
- Check: none.
- Status: documented

---

## E. Sign-in, tokens and Gmail scope

### C67. Google sign-in always asks for the Gmail read-only scope, and asks for consent on every sign-in.
- Where: lib/auth.ts:71-77 (`access_type: 'offline'`, `prompt: 'consent'`, scope `openid email profile https://www.googleapis.com/auth/gmail.readonly`)
- Category: auth and security
- Source: owner decision C (docs/superpowers/specs/2026-10-26-paste-a-url-threat-model.md:45, "keep the Gmail read (and its scope)")
- If false: a user who only wants to paste URLs still sees the Gmail permission screen and may abandon sign-in; the app also stays subject to Google's restricted-scope verification.
- Check: sign in with a fresh Google account; read the consent screen.
- Status: confirmed by owner (C). Side effect not discussed with owner: `prompt: 'consent'` re-shows the consent screen on every sign-in, not only the first.

### C68. A failed Gmail token save must not block sign-in; the user is signed in without Gmail access.
- Where: lib/auth.ts:50-60, 64-66, 113-118; lib/authAdapter.ts:25
- Category: auth and security
- Source: documentation (PR #157 "a failed Gmail token save must not break sign-in")
- If false: the user sees a working CV but "reconnect Gmail" with no explanation of why; only Sentry knows.
- Check: Sentry tag `area: auth.linkAccount` / `auth.signIn` counts.
- Status: unverified

### C69. A token saved by the adapter in the last 60 seconds is the same token the signIn event sees, so the second save can be skipped.
- Where: lib/authAdapter.ts:51-69 (`SAVED_TTL_MS = 60_000`, in-memory map keyed by provider, account id and SHA-256 of the access token)
- Category: auth and security
- Source: documentation (PR #173 "one Gmail token save per sign-in")
- If false: the map is per serverless instance; if the adapter and the event ran on different instances (they normally run in one request), the token is simply saved twice, which is harmless.
- Check: read whether entries are evicted after expiry (lib/authAdapter.ts:58-75).
- Status: unverified

### C70. Sessions are stored in the database with Auth.js defaults (30-day session, no custom maxAge).
- Where: lib/auth.ts:81 (`session: { strategy: 'database' }`, no maxAge set)
- Category: auth and security
- Source: UNVERIFIED guess (library default left in place)
- If false: if the owner expects shorter sessions on shared computers (club laptops), a signed-in session lasts a month.
- Check: Auth.js v5 beta.25 default `maxAge`; Session table expiry values.
- Status: unverified

### C71. Gmail tokens are encrypted with AES-256-GCM using a 32-byte base64 key from `TOKEN_ENCRYPTION_KEY`, format `v1:<iv>:<tag>:<cipher>`.
- Where: lib/crypto.ts:16-28, 40-52
- Category: auth and security
- Source: documentation (PR #18; CLAUDE.md "Secrets")
- If false: a key of the wrong length throws at encrypt time, so sign-in saves fail (see C68) and no one gets Gmail access.
- Check: Vercel env has a 44-character base64 value; `GmailToken.encryptionVersion = 'v1'` on all rows.
- Status: unverified

### C72. If `TOKEN_ENCRYPTION_KEY` is missing, tokens are stored in PLAINTEXT rather than refused.
- Where: lib/crypto.ts:41-43 (`if (!key) return { value: plaintext, version: null }`), 61-62 (null version read back as plaintext)
- Category: auth and security
- Source: documentation (comment: "so dev environments without the env var stay functional")
- If false (i.e. the assumption that prod always has the key): one deploy with the variable unset (a new preview environment, a renamed variable) silently writes refresh tokens in clear text, and nothing alerts.
- Check: `SELECT count(*) FROM "GmailToken" WHERE "encryptionVersion" IS NULL;` in production.
- Status: unverified

### C73. There is only one encryption key version; rotating the key makes every stored token unreadable.
- Where: lib/crypto.ts:16, 64-66 (`Unsupported token encryption version`)
- Category: auth and security
- Source: UNVERIFIED guess
- If false: the operator checklist (docs/HANDOFF.md:119) asks to rotate secrets; rotating this one throws on decrypt for every user, so every background scan fails until each user signs in again.
- Check: confirm no rotation procedure exists; try decrypt with a new key in a test.
- Status: unverified

### C74. When Google says the grant is revoked or expired, the stored token is deleted quietly and the user is told to sign in again; this is not reported as an error.
- Where: app/api/ingest/gmail/route.ts:67-85; lib/gmail/backgroundScan.ts:163-169; lib/gmail/client.ts:184-201
- Category: auth and security
- Source: documentation (PR #52, #164)
- If false: if `isRefreshTokenInvalid` misclassifies a transient Google error as revocation, the user's token is destroyed and they must sign in again to resume scanning.
- Check: lib/gmail/errors.ts patterns against real Google error bodies.
- Status: unverified

### C75. Admins are whoever's email is listed in the `ADMIN_EMAIL` env variable (comma-separated, case-insensitive); no database role.
- Where: lib/admin.ts:9-27
- Category: auth and security
- Source: documentation (CLAUDE.md "admin allowlist")
- If false: adding or removing an admin needs an env change and redeploy.
- Check: Vercel env value.
- Status: unverified

## F. Gmail scanning: cadence, windows and caps

### C76. The manual "Scan Gmail" button has a 2-minute cooldown shared with the background scan and the scan that runs when /cv is opened.
- Where: app/api/ingest/gmail/route.ts:14-21, 34-48 (`SCAN_COOLDOWN_MS = 2 * 60 * 1000`)
- Category: operations and limits
- Source: owner statement (PR #164 "Manual Scan Gmail cooldown 5 min to 2 min")
- If false: none for correctness; but two comments still say 5 minutes (lib/rateLimit.ts:38 "5-minute cooldown"; components/AutoScanOnVisit.tsx:38 "The 5-min server-side cooldown"), so anyone reading them is misled.
- Check: grep for "5-min"/"5-minute" near scan code.
- Status: confirmed (value); two comments contradicted by code.

### C77. Opening /cv triggers a Gmail scan at most once per browser tab session every 5 minutes (client-side), and errors are silent.
- Where: components/AutoScanOnVisit.tsx:38-55; app/(app)/cv/page.tsx:122
- Category: operations and limits
- Source: UNVERIFIED guess
- If false: each /cv visit also consumes one of the 12-per-hour `ingest:gmail` units (C79), so a user who opens /cv many times in new tabs can exhaust the hourly cap and then be blocked from pressing Scan Gmail.
- Check: open /cv in 13 fresh tabs more than 2 minutes apart within an hour, then press Scan Gmail.
- Status: unverified

### C78. A background Gmail scan reaches each connected user about every 30 minutes.
- Where: app/api/cron/process-queue/route.ts:111-150 (`BACKGROUND_SCAN_INTERVAL_MIN`, default 30, minimum 5; `SCAN_MAX_USERS = 2`; `SCAN_BUDGET_MS = 12_000`); privacy page app/(app)/privacy/page.tsx:36
- Category: operations and limits
- Source: owner statement (PR #164 "Owner request: use the cron job for the Gmail scan too, and scan more often")
- If false: the real cadence is set by how often the cron endpoint is called times 2 users per call. Vercel cron is once a day (vercel.json); the GitHub drain is every 15 minutes only if its secrets are set (docs/HANDOFF.md:740); cron-job.org job 8720055 has an undocumented cadence. At 15-minute ticks, 2 users per tick covers 8 users per hour, so with 9 users each is scanned about every 68 minutes, not 30; with only the daily Vercel cron, 2 users a day. The privacy page promises "about every 30 minutes".
- Check: count GmailToken rows; read the `lastScannedAt` spread in production; confirm the tick frequency of each scheduler.
- Status: confirmed as intent; delivery unverified and false above about 16 users even at 15-minute ticks.

### C79. Twelve Gmail scans per user per hour is a sensible ceiling (on top of the 2-minute cooldown).
- Where: lib/rateLimit.ts:38-40 (`'ingest:gmail': { limit: 12, windowSec: 3600 }`)
- Category: operations and limits
- Source: documentation (PR #164 "The 12 per hour cap is unchanged")
- If false: background scans do NOT consume this budget, but /cv auto-scans do (C77).
- Check: as C77.
- Status: unverified

### C80. Incremental scans only look at mail newer than the latest URL already found, minus one day.
- Where: lib/gmail/scanUser.ts:37-44 (`- 86_400_000`); lib/gmail/run.ts:84-88 (date string built in server local time, which is UTC on Vercel)
- Category: operations and limits
- Source: documentation (PR #67 "incremental scan")
- If false: a private-URL email with an older date (forwarded mail keeps the forward date, but mail imported from another account or re-sent by an organiser for an old tournament keeps its original date) is never found by later scans.
- Check: import an old private-URL email into Gmail and press Scan Gmail.
- Status: unverified

### C81. The first scan reads at most the newest 500 matching messages, and that is enough to cover a debater's whole history.
- Where: lib/gmail/run.ts:8 (`DEFAULT_MAX_MESSAGES = 500`), 89-100; combined with C80
- Category: operations and limits
- Source: UNVERIFIED guess (PR #108 removed the 5-year limit but not the 500 cap)
- If false: the search `(calicotab.com OR herokuapp.com OR yellowtabs.com OR privateurls)` (lib/gmail/run.ts:6) also matches Heroku service mail and tab-release newsletters. A user with more than 500 such messages gets only the newest 500 on the first scan; every later scan starts after the newest URL found, so older tournaments are never reached. Example: an adjudicator with 8 years of Calicotab mail (draw releases, feedback reminders) loses everything older than the 500th message.
- Check: compare `scanned` in the first scan response with 500; for a heavy user, run a Gmail search with `before:` to count URLs that were never found.
- Status: unverified

### C82. Only three tab hosts exist: `*.calicotab.com`, `*.herokuapp.com`, `*.yellowtabs.com`, and private URLs always look like `/<slug>/privateurls/<token>/`.
- Where: lib/gmail/extract.ts:14, 22; lib/gmail/run.ts:6
- Category: operations and limits
- Source: documentation (CLAUDE.md; PR #150 for Yellow Tab)
- If false: a self-hosted Tabbycat on its own domain, or an install without the slug segment, is never found and cannot be pasted. (URL shape details belong to the ingest register.)
- Check: owner's knowledge of circuits that self-host.
- Status: unverified

### C83. Gmail 429/503 responses are retried with exponential backoff (500 ms x 2^i plus jitter, or Retry-After).
- Where: lib/gmail/run.ts:12-46
- Category: operations and limits
- Source: documentation (PR #55)
- If false: a long Retry-After can exceed the 12-second background budget or the 60-second route; the scan fails and is retried next interval.
- Check: Sentry `stage: gmail-scan` errors.
- Status: unverified

### C84. A mailbox that keeps failing (not a revoked grant) waits one full interval before the next attempt.
- Where: lib/gmail/backgroundScan.ts:118-123, 170-177; app/api/cron/process-queue/route.ts:139-141
- Category: operations and limits
- Source: documentation (PR #164)
- If false: failures stamp `lastScannedAt`, which also blocks the user's manual scan for 2 minutes and shows a "last scanned" time for a scan that did not happen.
- Check: dashboard "last scanned" display vs Sentry errors for that user.
- Status: unverified

## G. Paste-a-URL and CSV

### C85. Pasting one URL is limited to 20 per user per hour; there is no separate daily cap on single pastes.
- Where: lib/rateLimit.ts:35-37 (`'ingest:url': { limit: 20, windowSec: 3600 }`); app/api/ingest/url/route.ts:34
- Category: operations and limits
- Source: owner decision D (threat model :46 "keep the daily cap per user, and 20 URLs per paste")
- If false: the owner's "daily cap" exists only for CSV (C86). Single pastes allow 20 an hour, up to 480 a day, each a full scrape.
- Check: confirm with owner whether "daily cap" was meant to cover single pastes.
- Status: contradicted in part (hourly, not daily, for single pastes).

### C86. A CSV upload holds at most 20 usable URLs and 64 KB, and a user may upload 5 CSVs a day (100 URLs a day).
- Where: lib/ingest/csvUrls.ts:19-21, 94; lib/rateLimit.ts:42-43 (`'ingest:csv': { limit: 5, windowSec: 86400 }`); app/api/ingest/csv/route.ts:148-157
- Category: operations and limits
- Source: owner decision D
- If false: the figure 5 a day is not in the owner's answer; it was chosen by the implementer.
- Check: ask owner whether 5 uploads a day is right.
- Status: confirmed by owner (20 per upload, a daily cap exists); the number 5 is unverified.

### C87. A close-enough name match between the tab registration and the Google profile name is acceptable proof of identity.
- Where: lib/identity/nameProximity.ts:69, 101; called only from app/api/onboarding/names/route.ts
- Category: auth and security
- Source: owner decision A (threat model :43)
- If false: N/A (owner confirmed). Note: the proximity check is wired only into the onboarding names route; neither the paste route nor the CSV route calls it, so a pasted URL under someone else's name is not held for confirmation as decision A's consequence (threat model :49) describes. Detail belongs to the identity register.
- Check: grep callers of `nameProximity` / `proximityToYou`.
- Status: confirmed by owner; implementation partial.

### C88. After a successful ingest the stored private URL is deleted (redacted).
- Where: not implemented. Private URLs remain in `DiscoveredUrl.url` and `.token` (prisma/schema.prisma:134-166), `IngestJob.url` / `lastError`, and `SourceDocument.url` (schema :578; the prune keeps the newest snapshot per URL forever, CLAUDE.md "Known gaps"). Design exists: docs/superpowers/specs/2026-10-26-private-url-redaction-design.md; there is no `redactPrivateUrl` in lib/.
- Category: product and privacy
- Source: owner decision B (the threat model at :44 still says "not yet answered"; the redaction design at :3 records it as decided)
- If false: today a database leak exposes every user's working private URL, which opens that person's private Tabbycat page (and, during a live tournament, their ballot or feedback forms).
- Check: `SELECT count(*) FROM "DiscoveredUrl" WHERE url LIKE '%/privateurls/%' AND "ingestedAt" IS NOT NULL;`
- Status: contradicted (owner decided B; code does not do it yet).

### C89. Private URLs never appear in API responses or error tracking (CSV route never echoes them; the tournament row holds only the public address).
- Where: app/api/ingest/csv/route.ts:155-156, 180-183; lib/cv/publicTournamentUrl.ts; app/api/account/export/route.ts:58-59, 67 (omits `sourceUrlRaw`)
- Category: product and privacy
- Source: documentation (PR #131, #133)
- If false: two paths still expose them. Admins' /api/ingest/progress `global` scope returns `currentUrl` of whichever job is running, i.e. another user's private URL (app/api/ingest/progress/route.ts:105, 133-136). Cron terminal failures send `extra: { url: job.url }` to Sentry (app/api/cron/process-queue/route.ts:170-175).
- Check: call /api/ingest/progress as admin while another user's job runs; search Sentry events for "privateurls".
- Status: contradicted (two leak paths found).

## H. Queue, cron and time budgets

### C90. Vercel Hobby limits a function to 60 seconds; every ingest must stop itself at 55 seconds.
- Where: app/api/ingest/url/route.ts:16, 26; app/api/cron/process-queue/route.ts:20-23; app/api/ingest/drain/route.ts:24-30
- Category: operations and limits
- Source: documentation (PR #123)
- If false: on a paid plan the 55-second deadline needlessly defers large tournaments.
- Check: Vercel plan.
- Status: unverified

### C91. A WUDC-sized ingest takes 45-51 seconds, so a job is not started with less than 30 seconds of budget left.
- Where: app/api/cron/process-queue/route.ts:25-47 (`JOB_HEADROOM_MS = 30_000`)
- Category: operations and limits
- Source: documentation (measured locally 2026-10, PR #123)
- If false: if pre-scraped tournaments now load from storage in a few seconds, ticks end early with work pending.
- Check: `elapsedMs` and `stoppedForBudget` in cron JSON reports.
- Status: unverified

### C92. A job that fails three times is marked failed; a deadlock never counts toward that and is retried without limit; a 404 on the landing page is abandoned at once.
- Where: app/api/cron/process-queue/route.ts:22 (`MAX_ATTEMPTS = 3`); lib/queueDrain.ts:144-182; lib/queue.ts:186-192
- Category: operations and limits
- Source: documentation (PR #94 "deadlocks reschedule, never fail")
- If false: a URL that deadlocks every time loops forever; a Heroku app that briefly 404s (tab being reindexed, app asleep and misconfigured) is abandoned on the first try and the user must press Retry.
- Check: count `IngestJob` rows with attempts > 3 and status pending; count abandoned rows whose landing page now loads.
- Status: unverified

### C93. A job started more than 5 seconds into a tick that runs out of time is handed back without spending an attempt.
- Where: lib/queueDrain.ts:144-148 (`lateStartMs ?? 5_000`); lib/queue.ts:211-231
- Category: operations and limits
- Source: documentation (PR #123)
- If false: a job that is always started late never fails and never finishes.
- Check: jobs with repeated deadline notes in `lastError`.
- Status: unverified

### C94. A job left "running" for more than 5 minutes was killed and is put back at the end of the queue.
- Where: lib/queue.ts:38-77 (`olderThanMinutes ?? 5`)
- Category: operations and limits
- Source: documentation (PR #7)
- If false: safe while functions are capped at 60 seconds; noted for completeness.
- Check: none needed unless maxDuration changes.
- Status: unverified

### C95. Six ingests run in parallel (max 16), never two on the same tab host at once.
- Where: lib/queueDrain.ts:12-21 (`INGEST_DRAIN_CONCURRENCY`, default 6, cap 16); lib/queue.ts:91-126
- Category: operations and limits
- Source: documentation (comments on Cloudflare 403 bursts)
- If false: most tournaments have their own subdomain, so "one per host" rarely limits load on Calicotab's shared infrastructure; six parallel ingests can still trip Cloudflare.
- Check: Calicotab 403 rate under a full queue.
- Status: unverified

### C96. The cron endpoint is authorised by a shared `CRON_SECRET` (Bearer header or `x-cron-secret`), and without the secret nothing runs.
- Where: app/api/cron/process-queue/route.ts:50-64
- Category: auth and security
- Source: documentation (vercel.json, .github/workflows/drain-queue.yml)
- If false: a leaked secret lets anyone trigger drains and background scans (mostly a cost issue). docs/HANDOFF.md:119 notes a plain-text key file pending rotation.
- Check: confirm rotation done.
- Status: unverified

### C97. Pruning (90-day retention of page snapshots and parser runs, rate-limit rows older than 7 days, placeholder persons) runs once a day in the 03:00 UTC hour.
- Where: app/api/cron/process-queue/route.ts:187-212; lib/calicotab/provenance.ts:25 (`RETENTION_DAYS = 90`); lib/rateLimit.ts:184 (7 days)
- Category: operations and limits
- Source: documentation (CLAUDE.md "Known gaps")
- If false: if no scheduler calls the endpoint during 03:00-03:59 UTC on a given day, nothing is pruned that day.
- Check: `pruned` field in 03:00 reports; Sentry `stage: prune`.
- Status: unverified

### C98. Rate limits fail open: if the counter query errors, the request goes through.
- Where: lib/rateLimit.ts:67-74, 109-115
- Category: auth and security
- Source: documentation (comment)
- If false: during a database incident, scrape-triggering routes are unlimited; the owner may prefer fail-closed on `ingest:*`.
- Check: owner preference.
- Status: unverified

### C99. Other per-user hourly caps are right: drain 30, CV export 30, account export 10, claim 200, tag proposals 120, error reports 20, sharing 60, onboarding preflight 10.
- Where: lib/rateLimit.ts:41-54
- Category: operations and limits
- Source: UNVERIFIED guess (implementer-chosen)
- If false: `sharing:update` is also consumed by GET (app/api/sharing/route.ts:25), so opening the sharing panel 60 times in an hour blocks saving changes.
- Check: owner review of numbers.
- Status: unverified

## I. Public CV and sharing

### C100. The public CV is off by default; turning it on creates a random 6-character slug; the profile photo is shown by default.
- Where: prisma/schema.prisma:30-38 (`publicCvEnabled false`, `publicAvatarEnabled true`); app/api/sharing/route.ts:94-102
- Category: product and privacy
- Source: documentation (PR #88, schema comment "per Q10 user-toggle")
- If false: if the owner wants the photo off by default (minors on school circuits), every user who enables sharing exposes their Google photo unless they notice the toggle.
- Check: owner preference.
- Status: unverified

### C101. Sharing is all or nothing: once enabled, /u/<slug> shows every claimed tournament (speaking and judging), the Google account name, summary tiles and break depth; there is no per-tournament hide.
- Where: app/u/[slug]/page.tsx:67-130, 295-330; no visibility field in the schema
- Category: product and privacy
- Source: UNVERIFIED guess
- If false: a debater who wants to hide one tournament or their judging record must turn the whole page off. The name shown is the Google profile name, not the tab name.
- Check: owner preference.
- Status: unverified

### C102. Public CVs should not be indexed by search engines.
- Where: app/u/[slug]/layout.tsx:4-6; app/u/[slug]/page.tsx:42, 51 (`robots: index false, follow false`)
- Category: product and privacy
- Source: UNVERIFIED guess
- If false: if the owner wants the CV findable (a credential for applications), nobody can search for it.
- Check: owner preference.
- Status: unverified

### C103. A 6-character random slug is unguessable enough ("about 5 billion combinations").
- Where: lib/sharing/slug.ts:47-61
- Category: product and privacy
- Source: documentation (comment)
- If false: the alphabet has 33 characters, so 33^6 is about 1.29 billion, not 5 billion; `bytes % 33` also slightly favours some characters. Enumeration is still impractical, but the comment overstates it.
- Check: arithmetic.
- Status: contradicted (the number in the comment).

### C104. Turning sharing off and on again keeps the same slug, so old links work again.
- Where: app/api/sharing/route.ts:94-102 (slug generated only when none exists)
- Category: product and privacy
- Source: UNVERIFIED guess
- If false: a user who disabled sharing to cut off a link finds it live again on re-enable; only "reset to random" (customSlug=null) changes it.
- Check: owner preference; UI copy in components/SharingManager.tsx.
- Status: unverified

### C105. Deleting an account removes the user's own rows but keeps tournament data, including private landing-page snapshots fetched with their URL.
- Where: app/api/account/delete/route.ts:41-47 (cascade to Account, Session, GmailToken, DiscoveredUrl, IngestJob); `SourceDocument` has no user link (schema :576-596); privacy page app/(app)/privacy/page.tsx:58-64
- Category: product and privacy
- Source: documentation (privacy page says public tournament records remain)
- If false: the privacy page says "your personal links ... are removed", but the landing-page snapshot stored under the private URL (with the person's name and judging card) stays until the 90-day prune, and the newest snapshot per URL is kept indefinitely.
- Check: after a test delete, `SELECT count(*) FROM "SourceDocument" WHERE url LIKE '%<token>%'`.
- Status: contradicted (privacy copy vs stored snapshot).

## J. Notifications

### C106. Only three events notify a user, all in-app (bell): new URLs found by a scan (deduped 5 min), "Your CV is ready" when the user's queue reaches zero (deduped 1 min), and an admin releasing their identity claim (not deduped). No email or push.
- Where: lib/gmail/scanUser.ts:73-84; lib/queue.ts:143-163; app/api/admin/persons/[id]/release/route.ts:64-75; lib/notifications/write.ts:24-66; CLAUDE.md ("no email/push by design")
- Category: product and privacy
- Source: documentation (PR #87, #91)
- If false: a job that fails or is abandoned produces no bell entry; "Your CV is ready" fires when the queue empties even if every job failed. The background scan's "Found N new URLs ... Open the dashboard to ingest them" tells the user to act on URLs that are already queued automatically.
- Check: owner preference on failure notices; read the scan notification copy.
- Status: unverified

---

## Top 15: most likely wrong or highest impact

Ranked by how many people see the wrong figure, multiplied by how wrong it is. Privacy and security items rank high even where few users are affected.

| # | Entry | Why |
|---|---|---|
| 1 | C88 | Owner decision B (delete the stored private URL after ingest) is not implemented. Every working private URL is still stored in three tables. |
| 2 | C9 | A Silver/Plate run counts as a break in the /cv header, on /u, in the break rate and in JSON Resume, and in "Deepest breaks" a Silver Final outranks an Open semifinal. The funnel and milestones exclude it. |
| 3 | C10 | Winning an ESL, Novice or Silver final makes the user a "Champion" on /cv, in JSON Resume and in the export ("(W)"). |
| 4 | C89 | Private URLs still leak through the admin progress endpoint (`currentUrl`) and Sentry (`extra.url`). |
| 5 | C21 | The majors regex misses the full names of Worlds, EUDC, Australs and NAUDC, plus PAUDC, ABP and "Worlds". |
| 6 | C20 | Highlight counts are capped at 5: a user with 7 titles reads "Won 5 titles". |
| 7 | C8 | "Grand Final" (100) outranks "Final" (95), so "ESL Grand Final" beats an Open "Final", which defeats the owner-facing "Open first at equal depth" rule. |
| 8 | C78 | The promised "about every 30 minutes" Gmail scan delivers at most 2 users per cron call. With the daily Vercel cron alone, that is 2 users a day. |
| 9 | C40 | Win rate, streaks and the field-size finding pool BP (1st only) with two-team wins, so the format mix drives the finding. |
| 10 | C81 | The first Gmail scan reads only the newest 500 matching emails, and incremental scans never look further back, so a heavy user's older tournaments can be missed for good. |
| 11 | C37 | A season is the calendar year, not the debate season (September to August, with Worlds across New Year). |
| 12 | C25 / C26 | The header's "Breaks" mixes judge outrounds with speaking breaks, and divides by every tournament including judge-only and unmatched ones. /cv/stats gives a different rate. |
| 13 | C72 | If `TOKEN_ENCRYPTION_KEY` is unset, Gmail refresh tokens are saved in plaintext with no alert. |
| 14 | C85 | Owner decision D's "daily limit" exists only for CSV. A single paste allows 20 an hour, up to 480 a day. |
| 15 | C3 | "Top 10%" rounds up (ceil). On small tabs a 13-18% finish is shown as top 10%. |

Next in line: C105 (the privacy page says links are removed on deletion, but the stored snapshots stay), C106 ("Your CV is ready" fires even when every job failed), C31 (the speaker average is inflated when a score cell fails to parse), C5 (the two percentile conventions differ), C60 (judging sections exist despite "only speaker stats").

## Questions for the owner (20)

1. Is a Silver, Plate or other consolation-bracket run ever a "break"? (C9, C24)
2. Does winning an ESL, EFL or Novice final count as a "title" or "Champion" on the CV? (C10)
3. Are "Final" and "Grand Final" ever two different rounds at one tournament? If not, should they rank the same? (C8)
4. Is losing a partial quarterfinal ("Pre-Semis") the same depth as losing a full quarterfinal? (C11)
5. Top 10%: round up (rank 2 of 15 counts), or strictly rank / teams <= 10%? (C3)
6. Should "Breaks" in the /cv header count outrounds the user judged? (C25)
7. Break rate: divide by tournaments spoken, or by all tournaments? (C26)
8. Is a season the calendar year, or an academic season? If academic, which month starts it? (C37)
9. In BP, is only a 1st a "win" for streaks and win rate, and should every win-rate finding be per format? (C40, C41)
10. Which tournaments are "majors"? (C21)
11. Best team rank and best speaker rank: the raw rank, or rank as a share of the field? (C15, C16)
12. Is a pro-am gap of 1.5 speaker points right? (C49)
13. Should a tab director or CA count as having judged the tournament, and their outrounds as a judge break? (C28)
14. "Only speaker stats": should the judging sections on /cv/stats stay? (C60)
15. Apart from EUDC, which tournaments let one team run in both Open and a category bracket? (C22)
16. Decision B: implement private-URL deletion now (the design doc is ready)? (C88)
17. Should a single paste also have a daily cap, and is 5 CSV uploads a day (100 URLs) the cap you meant? (C85, C86)
18. Is "about every 30 minutes" a promise? If yes, scan more users per cron call. (C78)
19. On the public CV, should the photo be off by default, and should users be able to hide single tournaments? (C100, C101)
20. Should a failed ingest post a bell notification, and should "Your CV is ready" wait for at least one success? (C106)
