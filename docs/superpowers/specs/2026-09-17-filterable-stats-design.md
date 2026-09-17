# Filterable statistics — design

**Status:** approved in conversation 2026-09-17; building.
**Reference record:** Ritabrata Mitra, 73 tournaments (local corpus seed — see `docs/HANDOFF.md`, 2026-09-16).

## Goal

Turn `/cv/stats` into one holistic, filterable statistics page. Anyone looking at their numbers can slice them by **partner** and **position**, and the page covers form, positions, teammates, motions, breaks, judging, and crossed metrics.

## Decisions

| Question | Decision |
|---|---|
| Speaker position | Both: **seat/side** now (from results pages), **speaking order** later (from public scoresheets — linked from 116 of 219 results pages, 52 of 73 tournaments) |
| Pro-am | **Per tournament.** Gap = your speaker average − partners' mean average at that tournament, each the **mean of that person's scored prelim speeches**. `> +1.5` you are the pro, `< −1.5` the am, otherwise peers (exactly ±1.5 is peers). Three-a-side: mean of both teammates. Anyone without scored speeches → unlabelled. **No fallback to tab totals:** a total can't become an average without knowing how many rounds that person spoke, and dividing by the prelim count produced a 25.8-point "gap" on the reference record |
| Motion types | **Deterministic classifier** for type + flags, read time, no approvals. Topics stay on the existing tag + Haiku flow |
| Combined metrics | **Cross-tabs + standout findings**, sample-gated |
| Filters | Partner (multi, incl. pro/am/peers) and Position (grouped by format), URL-synced |
| Where filtering runs | **Browser.** The server sends the CV data plus the round table. `lib/cv/statsFilter.ts` narrows the CV data to matching tournaments/rounds and the existing, tested `computeSpeakerStats` runs again on it — every existing section responds with its semantics unchanged. The round table decides what matches and powers the new sections. (Revised from "re-implement sections over RoundFact" while building: same behaviour, far less re-porting risk.) |

## Data model

### RoundFact — one row per round spoken

```ts
type RoundFact = {
  tournamentId: string;
  year: number | null;
  format: string | null;
  round: number;               // sequence, via lib/calicotab/roundNumbers.ts semantics
  isOutround: boolean;
  seat: string | null;         // 'BP:OG' | 'AP:Gov' | 'Aus:Aff' | 'WS:Prop' | '2v2:Aff' ...
  partners: string[];          // person ids of teammates at that tournament
  partnerGap: number | null;
  proAm: 'pro' | 'am' | 'peers' | null;
  motionType: MotionClass | null;
  contextLed: boolean;
  infoSlide: boolean;
  score: number | null;        // user's speech
  partnerScores: number[];     // teammates' speeches that round (carry index)
  points: number | null;       // BP team points
  won: boolean | null;
};
```

### TournamentFact — one row per tournament spoken

Breaks, break rank, break margin, deepest outround, won, speaker rank and category ranks, field placement, partners, pro-am label, format, year. Tournament-level sections filter by **partner only**; under a position filter they grey out with a one-line reason.

Judging facts are separate and never respond to speaking filters.

## Motion classifier — `lib/motions/classify.ts`

`classifyMotion(text, infoSlide) → { type, contextLed, infoSlide }`

Order: strip choice prefix (`A:`, `C:`) → actor framing (`TH, as X, …` / `As X, …`) → stem, allowing a leading context clause → Australs `That …` typed by the verb that follows.

| Type | Stem |
|---|---|
| Policy | THW, "That we should" |
| Actor | TH, as X, would … |
| Belief | THBT, "That X is …" |
| Stance | THS, THO |
| Regret | THR |
| Preference | THP |
| Unclassified | anything else |

Bar: ≥ 98 % of the 1,023 corpus motions classified — **reached 99.8 %** (the one miss has no stem at all). Misses are reported by a live test, not hidden. A round with several motions (choice rounds) takes a type only when all share it; on the reference record that leaves ~60 of 219 prelim rounds untyped, because the round tab doesn't say which motion a room chose. Tabbycat can record the chosen motion per debate on results/scoresheet pages — closing that gap belongs with phase 7's per-debate scraping.

## Page sections

Every figure carries its sample size. Below 6 rounds (`MIN_QUIRK_ROUNDS`) a cell shows "too few rounds (n = …)".

**Baselines are per format.** A win means 1st of four in BP and 1st of two in two-team formats, so a career win rate that blends them makes every BP seat look weak and every two-team side look strong (observed on the reference record: OG −15pp, Opp +17pp against a blended 53 %). Every "vs you" delta on a seat, motion-type or cross-tab row compares with the user's own figure **in that format**; rows mixing formats show absolute values only.

**Filter-aware (partner + position):**
1. Score profile, distribution, best/worst speech — ported to RoundFact
2. Results: points, win rate, runs — ported
3. **Positions** — per-format seat tables
4. **Teammates** — partner table + partner average, gap, pro-am badge; pro / am / peers summary lines
5. **Motions** — six types; context-led and info-slide splits
6. **Info-slide dependence** panel
7. **Round-by-round curve** — score and win rate by round number
8. **Momentum** — next round after a win vs after a loss
9. **Rolling form line** — rolling 10-speech average with tournament markers
10. **Carry index** — your speech minus partner's in the same round; results when out-speaking vs out-spoken
11. **Pairing chemistry** — repeat partners across successive tournaments together
12. **Topic × type heatmap** — types now; topics fill in as tags are approved
13. **Repeat motions** — near-identical motions debated more than once
14. **Cross-tabs + findings** — seat × type, pro-am × type, seat × pro-am; speaker-average delta by default, points (BP) / win rate (two-team) on toggle; up to 3 strongest / 3 weakest cells as findings

**Partner filter only (tournament-level):**
15. Breaks, field placement, seasons — existing, ported
16. **Break margin** — distance from the break line; breaks missed by one point
17. **Outround funnel** — broke → QF → SF → F → won
18. **Speaker-tab ladder** — rank over time, top-10 / top-10 % finishes, ESL/EFL ranks
19. **Milestones & records**

**Not filterable:**
20. **Judging lens** — chair rate by season, outround depth, appointments, judge breaks
21. **Speaking vs judging over time**

**Needs ingest work first:**
22. **Institution eras** — persist institution per participation (parser already reads it)
23. **Opponents & schedule strength** — keep room composition from results pages (parser currently flattens a round's debates into one list); schema + migration

## Build order

| Phase | Work |
|---|---|
| 0 | ✅ Foundation: coverage over-count, badge clipping; seed keeps `won`, team tab, outround results, judge stage labels; every results round crawled. **Soft 404 deferred** — needs `app/loading.tsx` removed from `/u`'s path, which changes navigation UX on several routes; owner decision |
| 1 | ✅ RoundFact / TournamentFact builders (`lib/cv/statsFacts.ts`); motion classifier (`lib/motions/classify.ts`, 99.8 %); teammate details + prelim count on CV rows |
| 2 | ✅ Filter bar + URL sync (`components/stats/`); all existing sections filter-aware; tournament-level figures withheld under a seat filter with a stated reason |
| 3 | Sections 3–6 |
| 4 | Section 14 |
| 5 | Sections 7–13, 16–21 |
| 6 | Sections 22–23 (parser, schema, migration; `PARSER_VERSION` decision raised before bumping) |
| 7 | Speaking order from scoresheets — separate spec |

## Testing

Test-first for every pure module: classifier (real corpus motions), fact builders, pro-am edge cases (three-a-side, missing averages, exactly 1.5), sample gating, cross-tab findings, URL filter round-trip, each new section's computation. Live test: classifier coverage over all corpus motions. Each shipped section rendered against the reference record in a real browser before it is called done.

## Out of scope

Page weight of `/cv` and `/cv/motions` (5.7–8.1 MB) — separate design (collapse / lazy-load ledgers).
