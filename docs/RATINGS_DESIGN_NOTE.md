# Design note: debater ratings, Glicko-2 vs TrueSkill Through Time

Status: dropped by the owner on 2026-10-30; ratings will not be built. Kept as research only. (Earlier: proposal only, 2026-10-20.) If ratings had shipped, they would sit next to the JSON Resume export (`/cv.json`) as a new versioned field in the `meta["x-debate-cv"]` extension. Bump `DEBATE_EXTENSION_VERSION` and the schema in `docs/json-resume-debate-extension.schema.json` when that happens, and keep the previous version's schema file (`json-resume-debate-extension.v<N>.schema.json`) so older exports still validate.

Extension version history. v1 (2026-10-20): first shape; `summary.breaks` counted a tournament once if the user broke in any role. v2 (2026-10-27): `summary.breaks` is speaking breaks only, and `judgingBreaks`, `tournamentsSpoken` and `tournamentsJudged` are required, so a reader can compute a speaking and a judging break rate separately (owner decision C25/C26). The v1 schema is `docs/json-resume-debate-extension.v1.schema.json`.

## What the data looks like

- **British Parliamentary rooms rank four teams 1st to 4th.** Each team is two speakers, and partners change between tournaments. One result is a full ranking of four teams, not a win or loss between two players.
- **Play is bursty.** A debater might attend 5 to 15 tournaments a year, each with roughly 5 to 9 preliminary rounds plus any outrounds, with long gaps in between.
- **The history arrives late and out of order.** Gmail ingestion finds old tournaments in any order, and re-ingests can rewrite past results. Any rating has to be recomputable from scratch over the whole history.
- **Most people rated would not be users.** Ratings would be computed over everyone on a scraped tab, most of whom never signed up. See "Privacy" below.

## Glicko-2

Every player has a rating r, a rating deviation (RD, the uncertainty) and a volatility σ. Games within a "rating period" are treated as simultaneous, and ratings update at the end of each period. The system constant τ controls how fast volatility can change; Glickman suggests 0.3 to 1.2 [1].

Fit for debate:

- It is pairwise. A BP room has to be split into six pairwise results (1st beat 2nd, 3rd and 4th, and so on), which counts one room as six games and overstates how much is known.
- It rates individual players. Two speakers on a team need an ad hoc rule: rate the team as a unit (it dissolves when partners change) or give both speakers the team's result (which ignores the partner's strength).
- Glickman says the system "works best when the number of games in a rating period is moderate to large, say an average of at least 10-15 games per player in a rating period" [1]. With one tournament per period, debate is at or below that even after splitting rooms into pairs.
- It runs forward only. A newcomer's first tournaments are rated against a wide default prior, and an early upset never gets reinterpreted in light of what came later.
- On the plus side, it is simple: a few dozen lines with no dependencies, an incremental O(games) update, and widely understood output ("1850 ± 100").

## TrueSkill Through Time (TTT)

TrueSkill [2] is a Bayesian factor-graph model. Its native outcome is a ranking of several teams, and a team's performance is the sum of its members' performances, so a four-team BP room with two-person teams is the model's normal case, not an adaptation. TrueSkill Through Time [3, 4] runs inference over the whole history at once, passing information backwards as well as forwards. That gives reliable early estimates for newcomers and ratings that stay comparable across years. Landfried and Mocskos describe TTT as routing all historical information through a single causal network, and they ship reference implementations in Julia, Python and R [4].

Fit for debate:

- It models the BP room and the two-speaker team directly, with no pairwise split and no team-versus-individual fudge.
- Recomputing from the whole history matches how this app gets its data (late, out of order, re-ingested). It's a nightly batch job, not an online update.
- Early-career estimates improve as later results arrive, which matters for a CV: someone's first-year record gets read in light of what they did afterwards.
- Costs: more machinery (message passing to convergence), and the reference implementations are not JavaScript [4], so it means either a port or a Python job outside the Next.js app. Ratings also move retroactively, so a CV figure can change after an unrelated re-ingest. Showing "as of <date>" is necessary.
- Draws (tied ranks) are supported by the TrueSkill family [2], but BP ranks are strict, so that feature is unused.

## Recommendation

**TrueSkill Through Time, if ratings are built at all.** The decisive reasons are the four-team, two-speaker room and the recompute-from-history data flow. Glicko-2 fits neither without approximations that blur exactly what a debate CV is trying to show. If a quick prototype is needed first, Glicko-2 on pairwise-split rooms with one rating period per tournament is a cheap baseline to compare TTT against, but it should not ship as the CV figure.

Prerequisites before either:

1. **Every room's result.** Ratings need all teams' placings in every room, not just the user's. Check whether `lib/calicotab` stores full per-room results for every team before going further.
2. **Speaker identity across tournaments.** Ratings are only as good as the cross-tournament person matching (`personMatch`). A mismatched name splits one debater into two rating histories.
3. **Privacy.** Rating people who never signed up is a new kind of processing of scraped names. At most, show a user only their own rating. Do not publish a leaderboard without a privacy review.

## References

1. Mark E. Glickman, "Example of the Glicko-2 system", Boston University, revised 22 March 2022. http://www.glicko.net/glicko/glicko2.pdf (read 2026-10-20). The source of the rating-period, τ range and 10-15 games guidance quoted above.
2. Ralf Herbrich, Tom Minka, Thore Graepel, "TrueSkill: A Bayesian Skill Rating System", Advances in Neural Information Processing Systems 19 (NIPS 2006). Cited from memory; not re-checked online this session.
3. Pierre Dangauthier, Ralf Herbrich, Tom Minka, Thore Graepel, "TrueSkill Through Time: Revisiting the History of Chess", Advances in Neural Information Processing Systems 20 (NIPS 2007). Cited from memory; not re-checked online this session.
4. Gustavo Landfried, Esteban Mocskos, "TrueSkill Through Time: Reliable Initial Skill Estimates and Historical Comparability with Julia, Python, and R", Journal of Statistical Software 112(6), 1-41, 2025. doi:10.18637/jss.v112.i06. https://www.jstatsoft.org/article/view/v112i06 (abstract read 2026-10-20).
