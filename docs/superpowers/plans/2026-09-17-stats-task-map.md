# Task map — filterable statistics and what surrounds it

**Written:** 2026-09-17, with code paused mid-phase 3.
**Design:** `docs/superpowers/specs/2026-09-17-filterable-stats-design.md` (decisions and rationale).
**State:** working tree only, nothing committed. 1,025 tests passing / 38 skipped (measured at the
pause); `tsc` + `eslint` clean.

Legend: ✅ done · 🟡 in progress · ⬜ not started · ❓ needs an owner decision before it can start.

---

## 1. Where things stand

| Phase | What | Status |
|---|---|---|
| 0 | Foundation: format inference in ingest, coverage over-count, badge clipping, full round crawl, seed fidelity | ✅ (soft 404 ❓ — see D1) |
| 1 | Motion classifier, round/tournament tables, teammate data on CV rows | ✅ |
| 2 | Filter bar (partner · pairing · seat), URL sync, existing sections filter-aware | ✅ |
| 3 | Positions per format, teammates + pro-am, motion types | ✅ (browser screenshots pending — 3.3) |
| 4 | Cross-tabs + standout findings | ✅ (browser pass pending) |
| 5 | Thirteen further views on data we already have | ⬜ |
| 6 | Institution eras, opponents & schedule strength (ingest + schema) | ⬜ ❓ |
| 7 | Speaking order and chosen motions from per-debate pages | ⬜ ❓ |

### Phase 3 — finished 2026-09-17 (second session)

- **3.1 / 3.2** `FilterableStats` renders `PositionsSection`, `MotionTypesSection` and `TeammatesSection`
  over `filterFacts(facts, filter)`. `Splits` takes `omit` and drops its `position` and `motionType`
  blocks there. `TeammatesSection` replaces the old `Partners` component (deleted; same `#partners`
  anchor). Rail: Positions, Motion types, Teammates.
- **3.4** Win rate means **prelims only** everywhere: `computeSpeakerStats` now ignores
  `teamRoundResults` past `prelimRoundCount` (win rate, points, streaks, splits, partners), via
  `prelimResults`. Reference record: 266 → **219** decided rounds, equal to the seat splits' total.
  Rows with no prelim count keep every result. Test: "round results count prelims only…".
- **3.3** Checked against the seeded reference record from the local DB, without a browser:
  a hand count of BP:OG from the raw CV rows (12 / 33) matches the section; unfiltered, `AP:Gov`,
  partner and pro-am filters all server-render with no `NaN` / `undefined`. **Still to do:** the
  Playwright pass with screenshots and console check — needs a session cookie for the seeded user
  (re-run the seed, or read the `Session` row, then `npm run dev`).

---

### Phase 4 — done 2026-09-17

- `lib/cv/crossTabs.ts` (8 tests, mutation-checked): each cell is a `splitRounds` row keyed by both
  dimensions, so it inherits per-format residuals and the whole-record baseline. Thin cells are hidden
  **with their figures nulled**. Findings: |Δ speaker avg| ≥ 0.5, ≥ 2 tournaments, ≤ 3 each way,
  one finding per cell across grids.
- `components/stats/CrossTabsSection.tsx`: grid toggle (seat × type, pairing × type, seat × pairing) and
  metric toggle (speaker-avg Δ default, win-rate Δ, team points only when a BP cell has them),
  `aria-pressed` buttons. Rail entry "Cross-tabs".
- Reference record: seat × type 31 cells / 9 visible; findings include "In OG on Belief motions you
  average +1.3 against your usual British Parliamentary speech (7 rounds at 7 tournaments)".

### Red team 2026-09-17 — three reviewers (computation, UI, ingest/format/classifier)

**Fixed, each with a failing test first:**

| Finding | Fix |
|---|---|
| Seat filter collapsed every delta to 0.0 (baseline built from the filtered slice) | `splitRounds` / `crossTab` take `baselineRounds`; the page passes the unfiltered table |
| Seat filter kept tournaments whose only match was an outround | `filterCvData` + `filterFacts` ignore outround rows for seats |
| Engine counted outround speeches the round table dropped ("6 of 5 speeches") | `prelimScope` in `computeSpeakerStats` cuts scores and results at the prelim count; "rounds debated" too |
| Prelim-count fallback 2 = MAX(TeamResult.roundNumber) counted outrounds (GDC 2022 → 11) | `prelimMaxFromRoundCounts`: leading run of rounds holding > half the largest round's teams |
| "Opp is your strongest seat at 73% and CO your weakest" — blended formats, table hidden | `seat-spread` and `motion-type` findings always withheld on this page |
| Partners keyed by display name: withdrawn / same-named people merged | `CvTeammate.key` (`p<personId>`), `StatsFacts.partnerNames`; filter URL uses keys; repeated names numbered in the dropdown |
| `thin` counted rounds, not the speeches / decided rounds behind a figure | thin if any of rounds, speeches, decided (where present) < 6 |
| Info-slide / framing splits only covered typed rounds (127 of 219) | flags independent of type; `RoundFact.hasMotion`; splits over 187 rounds with a motion |
| Pro-am labelled from a rounded gap (76.504 vs 75 → peers) | label from the true gap, epsilon for exactly 1.5 |
| A squad member who never spoke unlabelled the pairing | teammates with no scored prelim speech ignored when someone else was scored |
| Two-team sides split ("2v2:Gov" vs "2v2:Prop"; "Side A" vs "side a") | neutral Prop/Opp pair for formats without side names; case-folded fallback |
| Round with a BP seat at an "AP" tab baselined against AP | baseline format is the seat's prefix |
| Filter click → `router.replace` → full server refetch of a force-dynamic page | `history.replaceState` (Next syncs `useSearchParams`) |
| Rail linked to sections that rendered null; observer watched detached nodes | rail built from ids present in the DOM; `PageJumpNav` keyed by filter |
| Teammates showed breaks under a seat filter; no sample gating | `perRoundOnly` hides breaks; win rate "n = k" under 6 decided rounds |
| Captions: "career average", "decided rounds" (now prelims), split-table header titles | copy fixed; `StatsSplitTable` `baselineLabel` |
| Judging-only record showed an empty filter bar | bar hidden when no rounds |
| a11y: chip counts unitless, partner popover no Escape, td truncate didn't clip | sr-only units, Escape closes + refocuses, block span truncation |

Verified live on the reference record: engine and round table agree on speeches / decided rounds under
unfiltered, seat, partner and pairing filters; OG delta under an OG filter equals the unfiltered delta
(−0.23); all four new sections render without NaN / undefined.

**Format inference and classifier (fixed by a parallel pass, 47 new failing-first tests):** the BP four-seat
shape outranks the name, and name keywords outrank two-team side names; Aff/Neg alone means Australs only
with an Australs-circuit name; keyword typos and gaps fixed (`world schools`, `australs`, `uadc`, `asians`,
`ap`, `…BP`/`…BPD`); unknown side names at 2 a side give Two-team Parliamentary, not BP; the lower
median for squad size, with one source order; BP needs a majority of BP seats; ingest no longer overwrites a
stored format with null. Classifier: invisible characters and quotes, false "As the …," actors, actor
clauses after the verb or containing commas, THPAW / THB / THC / TH rejects / TBHT, any choice prefix,
sentence-form context. csv2 coverage 98.76 % → 99.82 % (2 left, both "intentionally left blank").
⚠ On a 698-tournament probe input about 420 tournaments went from **no format → a format** via the team-size
rule, now fed by participant squad sizes. They had no rooms to read, so check a sample before re-ingesting.
Public CV names now truncate with an ellipsis.

**Open — not fixed:**

| ID | Item | Why open |
|---|---|---|
| X1 | **Format backfill won't happen for cached tournaments**: `/admin → Re-ingest all` hits `checkCacheFreshness` (same `PARSER_VERSION`, < 30 days) and never recomputes `Tournament.format`. The handoff's "no bump needed" is wrong | Owner decision: bump `PARSER_VERSION` (re-parses every user) or add a force / format-only backfill to reingest-all |
| X2 | **Prelim cut assumes URL round numbers run 1..N with N = count**: split rounds (1A/1B), a failed results fetch, or the seed stripping letter suffixes leave the count short; motions are keyed by label while rounds are keyed by URL number (ANU Winter 22: count 5, URL round 6 is a prelim) | Needs "highest prelim URL number" stored at ingest — Phase 6 territory |
| X3 | **Client payload**: `/cv/stats` ships ~389 KB CV data (290 KB motion text) + 88 KB round table | Trim motion text to what best/worst speech needs — do with D2 |
| X4 | 3.3 / 4.3 **real-browser pass** with screenshots + console | Needs a session cookie for the seeded user |
| X5 | Spec drift: `TournamentFact` lacks ESL/EFL ranks, field placement, break margin (Phase 5 views need them); "rows mixing formats show absolute values only" superseded by per-format residuals — update spec | Phase 5 |
| X6 | "With peers" is ~95 % of rounds, so pairing × type findings largely restate the overall motion-type picture | Consider excluding the dominant pairing from findings |

## 2. How the work depends on itself

```
Phase 3 wiring ─┬─> Phase 4 cross-tabs ──> Phase 5 "findings"-style views
                └─> Phase 5 views (independent of each other)

Phase 6a institutions ─> Institution eras view
Phase 6b room composition ─> Opponents & schedule strength view
Phase 7 per-debate pages ─┬─> Speaking-order positions (extends Phase 3 positions)
                          └─> Chosen motion per debate (types for choice rounds; extends Phase 3 motions)

Cross-cutting: D1–D8 decisions, C1–C4 carried-forward items
```

Phases 3–5 need **no** schema change, migration or `PARSER_VERSION` bump. Phases 6 and 7 need all
three and change what every user's ingest stores.

---

## 3. Tasks

### Phase 3 — finish (no decisions needed)

| ID | Task | Files | Done when |
|---|---|---|---|
| 3.1 | Wire the three sections into `FilterableStats`; add `omit` to `Splits` so its mixed-format position table and tag-based "motion stem" table don't duplicate the new sections; add `positions` and `motion-types` to the jump rail | `components/stats/FilterableStats.tsx`, `StatsSections.tsx` | Sections render, rail links land |
| 3.2 | Pass the filtered round table (`filterFacts`) to the new sections | `FilterableStats.tsx` | Seat / partner filters change the new sections too |
| 3.3 | Browser check on the reference record: unfiltered, one seat, one partner, pro-am only; zero console errors; screenshots | Playwright script (scratch) | Figures match a hand check of at least one seat row |
| 3.4 | Reconcile **win-rate scope**: the existing engine counts outrounds in "decided rounds" (266 on the reference record), the new splits count prelims only. Pick one, or label both | `speakerStats.ts` or captions | No two sections disagree about what "win rate" means |

### Phase 4 — cross-tabs and findings

| ID | Task | Data | Done when |
|---|---|---|---|
| 4.1 | `lib/cv/crossTabs.ts`: seat × motion type, pairing × motion type, seat × pairing; per-format residual deltas (reuse `roundSplits`); cells under 6 rounds hidden; test-first | have | Unit tests incl. hidden-cell gating |
| 4.2 | Findings: up to 3 strongest / 3 weakest cells as one-line claims stating the number and the sample, in the voice of the existing `deriveQuirks` | have | Every finding checkable against the grid |
| 4.3 | Section: grid with a metric toggle (speaker-average delta default; points for BP; win rate for two-team) | — | Renders under every filter; toggle keyboard-accessible |

### Phase 5 — views on data we already have

Each is test-first for its computation, then a section. "Seat filter" says whether it can respond to a
seat filter or must be withheld (like Field and Seasons today).

| ID | View | Question it answers | Seat filter | Caveat |
|---|---|---|---|---|
| 5.1 | Round-by-round curve | Do I start slow or fade late? | ✓ | — |
| 5.2 | Momentum after win / loss | Do I bounce back or tilt? | withheld | Needs consecutive prelims |
| 5.3 | Rolling form line | Hot and cold stretches | ✓ | ⚠ **Tournament dates aren't stored** — order within a year is approximate (see R1) |
| 5.4 | Speaking vs judging over time | When did I turn to adjudicating? | not filterable | — |
| 5.5 | Break margin | How far above or below the break line; breaks missed by one point | withheld | Verify break-line derivation on real ingests first (team-tab points ∩ break ranks) |
| 5.6 | Outround funnel | Broke → QF → SF → F → won | withheld | — |
| 5.7 | Speaker-tab ladder | Rank over time, top-10 / top-10 % finishes, ESL/EFL ranks | withheld | Ordering caveat R1 |
| 5.8 | Milestones & records | First break, first final, best speech, longest break streak | withheld | Ordering caveat R1 for "first" |
| 5.9 | Carry index | My speech minus my partner's, and results when out-speaking vs out-spoken | ✓ | 213 usable rounds on the reference record |
| 5.10 | Pairing chemistry | Did repeat partnerships improve? | ✓ | Ordering caveat R1 |
| 5.11 | Topic × type heatmap | Comfort zones | ✓ | ⚠ Topics need **approved tags** — 0 today; renders types only until C4 |
| 5.12 | Repeat motions | Near-identical motions debated twice, and how each went | ✓ | Needs a text-similarity threshold chosen against the corpus |
| 5.13 | Judging lens | Chair rate by season, outround depth, appointments, judge breaks | not filterable | — |
| — | Info-slide dependence | — | ✓ | ✅ Folded into Motion types (phase 3) |

### Phase 6 — ingest work ❓ (D4)

| ID | Task | Changes | Done when |
|---|---|---|---|
| 6.1 | Persist **institution** per participation (the parser already reads it) | Prisma migration, ingest writer, `buildCvData`, seed + corpus export | Every new ingest stores it; old rows fill on re-ingest |
| 6.2 | Institution eras view (GLC Mumbai → IGNOU → Edinburgh on the reference record) | section + pure grouping; handle spelling variants ("GLC", "GLCM", "GLC Mumbai") | Eras match the reference record |
| 6.3 | Keep **room composition**: `parseRoundResults` flattens a round's debates into one list, so who faced whom is lost | parser, schema (debate/opponent rows), migration, ingest, corpus loader, seed | Parser tests on corpus pages; no regression in `checks.sql` |
| 6.4 | Opponents & schedule strength view: record against strong teams, draw strength, head-to-head by institution | section + pure computation | Figures reproducible from the stored rooms |

### Phase 7 — per-debate pages ❓ (D5) — own spec first

| ID | Task | Evidence so far |
|---|---|---|
| 7.1 | Spec: what the scoresheet / debate pages carry and how to fetch only the user's own debates | 116 of 219 cached results pages link `/results/debate/N/scoresheets/`, across 52 of 73 tournaments |
| 7.2 | Speaking order (PM / DPM / … ; 1st / 2nd / 3rd / reply) as a second position dimension | extends Phase 3 positions and the seat filter |
| 7.3 | The motion each room actually chose, to type the ~60 choice rounds per career that are untyped today | extends Phase 3 motion types |

---

## 4. Decisions only the owner can make

| ID | Decision | Why it matters | Options |
|---|---|---|---|
| D1 | **Soft 404 on `/u/<unknown slug>`** returns HTTP 200 | Root `app/loading.tsx` streams before `notFound()` | Remove the root loading boundary from `/u`'s path (changes loading UX on settings, onboarding, admin, sample, legal) · leave it (pages are `noindex` already) |
| D2 | **Page weight**: `/cv` 5.7 MB, `/cv/motions` 8.1 MB at 73 tournaments | Every long career pays it | Collapse / lazy-load round ledgers — its own design |
| D3 | **Committing this work** | 13 modified + 20 new files, spanning ingest, CV, stats, tooling | Suggested split below (§6) |
| D4 | **Phase 6 go-ahead** | Schema migrations + `PARSER_VERSION` bump re-parse every user's tournaments | Approve 6.1 alone first (smaller) · both · defer |
| D5 | **Phase 7 go-ahead** | A new crawl shape; more requests per ingest | Spec only · spec + build |
| D6 | **Reference record's public page** | Ritabrata Mitra is a real person who hasn't asked for a public CV; `publicCvEnabled` is on locally only | Keep local-only · build a fictional 50+ tournament `/sample` from the same machinery · seek consent |
| D7 | **Tag-based "motion stem" table** | The classifier supersedes it on the filterable page (3.1 hides it there) | Remove the stem tags from the vocabulary · keep them for moderation only |
| D8 | **Two-team 2-a-side label** | "Two-team Parliamentary" is structural; APDA / NPDA / Canadian can't be told apart from a tab | Keep · rename |

---

## 5. Carried forward from earlier handoffs

| ID | Item | Source |
|---|---|---|
| C1 | `/admin → Re-ingest all` — now also backfills the corrected formats | 2026-09-15 checklist |
| C2 | Confirm migrations in `/api/admin/schema-probe` (none added this session) | 2026-09-15 |
| C3 | `CRON_SECRET` + `APP_URL` repo secrets for the 15-minute drain | 2026-09-15 |
| C4 | `ANTHROPIC_API_KEY` for the Haiku topic classifier — unlocks 5.11 | 2026-09-15 |
| C5 | Store the round label on `SpeakerRoundScore` | 2026-09-15 next steps |
| C6 | Outround `TeamResult` rows keyed by URL number pollute by-position slices — **now visible**: they're why "decided rounds" includes outrounds (3.4) | 2026-09-15 |
| C7 | Landing-page judge history takes the round number from the label | 2026-09-15 |

---

## 6. Suggested order and commit plan

1. ~~**Phase 3 (3.1–3.4)**~~ — done, bar the 3.3 browser screenshots.
2. **Commit in reviewable pieces** (D3):
   1. `fix(format)`: room-shape format inference + abbreviations + tests
   2. `fix(stats)`: coverage over-count; `fix(public-cv)`: title, abbreviations, truncation
   3. `feat(cv)`: teammate details + prelim count on CV rows
   4. `feat(motions)`: classifier + live coverage test
   5. `feat(stats)`: round table, filters, filterable page, new sections
   6. `tools(corpus)`: caching, participants pass, focused index, derive / tag tools, seed-from-corpus
   7. `docs`: spec, map, handoff
3. **Phase 4**, then **Phase 5** in the order 5.1, 5.9, 5.6, 5.8, 5.13 (highest value, no caveats)
   before the date-ordered views (5.3, 5.7, 5.10), which wait on R1.
4. Decide D4 / D5, then Phases 6 and 7.

## 7. Risks and known caveats

| ID | Risk | Effect | Mitigation |
|---|---|---|---|
| R1 | **No tournament dates** — only `year` (and email date on `DiscoveredUrl`) | "Oldest first" ordering within a year is approximate: streaks today; rolling form, ladder, chemistry, "first" milestones later | Order by email date where present and say so in captions; or store tab start dates in ingest (would join Phase 6) |
| R2 | Small samples under filters | Confident-looking numbers from 3 rounds | Thin marking (< 6) everywhere; findings gated; keep it |
| R3 | Client payload grows with each view | `/cv/stats` ships the CV rows + round table (~86 KB for the table alone) | Measure after Phase 3; trim fields per view |
| R4 | Choice rounds untyped | ~27 % of prelim rounds on the reference record carry no motion type | Captions say so; Phase 7.3 closes it |
| R5 | Seeded reference record ≠ real ingest | Anything the seed skips (e.g. landing-page judge history) won't show locally | Keep `__derive` using ingest's own helpers; verify on a real account before release |
