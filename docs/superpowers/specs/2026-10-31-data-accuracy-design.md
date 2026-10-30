# Data accuracy score: design

Owner request, 2026-10-31: a broad logic check of every tournament's rounds, combined with user input, giving the database an **accuracy score** in the admin view. Failed checks are hints that a partial re-scrape is needed. Check list, weights and thresholds below are Claude's defaults for the owner to review (`C:\Users\achar\reports\decisions\debate_cv.md`).

## Model
`TournamentAudit` (one row per tournament): `tournamentId` (unique, FK cascade), `score Int` (0–100), `checks Json` (array of `CheckResult`), `usersAffected Int`, `checksVersion String`, `computedAt DateTime`. Index on `score` and on `computedAt`.

`CheckResult = { code, status: 'pass' | 'warn' | 'fail' | 'na', detail: string, pieces: PieceRef[] }`. `detail` is one plain sentence with the numbers, for example "R3 has 12 rooms; the other rounds have 16". `pieces` are the scrape pieces a re-scrape should fetch.

## Checks
Teams per room: 4 for British Parliamentary, or when per-round positions are OG/OO/CG/CO; otherwise 2. Minimum speakers per team: 2 for BP and two-team formats, 3 for Asian, World Schools and Australs. Round pieces are found through `ScrapePiece` (key = round number; outrounds by label). When no piece is recorded, `pieces` is empty and the action falls back to a full re-scrape.

| Code | Check | Weight | Fail / warn rule | Suggests |
|---|---|---|---|---|
| `champion` | Outround results exist, and the deepest Open final (rank ≥ Final) has exactly one winner | 15 | **fail:** break rows but no outround results, or a final with 0 or several winners. **na:** no break and no outrounds | the final's round piece, else break |
| `rounds_complete` | Every prelim round 1..`prelimRoundCount` has TeamResult rows | 15 | **fail:** any round missing | each missing round |
| `rooms_consistent` | Rooms per prelim round (teams ÷ teams per room, rounded up) | 10 | per round vs the median: **warn** if off by 1 room, **fail** if off by more than 1 room or more than 10% | the odd rounds |
| `team_coverage` | Teams in R1 vs teams on the team tab | 10 | **warn:** R1 < 95% of tab teams. **fail:** < 80%, or no team tab | team tab, R1 |
| `partners` | Every team-tab team has at least the minimum number of speakers on record | 10 | **warn:** 1–10% of teams short. **fail:** > 10% short | speaker tab |
| `panels` | Per prelim round: chairs ≥ rooms, and judges ≥ rooms. Only where every judge's panels are stored, i.e. distinct `round_results` judges ≥ 50% of judge-role participants | 10 | **fail:** any round under 90% of rooms. **na:** only the URL owner's panels are stored | the rounds short of chairs |
| `points_add_up` | Team-tab points (two-team formats: wins) = sum over the team's prelim rows | 10 | **warn:** ≤ 5% of teams mismatched. **fail:** > 5% | team tab and the rounds involved |
| `outround_shape` | Each outround: winners = half of the teams; each later stage has half the teams of the one before (per bracket) | 5 | **fail:** any stage off | those outround pieces |
| `break_matches` | Open break size = teams in the first Open outround | 5 | **warn:** differ | break |
| `speaker_tab` | Speaker scores on record for at least 80% of speaker-role participants | 7 | **warn:** 50–80%. **fail:** < 50% | speaker tab |
| `motions` | Every prelim round has a motion | 3 | **warn:** any missing (often withheld). **na:** motions piece withheld | motions |
| `scrape_incomplete` | No `ScrapePiece` with status `failed` | 10 | **fail:** any failed | the failed pieces |
| `parser_stale` | `parserVersion` = current `PARSER_VERSION` | 3 | **warn:** older | (full re-scrape) |

**User input** (`user_reports`): each open or acknowledged `CvErrorReport` naming the tournament subtracts 10 points after the weighted score, capped at 30. Categories suggest pieces:
- `wrong_teammate`: speaker tab and team tab;
- `wrong_speaker_rank`, `wrong_speaker_average`: speaker tab;
- `wrong_team_result`: team tab and all prelim rounds;
- `wrong_outround`: outrounds and break;
- identity categories: none.

## Score
- Per check: pass earns its weight, warn half, fail nothing. `na` checks are dropped from both earned and possible weight.
- Tournament score = round(100 × earned ÷ possible) − user-report penalty, floored at 0.
- **Database score:** the mean of tournament scores weighted by `1 + usersAffected` (users with a linked private URL), so tournaments on real CVs count more. The unweighted mean is shown next to it.
- **Bands:** 90 or above "Good", 70–89 "Check", below 70 "Re-scrape".

## When it runs
- After every successful scrape write for that tournament: best-effort, and never fails the ingest.
- In the cron: a sweep of up to 50 tournaments per tick that are missing, stale (older than 24 h) or on an old `checksVersion`, within the tick budget.
- From the admin: "Audit now" for stale tournaments (one bounded batch), and per tournament.

## Admin view
- **Overview section "Data accuracy"**, after Failed imports:
  - tiles: database score (weighted, with "across N tournaments, M on users' CVs"), the unweighted mean, and counts per band;
  - a BarList of how many tournaments fail each check;
  - a ledger table of the lowest-scoring 200 tournaments: score, band, failed checks as badges, users affected, last audited, and actions "Re-scrape suggested (n)" and Open;
  - "Audit now".
- **Per-tournament page:** an "Accuracy checks" panel above the grid. It lists each check with a status pill, its detail line and its suggested pieces, with "Select suggested" (ticks those pieces in the grid) and "Audit again".

## Out of scope
Per-room panel checks (judge rows have no room key). Alerts or notifications. Automatic re-scrapes triggered by the score.
