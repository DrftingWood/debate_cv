# Session Handoff — debate_cv

---

## 2026-10-30 - Partial scrapes: keep what loaded, retry the rest, show it

- **Problem.** One failed tab or round page used to fail the whole import, or leave a tournament silently thin. Calicotab is slow and flaky (see the entry below), so a single 503 on the speaker tab cost a user the whole tournament.
- **What changed.**
  - **Keep what loaded.** `lib/calicotab/ingest.ts` stores every page that came back and records each page as a piece (`lib/calicotab/scrapePieces.ts`): team tab, speaker tab, participants, motions, each break category, each round. A failed round keeps its stored judge panels (it is not cleared).
  - **Retry on its own.** The cron (`/api/cron/process-queue`) calls `retryDuePieces` (`lib/calicotab/partialScrape.ts`). Back-off is `retryDelayMs`; once the retries run out `nextRetryAt` is null and only an admin re-scrape moves the piece again.
  - **Say so on the CV.** A tournament with a failed piece still counts on the record (owner decision 2026-10-30) and shows a "Partly loaded" badge on `/cv` and `/u/<slug>` (`components/PartlyLoadedBadge.tsx`; the explanation is reachable by keyboard and screen reader).
  - **Admin.** `/admin` has the Partly loaded tile, Scrape health and Failed imports (retry selected or all). `/admin/tournaments/[id]` is the per-page grid with a re-scrape picker and "Select failed". APIs: `POST /api/admin/tournaments/[id]/rescrape` (deletes only the chosen pieces' rows, then re-reads them) and `POST /api/admin/jobs/retry`.
- **Migration.** `20261030160000_scrape_pieces` adds the `ScrapePiece` table (unique per tournament, kind and key; cascades with the tournament). It runs on the next production build. Tournaments imported before it have no rows and show no badge until they are next scraped.
- **Dev data.** `npm run seed:dev` now seeds pieces for two tournaments (Delhi Open 2025 all ok; Hart House IV 2023 with a failed speaker tab, retry queued, and a failed R2 with retries exhausted) plus one failed import job, so the admin pages and the badge have data. On 2026-10-31 the embedded Postgres on 55432 was not running and the system PostgreSQL 17 (5432) needs credentials this session did not have, so the check used a throwaway cluster started on 55432 with trust auth.
- **Checked.** Browser check at 1280 and 390, light and dark, signed in with the seed cookie: no console errors, no sideways scroll, 20 px gutter at 390, "Select failed" ticks 2, "Partly loaded" shows on Hart House in the 2023 group of `/cv`. `A11Y_ONLY=/admin npm run a11y`: no axe violations. Re-checked on 2026-10-31 after the review fixes below: the Failed imports row is 180 px at 390 (was about 1400 px) and 63 px at 1280, and the table fits its panel at 390 without scrolling.
- **Withheld pages.** A page the tournament itself refuses (its own 403, or a 404 for a page the nav links: a motions page, or the participants list when participants are already stored) is recorded with status `withheld`. It is never retried, does not mark the CV "Partly loaded", is left out of the failing counts, and shows as "Withheld by the tournament" in the admin grid, with a count line under Scrape health. `status` is a string column, so no migration. To pick up such a page if it is later made public, re-scrape it from the grid.
- **Review fixes (2026-10-31).** A failed break page no longer nulls stored `teamBreakRank`, and a break-only run (a retry, or a scrape whose speaker tab failed) writes the ranks onto stored participants by team name. A failed prelim round no longer shrinks `prelimRoundCount`, and a speaker-only count no longer overwrites a stored participants-list count. A retry that fails before any page answers (landing page down, tournament no longer matching, deadline) still advances the failed pieces' back-off; a tournament with no public address stops retrying at once. A deadline during an admin re-scrape returns the pieces as failed instead of a 500. A partial run never writes the tournament's format. A break-only run now fills only missing break ranks (`teamBreakRank: null`) and never overwrites a stored one, so a retry of just the ESL break cannot replace an Open rank; a rank that needs correcting waits for a full scrape (which carries the rank on the speaker rows).
- **Rollback.** Revert the merge commit, then drop the table: `DROP TABLE "ScrapePiece";` (and delete its row from `_prisma_migrations`). Nothing else reads it after the revert.

---

## 2026-10-30 - Stored data first; calicotab treated as one slow host

- **Incident.** 5-10 new users: Gmail scans found their private URLs, but nearly every import and onboarding read timed out at 15 s. Calicotab served pages in 10-40 s (its API, 40-90 ms on 10-28, took 27-29 s), all subdomains at once. The private-URL page was fetched before the stored copy was looked up, so pre-scraped tournaments failed too.
- **Owner decisions (2026-10-30), replacing the B9 rule that every tournament's private URL is fetched before linking:**
  - The Gmail step reads private-URL pages only to learn who the user is: at least 10 (all if fewer), newest first; the majority name (> 50%) is pre-ticked; no majority after 10 reads on to 20, then every name is offered un-ticked. A close minority name is offered un-ticked ("Close to your main name"); a different one is flagged "Probably someone else's link". `lib/identity/nameSample.ts`, preflight, names route, NamePicker.
  - The import step needs no private-URL page for a finished stored tournament (team tab stored, current parser, not marked for re-scrape): host + slug names it, and the user's claimed names find them in it (`lib/calicotab/storedFirst.ts`). Running or unstored tournaments go the live way, as before.
  - A stored tournament the user's claimed names are not in (forwarded link, unclaimed spelling) has its page read. During onboarding (nothing claimed yet) the tournament is linked and confirm re-queues the unmatched ones (`requeueUnmatchedStoredLinks`).
  - Public data is enough for a user's own judging and scores.
- **Gentler on calicotab.** Every `*.calicotab.com` host shares one throttle chain and learned backoff (`throttleKey`), and the drain runs one calicotab job at a time (`jobHost` / `JOB_HOST_SQL`). A timeout counts as push-back. The private-URL page gets 30 s (`LANDING_FETCH_TIMEOUT_MS`). A landing timeout/5xx/429 retries after 15 min, then 1 h (3 tries, ~1.25 h); claims skip future `scheduledAt`.
- **Not changed:** claims still need the user's tick; a close name never links on its own; suppressed people never match. Namesakes at one tournament (one Person per name, option B phase 7) fall back to reading the page.
- **Rollback.** Revert the merge commit. No migration.

---

## 2026-10-29 - Consistency pass against the agreed guidelines

- **Owner:** "check for consistencies and spaces and ensure the previously listed guidelines are being followed", plus the phone layout.
- **How.** A scripted audit, run live in Chrome (desktop, every Statistics tab walked) and locally at 390x844 touch on every signed-in page. It checks:
  - content edges;
  - label styles;
  - the font of tile figures;
  - gaps against the spacing tokens;
  - stretched panels;
  - text overrunning a table cell;
  - dashed chart strokes;
  - paragraphs over 170 characters;
  - rows per table;
  - text under 12 px.
- **Spacing on the token scale.** 35 files used steps that are not tokens. They are mapped as follows:
  - 6 px (`mt/mb/pt/pb/space-y/gap-1.5`) to `hair`, 4 px;
  - 10 px (`space-y/gap-2.5`) to `inline`, 8 px;
  - 28 px (`mt-7`) and 40 px (`space-y/pt-10`) to `group`, 32 px.
  - Kept: 2 px optical nudges, the 20 px card inset that matches the 20 px page gutter, and padding inside badges and buttons.
- **Show, don't tell (remaining).** Method paragraphs cut to the facts a reader needs:
  - break line;
  - cross-tab cells;
  - appointments;
  - speaking vs judging;
  - motion types;
  - knockouts;
  - judging stages.
  - The coverage line is a compact list.
- **About 20 to a page.** New `useFirstRows` (`components/ui/useFirstRows.tsx`) shows 20 rows with "Show all N" (every row when printing). It is used on the team-placement and speaker-tab tables, which reached 25 on production.
- **Overrun.** The split tables' "few rounds" tag sits on its own line (it ran 10 px past the fixed first column).
- **Verified after the change.**
  - Desktop, local: no off-scale gaps, no stretched panels, no cell overrun, one label style, all tile figures in Inter 600.
  - Phone: all 13 pages at 20 px edges with no off-scale gaps.
  - Live before the change: Settings was already clean.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Dataviz pass 1 (research-backed)

- **Owner:** "the data visualisation is ugly"; then "don't update the charts until deep research results are in". The research (FT Visual Vocabulary, Datawrapper, GOV.UK Analysis Function, Urban, Carbon, Schwabish 2020, WCAG 1.4.1/1.4.11, Heer & Robertson 2007, NN/g 2020) and the mapped issue list are in `C:\Users\achar\reports\debate_cv-dataviz-issues-2026-10-29.md`. Owner decisions: 4-tier career chart, a score strip in place of the histogram, sans figures on tiles only.
- **Career charts.**
  - Four tiers: Did not break / Broke / Final / Won. Judging uses No outround / Judged an outround / Judged the final / Chaired the final / Core.
  - Cells carry a `depth` (stage rank), so "best result" and the order inside Broke still tell semifinals from quarters.
  - Did-not-break is a light recessive grey. Validated with the dataviz palette script: every adjacent pair clears the normal-vision floor (ΔE ≥ 21 light, ≥ 19.7 dark, up from 11.3 / 9.3), and the blues pass as an ordinal ramp.
  - Tokens are now `tier-none`, `tier-broke` and `tier-f`; `tier-qf` and `tier-sf` are removed.
  - Columns are 40 px, rounded only at the top. Each cap carries its count, with the star sitting on it.
  - Majors are marked by ◆ alone, with no ring. The legend has six items.
- **TrendChart.**
  - Values labelled on the last point and the extremes only.
  - One tick per year; points inset, so the "0" no longer collides.
  - The reference line is a solid hairline.
  - 2 px line, 10% wash, filled ringed dots.
  - Hover, tap and arrow-key readout with the tournament name.
  - A sample band when points carry `sub`.
- **ScoreStrip** (new, `components/ui/ScoreStrip.tsx`) replaces the histogram.
  - One dot per speech at half-point steps, with the middle-50% band and the median rule, plus a key.
  - Readout per score and a table alternative.
  - `ScoreProfile.scores` added; `meanBinIndex` and `Histogram` removed.
- **Figures.** `.figure` is Inter semibold with proportional lining digits (tiles and hero numbers only; tables keep mono).
- **Colour use.**
  - Team points per round: one blue, the share only. It was green for 3 and red for 0.
  - Funnel: the spoken row is grey; gold marks breaks only.
- **Split tables.**
  - "Rate" and "± you (pp/pts)" headers ("2nd-or-better rate" ran into "vs you").
  - Thin rows show a dash, not "n = 5" in every cell.
  - A small diverging bar beside the rate delta.
- **Copy.** Method paragraphs under the funnel, chairing, speaker tab and milestones are cut to the data-specific "left out" sentences. Judging meta: "Not filtered". Judging and speaker-tab tile hints trimmed.
- **Motion.**
  - Career entrance 320 ms plus at most 120 ms of stagger (was 500 plus 200).
  - Bar and meter fills ease to new widths over 300 ms on filter changes.
  - Reduced motion is honoured throughout.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Phone check 3

- Every signed-in page re-audited at 390x844 touch (local, seeded) and the public pages on production: no sideways scroll, edges at 20 px, gaps on the token scale.
- **Partners on a phone.** "Mark pro-am" wrapped to three lines inside its pill; the button is `whitespace-nowrap` and the Year column is hidden below `sm`.
- **Account "Your data".** Three short figures are a three-column row on every width instead of three stacked full-width tiles on a phone.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Live review 3: Adjudication, Partners, rounds, Settings cards

- **Adjudication ledger.** "Last outround chaired / judged" headers overran their 11rem columns into the next; now "Last chaired / Last judged" (full text in `title`), also on the public ledger. Widths rebalanced (chaired 10rem, Source 15rem; Tournament had 450 px for 256 of content).
- **Printed name.** The name under each tournament shows only where the tab spelled it differently from the usual spelling (the most frequent across that ledger's rows). It was "Abhishek Acharya" under 12 of 15 rows.
- **Round detail.** Motion text capped at `max-w-2xl` (was `max-w-lg`), so it stops wrapping to four lines beside 280 px of empty column.
- **Partners table** capped at `max-w-3xl`, like the other compact tables.
- **Settings cards.** A lone `CardBody` has no top padding, so each Settings card's heading sat 1 px under its border. The nine lone uses (Settings, Imports' URL cards, verify) take `pt-5`; the primitive is unchanged because onboarding passes its own `p-6`.
- **Copy.** Account "Your data" hints removed; the Found intro is one sentence and the list's repeat paragraph is gone.
- **Checked, fine:** career charts (light and dark), Imports URL list, Profile.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Live review: overlaps, stretched panels, settings subtitles

- **Source hosts overlapped.** On the Record ledger a long host (ilnuroundrobin.calicotab.com) ran 28 px under the Report flag, and on the public ledger and /sample hosts were clipped at the panel edge. `SourceLink` now truncates inside its fixed column (full host in `title`). The landing sample caps its host at `max-w-56`, which also stops the Worlds name wrapping to three lines.
- **Stretched panels on Statistics.** Six panels stretched to a taller neighbour, holding 176-1,031 px of empty space (the placement meters beside a 25-row table, the speaker-tab percentile, score bands, round number, team points, knockouts by class). Those grids are now `items-start`.
- **Public ledger.** Result widened to 11.5rem so "Final (Champion)" stays on one line; Source narrowed to match, since hosts truncate.
- **Copy.** Settings subtitles restating their headings removed (Account, Reports, Sharing; Profile went earlier). The /sample intro is one sentence. The BP straights hint reads "18 of 20 tournaments · 57/100 firsts" (it wrapped).
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Landing on a phone

- **Live phone check** of the public pages after the phone pass (no page scrolls sideways; section gaps are on the 48 px token).
- **Hero buttons.** "Build my debate CV" was its own width over a full-width "View sample CV". It is now full width on a phone (`BuildCvButton`, also the final CTA and /sample) and its own width from `sm`.
- **Sample table.** The "Team rank" header in mono caps set its column's width and squeezed tournament names to three lines. It reads "Rank" below `sm`; note 3 still says the rank is the team's.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Phone pass (390x844)

- **Owner:** "check the phone layout too". Every signed-in page measured at 390x844 with touch emulation, plus screen-height slices of each.
- **No page scrolls sideways.** Remaining inner scrollers are the round tables (424 in 290) and the opt-in "See the numbers" data tables.
- **Fixed:**
  - `StatRow` wrapped `null` children in empty cells (`Children.map`). Motions' admin-only "Tagged" tile left a blank row on a phone and a blank fifth column on desktop. It now uses `Children.toArray`.
  - Year subtotals wrap between figures, never inside one, and no line starts with a dot.
  - The Statistics placement table is Tournament and Team rank on a phone, with the outround under the name; the other columns return from `sm`. It used to scroll the rank out of view.
  - `Meter` values stay on one line ("Top 11%" wrapped).
  - Rate tile label drops "Round" (it broke at "2ND-OR-"); tile hints shortened.
  - Footer gap: `<main>` no longer pads its bottom (it added 32 to the footer's 48; the landing and /sample added 64); the footer margin is 32 on a phone, 48 from md.
  - Imports: the full-scan "Reconnect Gmail" note is screen-reader only while the banner says the same; tile hints trimmed; section gap on the token scale.
  - Motions: tile hints and the tag-coverage caption cut.
- **Not changed:** card titles and disclosure toggles are 24 px tall, which meets UX-8 (24 px; 44 only for primary controls).
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Statistics: compact tables stop stretching

- **Owner:** "some of the stats tables have a lot of whitespace".
- **Measured on production** (every tab walked, each column's width against its widest content). The ledger is `width: 100%`, so a two-column table spread to 1,230 px.
- **Capped at `max-w-3xl` (768 px), one shared width so their right edges agree:** Top-10 speaker finishes, Judging by format, Chair rate by season, Appointments, Spoken and judged by season. The TrendChart "Show the figures as a table" fallback is capped at `max-w-md`.
- **Left full width:** the seven-column split tables, break margins, Career records and the outround funnel, at roughly 40-60 px spare per column.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Copy pass: show, don't tell

- **Owner:** "where you feel there is unnecessary text or things are being over explained … refine it", then "if it is being shown don't tell, all the text that is present needs to be absolutely crucial and necessary".
- **Rule applied.** A note stays only if it prevents a misreading (BP counts 2nd or better as a win; a multi-motion round shows the round's result; power-pairing and the post-win rate), decodes an abbreviation (Spk avg / tab / rank, the motion-class wording), or states a consequence (privacy, account deletion).
- **Deleted.** The Statistics header line and headline note, the histogram, placement, round-number, three-a-side, top-10, chair-rate and topic notes, the Findings meta, the choice-of-motions subtitle, the public CV rank key and footer sentence, the Imports subtitle, the Profile subtitle and the Sharing pro-am hint.
- **Shortened.** Record banners, year subtotals ("broke 1", "judged 6 · broke at 5 · chaired outrounds at 1"), the ledger key, motions intro, empty states, account and disconnect warnings, identity and visibility hints, Statistics tile hints and seat-filter notes.
- **Follow-up (live check).** Dropped "Narrow by partner, pairing or seat", the coverage panel's closing caveat and "It fills in as more tabs…"; Findings bases read "25 tournaments · 1,655 teams".
- Tests that pinned old wording were updated (`cv.recordPage`, `publicCv.render`, `stats.topicTypeSection`).
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Record: career charts fold away, ledger above the fold

- **Owner:** "make the charts collapsible so the ledger is above the fold".
- **`CollapsibleCharts`** (`components/CollapsibleCharts.tsx`) folds the two career charts behind "Show career charts" on `/cv` only (`RecordHeader collapsible`).
  - Closed by default. The choice is remembered per browser (`localStorage` key `debate-cv:record-charts-open`).
  - A native `<details>`, with the charts built on first open (`DetailsBody`) and on `beforeprint`, so they still print.
  - The public CV and `/sample` keep them open.
- **`RecordHeader`** renders tiles and charts as two rows on the same two-column grid, so each tile pair still sits over its chart and the charts fold as one unit.
- **Phone gaps.** The /cv block gaps are 24 px on a phone (32 from md), the role rows 16 px (32 at lg), and the header gap and padding tighter, so the ledger clears the fold on a 390×844 phone too.
- **Measured** on the seeded DB:

  | Screen | Ledger tabs start | First row |
  | --- | --- | --- |
  | 1920×950, 1440×900, 1280×800 | 521 px | 691 px |
  | 390×844 | 784 px | |

  Opening shows both charts; a reload keeps them open; printing builds them when folded; no page errors.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - UI review 2: page weight, 20 per page, spacing

The owner asked for a second live review, "very harsh about spacing… don't let any page get too heavy, show only 20 results per page".

- **Built on demand** (`components/ui/Deferred.tsx`).
  - `Tabs` builds a panel the first time it is shown and keeps it.
  - `DetailsBody` builds a `<details>` body when it first opens (year groups).
  - `RevealedBody` builds a hidden row's content when it is first shown (round tables).
  - All three build everything on `beforeprint`, flushed synchronously, so Print to PDF still carries every tab, year and round.
  - Measured on the seeded DB: /cv 854 nodes, 21 rows built (production showed 12,375 nodes and 520 rows). /cv/stats 606 (production 4,787). A print copy builds 3,806 with both tabs and all 12 round tables.
- **Chart links into an unbuilt tab.**
  - Tab panels carry `data-anchor` ("y" / "j"), and `OpenYearOnHash` opens the tab, then retries for up to 20 frames until the year exists.
  - `urlWithTab` now keeps the hash; a tab switch had been dropping `#j2025`.
- **20 per page:** Motions (`PER_PAGE`) and the Imports URL list (`IMPORT_PAGE_SIZE`, was 50).
- **Spacing.**
  - Folded year rows are 59 px (were 93): the subtotal sits beside the year in two left-aligned lines, not three mono lines pushed to the far right.
  - Motions are rows divided inside each group, not bordered cards inside a bordered panel. Score, points and result sit inline on the tag row. The motion text has a `max-w-4xl` measure, and "Info slide" is 24 px tall on desktop (44 px on touch). Rows are 74-98 px (were 122-146), and the page is a third shorter.
  - The footer gap is 48 px (was 128).
  - Settings content is capped at 48rem (a switch row ran 1,000 px).
  - The chart legend and table toggle are on a tighter rhythm.
- **Not changed.** The Record's ledger still starts about 965 px down at 1920×950, under the header tiles and the two career charts the owner placed there (decisions 12-15).
- **Tests.** Tab, year and section tests now open what they check through the URL (`?tab=`, `?group=&section=`), since unopened panels are no longer in the HTML.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - UI review, part 4: wording, polish, Motions paging

- **Motions are paged, 30 per page** (owner: "heavily truncate the motions, 30 per page"). `app/(app)/cv/motions/page.tsx` slices the entries by `?page=` (clamped to the range).
  - The summary figures still count the whole record.
  - Groups on a page are open; a tournament split across pages is marked "continued".
  - A pager shows "31–60 of 234 · page 2 of 8" with Previous and Next links.
  - Measured on the seeded DB: 30 cards and about 745 DOM nodes per page (production showed 16,662 nodes on one page).
  - Each group also has `content-visibility: auto`.
- **Motion cards.** Every tag uses one style (outline): stem, topic, position, "1 of n" and "Judged" had been three looks. Judged motions drop the empty score, points and result row. The header's left-out note joins the main paragraph, in one text style.
- **Record ledger.**
  - On desktop the tournament name is plain text; the Source column is the row's one link (both used to link the same tab). Phone cards keep the name link.
  - Pts never shows a speaker total: a figure above 3 × prelims is a two-team tab's speaker-point column and is replaced by the wins count or "—" (`TeamPoints`).
  - On Adjudication the "Broke" badge sits once, with the last outround judged, not under "last chaired".
  - The report button is a flag, not ⓘ.
- **Settings.** The Sharing card is "Your public link" (the page title is "Public sharing"), and the eyebrow reads "Settings · Public sharing". The side nav loses its "Account" label, since Account is also a nav item. The Reports empty state is plain text, not a box inside a card.
- **Legal pages** (`legalProse.ts`). A `max-w-prose` measure (656 px; it was 1,496 px, about 148 characters a line) and no typography-plugin backticks around inline code.
- **Loading.**
  - The root `app/loading.tsx` keeps a header-height bar and a content block. It was a bare centred spinner, the first paint of every full load before the async app layout streams.
  - The Record skeleton matches the redesigned page: name, two tile and chart columns, the tab row and year rules.
- **Checked** in Playwright against the seeded local DB: motions pages 1, 2 and 99; one link per ledger row; the flag icon; the Sharing titles; the privacy measure; no page errors.
## 2026-10-29 - UI review, part 3: charts and Statistics

- **Career charts** (`components/ui/CareerChart.tsx`).
  - The always-on 96 px "Hover, focus or tap a year" box is gone. A one-line hint sits in the figcaption, and the year's details appear only while a year is active, floating over the legend (not the bars, where they would sit under the pointer and flicker) in a polite live region. The panel height stays the same either way: 460 px measured.
  - The major ◆ notch is inside its cell, not hanging off the bar's edge, where it read as a glitch.
  - The legend is an even 2/3-column grid, not a wrapping row with orphans.
  - Bar height still follows tournaments per year (owner decision 5).
  - Hydration note: the figcaption must stay a direct child of `<figure>`. A wrapper div around it is invalid HTML and broke hydration on /cv during this change.
- **Statistics summary strip.**
  - The four strongest findings show; the rest fold behind "Show N more findings". The tabs now start at 783 px; they were 1,021 px down.
  - A finding's direction is a ▲/▼ glyph as well as a colour.
  - The stale "checkable against the tables below" copy is replaced.
- **Chairing.** The rate tile and the by-season table sit side by side (16rem + the rest). Before, one tile stretched across the section and the five-column table ran thin over 1,000 px.
- **Checked** in Playwright on the seeded local DB: hover shows and leaving hides the details; the notch is inside its cell; the legend is a grid; the stats tabs start at 783 px with 4 findings and the fold; the chairing grid is 256 px + rest; no page errors on /cv, /cv?tab=adjudication or /sample.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - UI review, part 2: /sample is the real product

- **One fictional record** (`lib/sample/sampleRecord.ts`). It holds Maya Rao, with 11 speaking and 3 judging rows shaped as real `CvSpeakerRow` / `CvJudgeRow` data. Both the landing hero's preview (`AnnotatedSample`) and `/sample` read it, so they show one person; they used to show "A. Debater" and "Maya Rao".
- **`/sample` is rebuilt from the public CV's own components**:
  - `RecordHeader` (tiles and career charts);
  - `PublicHighlights`, now its own component;
  - the Ledger and Adjudication tabs grouped by year, with `PublicSpeakingTable` / `PublicJudgingTable`.

  It had drawn the pre-redesign Record by hand: a flat table, a seasons chart the owner dropped, tinted figures, and "Won/Lost" on BP rounds against the rule that a BP room is placed, not won. Built from the real components, it cannot drift from the product.
- **Signed in on /sample.** `PublicHeader` takes `signedIn`, and `/sample` passes it, so a signed-in visitor sees "Your record" instead of "Sign in".
- **Removed** `components/landing/SampleCvPreview.tsx` and `TrustRow` (unused after the rebuild).
- **Checked** at 1280 and 390 in Playwright: no sideways scroll, no page errors, and the tabs work.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - UI review, part 1: alignment and type

The owner asked for a critical review "as a UI expert who is very particular about layout, position, alignment and fonts". It was done in Chrome on production, against the owner's record. This PR fixes the alignment and type findings; the rest follow in parts 2-4.

- **Columns line up down the page.** Every Record year was its own auto-layout table, so columns sat wherever that year's content pushed them (Format at 416 px in 2026, 463 px in 2025; 82 px of drift on Adjudication). The ledgers are now `table-fixed` with one shared `<Cols>` width set: the new `Cols` helper in `components/ui/DataTable.tsx`, used for the speaking, judging and both public ledgers, and opt-in on `StatsSplitTable` as `fixedColumns` for the stacked Positions tables. Measured after: one column set across all years.
- **No sideways jump between pages.** `html { scrollbar-gutter: stable }`. A short page no longer centres 8 px off a tall one; content sits at 205 px on every page.
- **One container width per surface.**
  - Signed-in pages: header, content and footer all `max-w-(--breakpoint-2xl)`. The footer used to sit 192 px inside; `Footer` takes `width`.
  - Signed-out pages: all `max-w-wide`. The privacy and terms header was 72rem over 96rem content.
  - Admin drops its own narrower column.
- **Record edges.**
  - The chart panels pad 16 px, like the KPI tiles above them. They were 24 px, so the captions sat 8 px off the tile labels.
  - The year group's caret follows the year, so the rule, year and table share one edge.
  - The Partners year list is in the same panel and inset as the table below.
- **Type.**
  - Every uppercase mono label tracks 0.08em (it was 0.08, 0.09, 0.11, 0.12 and 0.14em across `.data-label`, `.eyebrow`, `.kicker`, `Badge`, `StatusPill` and two inline uses).
  - The Needs-attention banner body is Inter, not the display face.
- **Colour on a number means up or down.** The blue "Top 10%" and the gold break-rate tiles on Statistics and `/sample` are plain ink now; delta tints stay.
- **Numbers.** The admin counts group thousands ("1,163").
- **Checked** with Playwright at 1920 against the seeded local DB: one ledger column set on Record and Adjudication; Positions shared columns identical; header, content and footer at 205 px on /cv, /dashboard and /admin; tile labels and chart captions both at 222 px; label tracking 0.080em only.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Redesign QA: browser walk, accessibility, Core Web Vitals

- **Fixed.**
  - The Record and public CV **Source links** were 18 px tall, under SC 2.5.8's 24 px. They are now `min-h-6` (`components/YearGroups.tsx`).
  - Two **links in running text** (the landing ledger's "The full privacy notice", the public CV footer's "What this is") were told apart by colour alone (axe `link-in-text-block`). They are now underlined.
- **`npm run a11y`** (axe on 13 routes × 390/1280 × light/dark, seeded local DB). After the fixes: 0 violations, no sideways scroll, no target under 24 px, no nested controls.
  - With `A11Y_BEST_PRACTICE=1`, the only finding is `page-has-heading-one` on `/admin`. That is an artifact: a non-admin is redirected to `/cv`, and axe ran on its loading skeleton. `/cv` passes on its own.
  - In Git Bash, run it with `MSYS_NO_PATHCONV=1`, or `A11Y_ONLY=/` is rewritten into a Windows path and the landing route is skipped.
- **320 px walk** (Playwright, both themes): 18 routes, including every Record tab, the Statistics levels, Imports Review, Settings and Admin. All are 200, with no sideways scroll and no console errors.
- **Core Web Vitals** (lab, production, median of 3). Phone: 390 px, 4× CPU slowdown, 1.6 Mb/s and 150 ms RTT. Desktop: 1280, no throttling.

  | Page | LCP phone / desktop | CLS | Tap response phone / desktop |
  | --- | --- | --- | --- |
  | `/` | 1.90 s / 0.97 s | 0 | 253 / 77 ms |
  | `/sample` | 2.22 s / 1.00 s | 0 | 260 / 76 ms |
  | `/privacy` | 1.75 s / 0.70 s | 0 | 214 / 59 ms |

  - LCP is under 2.5 s and CLS is 0 everywhere.
  - The phone tap times are an INP proxy (a theme-toggle tap timed to the next frame, including Playwright's click dispatch on a 4× slowed CPU), so read them as an upper bound.
  - Signed-in pages need the owner's login and were not measured on production.
  - There is no real-user monitoring (no Speed Insights); add it if field data is wanted.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Motion (decision 23)

- **Tokens** (`app/globals.css`).
  - `--default-transition-duration: 120ms` and an ease-out default, so every bare `transition-*` utility (hover, press, focus) runs 120 ms. The three hard-coded `duration-150 ease-soft` hovers (Button, ImportsStages, NavLink) now take the default.
  - Disclosure carets run 180 ms (year groups, round caret, round card, filter partner list, unmatched rows, motions archive).
  - `--animate-fade-in` is now a 200 ms opacity cross-fade.
- **Cross-fades.**
  - Tab panels fade in on every switch: a CSS animation restarts when `hidden` comes off (`components/ui/Tabs.tsx`).
  - Signed-in route changes fade through `app/(app)/template.tsx`, which Next remounts on each navigation.
  - Opacity only, so reduced motion keeps them (an `.animate-fade-in` exception in the reduce block).
- **Count-up** (`components/ui/CountUp.tsx`).
  - The Record header's four figures count up once per session, in 600 ms ease-out. The public CV stays still (§3.6).
  - The server renders the final value; screen readers hear only the final number.
  - Reduced motion shows the final value at once.
  - A figure is marked seen only when its count finishes, and a teardown mid-count restores the real figure.
  - **Flicker rule:** on a full page load the server's figure is painted before hydration, so a hydrating figure counts only if hydration came within 150 ms of first paint. A client navigation always counts. `useSyncExternalStore` (the server snapshot during hydration) tells the two apart.
- **Unchanged.** The career bars already grew once in 500 ms plus a stagger capped at 200 ms (≤700 ms). Nothing loops except the loading skeleton's shimmer and spinners, as before.
- **Checked** with Playwright against the seeded local DB:
  - computed transitions: 0.12 s ease-out, carets 0.18 s, panels `fade-in 0.2s`;
  - a client navigation to /cv counts 0→12 over about 600 ms;
  - a slow first load shows 12 with no flicker;
  - with reduced motion the figures show at once and the panels still fade;
  - no page errors.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Landing page: four sections, an annotated sample, privacy as a ledger

- **Layout** (`app/page.tsx`, owner decision 20, design §3.1). There are four sections where there were seven:
  1. a split hero: the headline, Build my debate CV and the trust line "Read-only Gmail · we keep tab links, never email bodies" on one side, and the annotated sample (`components/landing/AnnotatedSample.tsx`) on the other;
  2. the privacy ledger;
  3. How it works, in four steps (Connect · Claim your name · Review · Share);
  4. the closing call to action.
  - The value cards, the statistics showcase and the FAQ are gone.
- **Annotated sample.** A fictional record with the compact speaking chart and three ledger rows. Numbered callouts ①②③ point at the source link, the gold break and the team rank, and a numbered list says each one in words. The markers are hidden from screen readers, which read the list.
- **Privacy ledger.** Three columns, each row a fact the code backs:
  - **What we read.**
  - **What we keep:** the tab link; the subject line, date and message id of the email (`DiscoveredUrl`); the tab pages as fetched (`SourceDocument`); confirmed names; the encrypted token.
  - **What we never store.**
  - A final line gives the `gmail.readonly` scope and **Google's testing mode: only invited test users can sign in for now** (owner, 2026-10-29). Update that line when Google reviews the app.
- **Header.** It gains "How it works" (`/#how`), hidden below `md`.
- **Checked.**
  - In Chrome, signed out.
  - In Playwright: at 390×844 the headline is two lines and the sample starts at 498 px, above the fold. At 320 the sample is still above the fold. There's no sideways scroll at 320, 390 or 1280, and no console errors in either theme.
  - New `tests/landing.render.test.ts`.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Statistics: the new sections (decision 19, part 2 of 2)

- **Speaking → Speaks → Top-10 finishes** (`TopFinishesSection`, model `lib/cv/topSpeakerFinishes.ts`): each Open, ESL or EFL top-10 finish, once per tournament, newest first with majors marked. It reads `topSpeakerDetail`, the same definition as the Record chart's stars.
- **Judging → Results.** The old single judging section is four slot sections in `components/stats/JudgingViews.tsx`:
  - Outrounds judged (tournaments judged, broke as a judge, outround chairs);
  - Chairing (chair rate overall and by season);
  - Core roles (appointments). The core count stays low until the 9 CA/DCA roles are re-ingested.
  - Speaking vs judging is unchanged.
- **Judging → Conditions:**
  - By format (`judgingByFormat`: tournaments, breaks, chair rate, using judgingLens's own `isMeasurable`, now exported);
  - By stage (the deepest-outround distribution);
  - By motion topic (`judgingByTopic`: prelim rounds judged, by the single topic of their motions; mixed or untagged rounds are left out).
- **Data.** `/cv/stats` now also sends `judgedMotions`, the motions of the prelim rounds the user judged. They are kept apart from `taggedMotions`, so speaking figures never see a round the user did not speak in.
- **Checked** in Chrome against the seeded local DB: By motion topic opens straight from its URL (4 topics, 6 of 11 judged prelims tagged), Core roles and Top-10 render, and there are no console errors.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Statistics as three tab levels (decision 19, part 1 of 2)

- **Structure** (`components/stats/StatsTabs.tsx`, wired in `FilterableStats.tsx`). The long scroll and its jump rail are gone. There are three levels of APG tabs, each in the URL (`?role=…&group=…&section=…`):
  - **Speaking**
    - **Results (team):** Team placement · Breaks (outround funnel and break margin) · Straights & firsts (results and milestones).
    - **Speaks (you):** Speaker tab · Score bands.
    - **Conditions:**
      - By position;
      - By format (format, region and field-size splits);
      - By round (dynamics, round curve, momentum);
      - By motion topic (topic × type and the topic split);
      - By motion type (motion types, the stem split, cross-tabs);
      - By partner (teammates, carry).
  - **Judging**
    - **Results:** Outrounds and breaks · Speaking vs judging.
- **Desktop and phone.** Level 3 is a vertical list on desktop and a "Section" dropdown on a phone.
- **Above the tabs:** the summary strip (headline figures and findings). The Coverage note sits at the foot.
- **Filters.** Partner, pairing and seat sit inside the Speaking tab, because judging has none of them. A filter change keeps the tab parameters, and a tab change keeps the filter's.
- **Leftovers, as the owner chose.**
  - Seasons (`SeasonTrends`) is deleted, because the Record's yearly charts carry it.
  - Cross-tabs moved under By motion type, and Speaking vs judging under Judging.
  - `PageJumpNav` and `STATS_SECTIONS` are deleted.
- **Seat filter.** A tournament-level slot keeps its tab and says why it is empty. A slot whose sections all render nothing shows "Not enough on your record for … yet".
- **Checked.**
  - In Chrome: switching levels writes the URL; a reload restores it; a seat filter works alongside the tabs; Judging opens its own results.
  - In Playwright at 390 (both themes) and 1280: no sideways scroll, no console errors, and the phone dropdown changes the section.
- **Part 2** (new sections): Top-10 finishes; judging Chairing, Core roles, and Conditions by format, by stage and by motion topic.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Statistics: pro-am from the user's marks; the filter works again

- **Pro-am** (owner decision for Statistics, 2026-10-29; rule 2026-10-27, "no automatic pro-am"). `RoundFact.proAm` and `TournamentFact.proAm` are now `'marked' | 'unmarked'`. They come from `User.proAmMarks` (the Record's Partners tab): marked when any partner at that tournament carries a mark, and null with no partner. `buildStatsFacts` takes `proAmMarks`, and `/cv/stats` reads them.
  - `PRO_AM_GAP` and the 1.5-point label are gone. `partnerGapFor` keeps the gap as a number only.
- **Labels follow.**
  - The pairing filter is "Marked pro-am / Not marked".
  - The Teammates table shows "Pro-am ×n", and its note says marks are never guessed from scores.
  - Cross-tabs read "in pairings you marked pro-am".
  - The Carry section loses its "true by construction" caveat, because the label is no longer defined by the gap it measures.
- **Bug fixed: the filters did nothing.** `FilterableStats` derived its filter from `useSearchParams` and relied on Next syncing `history.replaceState` into it. On Next 16 it did not: a chip changed the URL and nothing re-rendered (seen in Chrome on the seeded local DB, for the seat and pairing chips). The filter is now component state, read once from the URL and written back, the same as `Tabs`. This was live on production before this PR.
- **Checked** in Chrome: "Marked pro-am" presses and narrows to "Showing 8 of 69 scored prelim speeches, from 1 of 12 tournaments".
- **Next:** the three tab levels (decision 19), then the new sections.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Share image: the person card carries the speaking chart

- **Person card** (`components/landing/ShareCard.tsx`, owner decision 12). The 1200×630 card for `/u/<slug>` (Open Graph and X) now shows:
  - the name and active years;
  - three figures: Tournaments, Broke (speaking breaks only, never added to judging, per the 2026-10-27 rule) and Best finish;
  - the speaking career chart drawn in flex boxes, one cell per tournament in the light tier colours, a major's cell outlined, the last 12 years;
  - one emerald rule above the trust line.
- **Light always**, like print.
- **Unchanged.** The generic card for the landing page and for a private or missing slug names no one, and the privacy re-check and the short cache stay as they were.
- **Route** (`app/u/[slug]/opengraph-image.tsx`; the X card re-exports it). It adds `speakingSeries(speakerRows)` and the best result from `speakingYearTotal`. Both come from the same buildCvData call, with the hidden tournaments excluded.
- **Checked** by rendering both PNGs locally against the seeded DB (1200×630).
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Public CV redesign (part 3)

- **Layout** (`app/u/[slug]/page.tsx`, owner decision 18):
  - the header carries "✓ N tournaments, each linked to its tab";
  - then the same tiles and career charts as the Record (`RecordHeader`, shared);
  - then Highlights as two short lists side by side, Speaking and Judging, up to three each, majors first (`lib/cv/publicHighlights.ts`, ranked by the career chart's own tiers);
  - then Ledger and Adjudication tabs grouped by year with subtotals, both printed;
  - then a footer: "Compiled from N public tabs · last updated <date> · What this is".
  - There's no Partners tab.
- **Shared year groups.** `components/YearGroups.tsx` now holds the year `<details>`, the subtotal lines and the Source cell for both pages. Each page passes its own table: `components/RecordLedger.tsx` for the owner, `app/u/[slug]/PublicLedger.tsx` for the public CV.
- **Theme.** The public CV follows the visitor's theme (decision 3). The layout's forced `data-theme="light"` is gone; print and the PDF stay light through the print stylesheet.
- **Pro-am marks** show on the public ledger (a "Pro-am" badge under the team) only when the owner turned on the Settings → Sharing switch.
- **Lighter load.** The page no longer asks buildCvData for speaker field sizes. Only the old "best speaker rank" highlight read them, and Highlights now follow team results, never speaker rank. `components/CvHighlights.tsx` is deleted, because nothing renders it any more.
- **Fixes found on the way.**
  - `judgingCell` counts a chaired outround as judged when no judged stage is recorded.
  - The `Tabs` row drew a ▲●▼ scrollbar on Windows, because the selected tab's underline sat at -1px inside an `overflow-x-auto` row. The rule under the row is now an inset shadow.
- **Checked** in Chrome and Playwright against the seeded local DB:
  - 1280 and 390, light and dark: 200, no console errors, no sideways scroll;
  - print shows both panels on white.
- **Not in this part.** The OG and Twitter share image (1200×630, speaking chart only, decision 12).
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Record redesign, part 2: Partners tab and pro-am marks

- **Partners tab** (`components/RecordPartners.tsx`, model `lib/cv/proAm.ts`). A year overview lists who you debated with, how often and how many you marked pro-am. Beneath it, one row per partner per tournament carries an `aria-pressed` toggle (`components/ProAmToggle.tsx`), owner decision 17 and the 2026-10-27 rule "no automatic pro-am, users mark it". The tab never prints: the marks are private.
- **Storage.** `User.proAmMarks` (text list of "<tournamentId>|<partner name key v2>") and `User.publicProAmEnabled` (default false), migration `20261029110000_user_pro_am_marks`: two additive columns with constant defaults, so no rewrite and no backfill. It is named before option B's `20261029120000_identity_v2_expand` (#223, unmerged), so the migrations stay in order whichever merges first. **Merging applies it to production** (`migrate-if-configured.mjs`). Rollback DROPs are in the SQL header.
- **API.** `POST /api/cv/pro-am` `{tournamentId, partner, marked}`: the tournament must be on the user's record (a DiscoveredUrl), and each direction is one atomic `array_append` / `array_remove` UPDATE (it sets `updatedAt` itself, as raw SQL must). Capped at 1,000 marks; rate limit `cv:proAm` 300/hour.
- **Sharing.** `/api/sharing` and `SharingManager` gain "Show pro-am marks on my public CV" (off). The public CV does not show marks yet: that lands with part 3.
- **Still automatic elsewhere.** `lib/cv/statsFacts.ts` still labels pairings pro-am by the 1.5-point gap on /cv/stats. The owner's rule retires it; that goes with the Statistics phase.
- **Checked** in Chrome against the seeded local DB: the toggle saves (`aria-pressed` flips, the year overview shows "pro-am 1" after refresh), and the switch shows in Settings → Sharing. Tests: `tests/cv.proAm.test.ts`, `tests/api/cv-pro-am.test.ts`, plus the record page and sharing suites.
- **Rollback.** Revert the merge commit, then run the two DROPs if the columns should go.

---

## 2026-10-29 - Record redesign, part 1: header charts, Ledger and Adjudication by year

- **Order change (owner, 2026-10-29).** The owner moved the Record, public CV and Statistics work ahead of option B ("found changes later"). Option B phase 2 (#223) stays open until the Neon rehearsal.
- **Header** (`components/RecordHeader.tsx`): two tiles per role (Spoke · Broke | Judged · Outrounds judged), each pair above its career chart, side by side from `lg` and stacked below it with Speaking first (owner decisions 5, 12, 13). A role with no tournaments is left out. The old header tiles (`pickHeaderMetrics`) and the Highlights block no longer render on /cv; both still serve `/u/[slug]` and `/sample` until part 3 rebuilds those.
- **Tabs Ledger · Adjudication** (`components/RecordLedger.tsx`, moved out of `app/(app)/cv/page.tsx`, 858 → 275 lines). Each calendar year is a `<details>` whose summary is the year's subtotal (`lib/cv/periodTotal.ts`): tournaments · broke n of N · best result · median team place (n), then the speaker-tab average over n speeches, then a judging line (owner decision 14). The current and previous years start open, per tab; a record ending earlier opens its latest year. The Year column became **Source** (tab host in mono, ↗, the public tab page; decision 16).
- **Chart → year.** A speaking bar links to `#y2025`, a judging bar to `#j2025`; `components/OpenYearOnHash.tsx` switches to the tab, opens the year and scrolls to it. `CareerChart`'s `yearHref` function became `yearAnchor` (a prefix string), because a server component cannot pass a function to a client one.
- **Print.** A tab set inside `data-print-all="true"` prints every panel without the tab row (`app/globals.css`, in `@layer base`: Tailwind's preflight `[hidden]` rule is `!important` in that layer, so an unlayered override loses).
- **Checked** signed in against the seeded local DB at 1280 and 390, light and dark: 200, no console errors, no sideways scroll, a judging bar switches to Adjudication and opens the year, print media shows both panels.
- **Not in this part.** Partners tab with the pro-am toggle (needs a schema field and a Settings → Sharing switch: part 2); public CV header, two-list Highlights, footer and OG card (part 3). The purple core segment is only right after the 9 CA/DCA re-ingest; the "Added from public tab" mark waits for option B.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Identity option B: owner decisions in the spec, phase 1 (name key v2)

- **Spec.** `docs/superpowers/specs/2026-10-27-person-identity-option-b-design.md` gains section 10, the owner's 2026-10-29 answers, overriding the text above it, with inline markers where it does:
  - legacy claims are carried over (guarded) and shown with the "Added from public tab" mark, so `buildCvData` reads URL tournaments plus claimed participations;
  - a `close` name never auto-claims;
  - four guardrails on new claims (evidence, same-round, one owner, 50 a day);
  - name-level suppression with admin exceptions;
  - phase 7 after 1-6 with a short-list re-ingest;
  - the owner runs production steps after an agent rehearsal, with a 14-day soak.
- **Phase 1** (no database). `normalizePersonNameV2` in `lib/calicotab/fingerprint.ts`: NFKD, drop every combining mark, spell out undecomposed Latin letters (đ ð ı ł ø æ œ ß þ), keep letters of every script, v1's separators. `nameProximity.fold` now uses it, with NFKC first so full-width brackets are dropped as a parenthetical. v1 (`normalizePersonName`, the `Person.normalizedName` bucket key) and every caller of it are unchanged. The Found matcher (`lib/discovery/names.ts`) and the identity checker also stay on v1.
- **Measured on the 2026-10 export** (`~/Documents/source-docs`, 68,681 distinct names from speaker tabs and participant lists, through the ingest parsers):
  - 409 keys differ from the old `fold`: 44 non-Latin names it emptied, 365 Latin names with đ (117), ı (57), ł (53), ø, ð or æ;
  - with v2, every keyed name matches itself;
  - all 4,455 Latin names holding a special letter are `match` or `close` to their ASCII spelling. Before the transliteration table and the bracket fix, 6 were still `different`, all of them nicknames in full-width brackets.
  - The comparison ran as a temporary test and was deleted; it printed counts only.
- **Effect today.** `fold` serves only `proximityToYou` in `/api/onboarding/names`, which skips names whose v1 key is empty before comparing. So the visible change is Latin names with those letters now matching a plain spelling of the profile name (`close` → `match` or `different` → `close`).
- **Tests.** New `normalizePersonNameV2` cases in `tests/calicotab.fingerprint.test.ts`, new proximity cases in `tests/identity.nameProximity.test.ts`, every existing answer unchanged; 2243 tests pass.
- **Next.** Phase 2: the expand migration (columns, `UserNameAlias`, indexes; section 4.1), rehearsed on a Neon branch first.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Navigation: four header items, Imports as stages, Found in Review

- **Scope (owner's choice).** The UI half of what the redesign plan put "with Found phase 2". In the discovery spec, phase 2 is identity option B phases 1-4 (alias table, per-participation claims, dual-write, backfill, read switch); that and "Add to my record" (spec phase 3) are not in this PR. Option B still has four open owner questions (phase 7 timing, legacy claims, suppression scope, who runs production steps); its Q3 is answered by the owner rule that a close name always needs the user's tick.
- **Header.** Record · Statistics · Motions · Imports (`app/(app)/layout.tsx`). Settings and, for admins, Admin moved into the account menu (`UserMenu`, now "Settings" → `/settings` instead of "Account" → `/settings/account`). `CvSubNav` and its test are deleted, so each destination is in one nav level (closes **NV-4** and **NV-23**). The admin page gains an "Operator tools" section linking `/cv/verify` and `/cv/tags`, which were reachable only from that bar.
- **Imports as stages** (`components/ImportsStages.tsx`): Sources → In progress → Review → On record, one link per tile, replacing the four filter tiles. Failures are a line under the strip (`deadLinksText` replaces `failedTileHint`).
- **Review stage** (`?stage=review`, `components/ImportsReview.tsx`): imports needing the user's name (link to the Unmatched table) and, behind the discovery flag, the Found list (`components/FoundReview.tsx`, moved from `app/(app)/cv/found/page.tsx` unchanged in behaviour). The Found search runs only in this view. `/cv/found` is a permanent redirect in `next.config.ts`.
- **Tests.** `tests/discovery.page.test.ts` became `tests/discovery.review.test.ts` (every case kept, plus the name-claims half); new `tests/imports.stages.test.ts`; `tests/nav.shared.test.ts` pins the four header items.
- **Not checked in a browser signed in.** The local embedded Postgres on 55432 that earlier sessions used is not running, and only the system PostgreSQL 17 service (port 5432, other credentials) is. Check on the preview or production: the header at 320 / 390 / 1280, the account menu's Settings / Admin, Imports stages and `?stage=review` (with the flag, as the owner), and that `/cv/found` lands on Review.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Primitives: Tooltip, Tabs, CareerChart (foundations, PR 4 of 4; stacked on PR 3)

- **What.** The three building blocks the page rebuilds need. Only Tooltip is wired in now; Tabs and CareerChart land on pages with the Record / Statistics rebuild (after identity option B phase 6, per the agreed order).
- **Tooltip** (`components/ui/Tooltip.tsx`). Closes **NV-21**: the theme toggle, notification bell, account menu and back-to-top button now show their name on hover (400 ms delay) and at once on keyboard focus (`:focus-visible`), never on touch, never while their own menu is open. It is `aria-hidden` (each control already has its accessible name). WCAG 1.4.13: Escape dismisses without moving focus, hovering the label keeps it, it stays until pointer or focus leaves. The theme toggle's native `title` is gone. Closed, it is `display: none`: a first version only made it invisible, and the invisible label centred on the right-edge theme toggle made `/`, `/sample` and `/privacy` 393px wide at 390 (caught by the screenshot diff); header controls also use `align="end"`. Back to top: the fixed positioning moved from the button to the Tooltip wrapper.
- **Tabs** (`components/ui/Tabs.tsx`, helpers in `lib/utils/tabParam.ts`). APG tabs (UX-59): one tab stop, arrows by orientation, Home/End, automatic activation, `aria-selected` / `aria-controls`. Selection in the URL via `history.replaceState` (UX-60, same reasoning as FilterableStats); the server resolves the first tab with `resolveTab`, so no flash. Vertical lists with `phoneSelect` become a labelled `<select>` below `md` (UX-63). `prominent` for the top level of a nested set. Checked in a browser: keyboard, URL updates, the default tab dropping the parameter, reload restoring the tab, 390px with no sideways scroll.
- **CareerChart** (`components/ui/CareerChart.tsx`, model `lib/cv/careerChart.ts`). The owner's 2026-10-29 chart spec: one stacked bar per calendar year (gaps included), one cell per tournament, height = tournaments that year. Speaking tiers: did not break / ink rule / quarters and below / semis / finals / champion (gold). Judging: no outround / ink rule / QF and below / semis / final / chaired the final (gold) / adjudication core (purple, counted once). Majors: ink outline and ◆ notch plus `◆n` under the year. Stars sized by the square root of the count: top-10 speaker finishes (Open or ESL/EFL, once per tournament) or outrounds chaired. The tier rules reuse `breakDepth`, `wonTournament` + `bracketOf`, `isTopSpeaker`, `judgeTypeTag === 'core'` and `lastOutroundChaired`, the same definitions as Highlights; gold/silver/bronze finals are finals and only a gold win is a champion; Plate is not a break.
  - Each bar is a link to `#y<year>` named with its counts; hover or keyboard focus fills a details strip; on touch the first tap fills it and the second follows the link (a tap focuses before it clicks, so focus only counts when `:focus-visible`). A "See the numbers" ledger table and a compact static form (landing sample) with a text alternative. Bars grow once (500 ms, stagger capped at 200 ms), not under reduced motion.
  - Checked in a browser with a realistic two-career fixture at 1280 and 390, both themes; tests in `tests/cv.careerChart.test.ts` (one per owner rule) and `tests/ui.primitives.test.ts`.
- **Not done here.** The adapter from `CvData` to the chart and the page layouts (Record header, public CV, Statistics tabs) come with the page PRs. Tests and CareerChart do not cover a real database record yet.
- **Checked.** Public pages at 390 / 1280 in both themes are pixel-identical to PR 3; typecheck, lint, file-size, ratchet (167/167), 2234 tests and `next build` pass.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Icons: lucide-react to Phosphor, plus debate marks (foundations, PR 3 of 4; stacked on PR 2)

- **Why.** Owner decision 2026-10-29: the old icons "felt mediocre and cheap". lucide has one weight, so 12-24px icons all drew the same stroke.
- **Change.** `lucide-react` removed; `@phosphor-icons/react` 2.1.10 (MIT) added. All 56 lucide icons in 52 files are mapped to Phosphor equivalents (e.g. `Loader2` -> `CircleNotch`, `ExternalLink` -> `ArrowSquareOut`, `AlertTriangle` -> `Warning`, `Square` -> `Stop`). Icons at 20px and above get `weight="light"` (19 call sites); the rest use Regular.
  - **One barrel, `components/ui/icons.ts`**, importing each icon from its own file in Phosphor's `dist/ssr` build. `ssr` has no React context, so it works in Server Components; per-file imports because the `/ssr` index loads all ~1,500 icons where nothing tree-shakes. The first version used the index, and two render tests (`publicCv.render`, `publicSurfaces.render`) then timed out at 5 s under the full suite. Per-file imports fixed it, and `optimizePackageImports` in `next.config.ts` is no longer needed.
  - **ESLint `no-restricted-imports` (error)** blocks `lucide-react` and direct Phosphor imports outside the barrel.
  - Two Phosphor names collide with ours and are aliased at their call site: `Table as TableIcon` (`/cv`) and `Link as LinkIcon` (`/dashboard`).
- **Debate marks** (`components/ui/DebateMarks.tsx`), drawn on Phosphor's 256 grid with its stroke widths and checked at 14, 16, 20 and 40px beside Phosphor glyphs: Break (knockout bracket), Champion (bracket plus a filled winner's dot), Major (◆), Speaker (lectern), Core (inner circle). First drafts were rejected on sight: rising bars for Break read as a phone signal meter, a tab-shaped Source mark read as a folder (Phosphor's `Table` is used instead), and the first lectern read as a goblet. Panel, partner and info-slide marks come with the pages that need them.
- **Highlights** (`components/CvHighlights.tsx`) now uses the marks instead of Trophy / Mic / GraduationCap / Gavel / Crown / Globe / Users: Championships = Champion, Deepest breaks = Break, Speaker tab = `Star` (the chart star), best speaker-tab rank and peak average = Speaker, Outrounds chaired = `Chair`, Adjudication core = Core in `core-purple`, Major circuit = Major. The `/cv` empty state uses `Table`, the motions empty state `Quotes`.
- **Visual check.** Production vs this branch, `/`, `/sample`, `/privacy` at 390 / 1280 px, both themes: only icon pixels change (610-690 px per page), no layout shift. Phosphor Regular at 14px is a finer stroke than lucide's (about 0.9px vs 1.2px), so small icons look lighter; the padlock most of all.
- **Bundle.** Client chunks 1.09 MB -> 1.26 MB raw in total. Each Phosphor icon carries all six weights; for the 53 icons in use that is 30 KB gzip at most, and a page only loads the icons its client components use. If it matters later, a generated two-weight copy would save about 20 KB gzip in total.
- **Checked.** Typecheck, lint, file-size, ratchet, 2211 tests and `next build` pass. Signed-in pages not looked at (no seeded database in this session): check `/cv` (Highlights), `/dashboard`, `/settings`, the toasts and the status pills on the preview.
- **Rollback.** Revert the merge commit; `npm ci` restores lucide.

---

## 2026-10-29 - Design tokens for the redesign (foundations, PR 2 of 4; stacked on PR 1)

- **Change.** New `@theme` tokens in `app/globals.css`, no visual change:
  - Spacing, eight named steps on a 4px base: `hair` 4, `inline` 8, `tight` 12, `stack` 16, `panel` 24, `group` 32, `section` 48, `page` 64 (`p-panel`, `space-y-stack`, `mt-section`, ...). Nothing uses them yet; the rebuilt components will.
  - Page widths `max-w-content` (1120px) and `max-w-wide` (1280px); reading text uses Tailwind's built-in `max-w-prose` (65ch), which outranks a custom key of the same name.
  - Career-chart colours: `tier-none`, `tier-qf`, `tier-sf`, `tier-f` (plus the existing `break-gold`) and `core-purple`. Every one clears 3:1 against surface and canvas in both themes; the measured ratios are in the comments next to the channels.
- **`cn()`** now knows the spacing and width names, so `cn('p-4', 'p-panel')` resolves to `p-panel` instead of shipping both. New `tests/utils.cn.test.ts` covers that and the older font-size/colour case.
- **Removed.** `oxblood` (same value as `primary`; 7 files now use `primary`); the unused `archive-white` and `record-*` colour tokens and their channels; `text-body-serif` (one caller, now `text-base`, still 16px, its `leading-snug` already overrode the token's line-height). `ink` / `paper` stay (80+ files, an abstract contract per CLAUDE.md).
- **Fixed.** The `theme-color` meta was the warm and green tints of an older theme (`#F7F6F1`, `#0C1311`); it is now the Statement canvas (`#F6F7F9`, `#0E1116`). The `app/layout.tsx` font comment described the 2026-06 Tab Room Terminal theme.
- **Docs.** `docs/DESIGN_INSTRUCTIONS.md` §6 gains the purple rule (owner decision 2026-10-29: purple means only an adjudication-core role), the chart tiers and a Spacing section. CLAUDE.md's token notes are updated.
- **Deferred on purpose.** Merging the type scale (16 named sizes to 11) changes rendered sizes (`caption` 12.5px vs `table` 13.5px), so it lands with the page rebuilds, not here.
- **Checked.** Pixel diff against production for `/`, `/sample`, `/privacy` at 390 / 1280 px, light and dark: 0 differing pixels in all 12. Typecheck, lint, file-size, ratchet, 2211 tests and `next build` pass.
- **Rollback.** Revert the merge commit.

---

## 2026-10-29 - Tailwind 3.4 -> 4.3 (redesign foundations, PR 1 of 4)

- **Why.** First step of the redesign agreed on 2026-10-29 (design doc outside the repo: `reports/ui-ux/Design architecture - reimagined site 2026-10-29.md`, section 0). The new tokens (spacing scale, renamed colour aliases, `core-purple`) will be written as v4 `@theme` variables, so the platform moves first, on its own, with no visual change.
- **Change.** `tailwindcss` 3.4 -> 4.3, `@tailwindcss/postcss` replaces `tailwindcss` + `autoprefixer` in `postcss.config.mjs`. `tailwind.config.ts` is deleted: its theme is the `@theme` block at the top of `app/globals.css`, and the `@layer components` classes (`panel`, `ledger`, `data-label`, ...) are now `@utility` blocks. Done with `npx @tailwindcss/upgrade`, then corrected by hand.
- **What the upgrade tool got wrong, fixed here.**
  - It dropped both plugins. `coarse:` / `fine:` are now `@custom-variant`s (18 files use `coarse:`); typography is `@plugin` (no call site uses `prose`, kept for parity).
  - It rewrote the Button and Badge **variant name** `'outline'` to `'outline-solid'` in 7 places, treating a TypeScript string as a class. Reverted.
  - It turned the numeric-header rule into `@utility text-right`, shadowing Tailwind's own utility, with an invalid `&th` selector. Removed; the `ledger` utility already right-aligns `th.text-right` and `th.cell-num`.
  - It emitted a `container` utility with the wrong padding. Nothing uses `container`, so it is gone.
  - It deleted the config's rationale comments; the ones that still apply are carried into `@theme`.
  - Windows `npm install` dropped the two nested `@emnapi/*@1.11.2` lockfile entries; restored from `origin/main`.
- **One real v4 behaviour change, compensated.** v4 lets an explicit `leading-*` / `tracking-*` beat a font-size token's own line-height and letter-spacing at every breakpoint; v3 let a later `md:text-display` win. That loosened the two desktop headlines (`/`, `/sample`). Both now restate the display token's values at `md:`. No other class list mixes a responsive size token with explicit leading or tracking.
- **Renamed classes (mechanical, same output).** `break-words` -> `wrap-break-word`, `outline-none` -> `outline-hidden`, `outline` -> `outline-solid`, `bg-gradient-to-r` -> `bg-linear-to-r`, `[mask-image:...]` -> `mask-[...]`, arbitrary sizes to named ones of the same value (`max-w-[32rem]` -> `max-w-lg`), `bg-x/[0.06]` -> `bg-x/6`, `aria-[invalid=true]:` -> `aria-invalid:`. Two tests asserted on the old strings and are updated; the settings one now checks the `aria-invalid=` attribute, not the substring.
- **Checked.** Production build of this branch vs production (`main`), full-page screenshots of `/`, `/sample`, `/privacy` at 390 and 1280 px in light and dark: **0 differing pixels in all 12**. Typecheck, lint, file-size, ratchet, 2208 tests and `next build` pass. **Not checked:** signed-in pages (no seeded database in this session); look at `/cv`, `/cv/stats`, `/dashboard` and `/settings` on the preview.
- **Behaviour notes for v4.** `hover:` now applies only on devices that can hover, so taps no longer leave sticky hover states. Browser floor: Safari 16.4, Chrome 111, Firefox 128.
- **Rollback.** Revert the merge commit; `npm ci` restores 3.4 and `tailwind.config.ts`. No data or migration involved.

---

## 2026-10-28 - a11y smoke re-run on main, and the last measured defects fixed

- **Re-run.** `npm run a11y` (axe WCAG 2.2 A/AA + best-practice, plus the overflow and target-size probes) against a production build of `main` with the seeded local database: **0 axe violations in all 52 route/width/theme combinations**, no console errors. The 27 Oct baseline had violations on 6 of 13 routes (46 dark contrast nodes on /privacy, 19 + 3 + 1 `scrollable-region-focusable`, `empty-table-header`, `definition-list`).
- **Still failing after that run, now fixed here.**
  - `/cv/stats` scrolled sideways at 390 px (page 923 px; STAT-24). The wide split tables sit in a correct `overflow-x: auto` scroller, but their width still reached the document's scroll width. `contain: paint` on `.table-scroll` stops that (`app/globals.css`). Checked by bisecting the DOM, then trying `contain`, `overflow: clip` and `html overflow-x` in the browser: only `contain: paint` worked.
  - The signed-out header (`components/landing/PublicHeader.tsx`) was 23 px wider than its row at 390 px, so `/`, `/sample`, `/privacy` scrolled sideways. Privacy now drops out below 420 px (it is in every footer), as Sample CV already did below 380 px.
  - 15-ish targets under 24 px per page on `/cv/stats`, `/dashboard?filter=all`, `/settings/sharing`, `/settings/profile`, `/sample`, `/u/<slug>`: checkboxes `h-4 w-4` -> `h-6 w-6` (5 components plus the public-visibility list, which had none), `min-h-6` / `py-1` on the table-toggle summaries, the dashboard URL links and "← Summary", the sharing link, and the public footer links.
  - `scripts/a11y-smoke.mjs` no longer counts a visually hidden 1 px input (the CSV file picker) as a target.
- **Result.** All 52 combinations: 0 axe violations, no sideways scroll, 0 targets under 24 px, 0 nested controls.
- **Not covered.** These are automated checks: no keyboard-order or screen-reader testing, and no judgement on the parked design decisions (theme direction, icon policy, motion).
- **Rollback.** Revert the commit.

---

## 2026-10-28 - react-hooks rules back to errors (Next 16 follow-up)

- **Change.** The 12 spots flagged by `react-hooks/set-state-in-effect` (11) and `react-hooks/immutability` (1) are resolved and the two rules are errors again (the temporary `warn` override in `eslint.config.mjs` is gone).
- **Reworked (4 components).** `ThemeToggle` reads `document.documentElement.dataset.theme` with `useSyncExternalStore` (a MutationObserver is the subscription). `DashboardActions` takes its clock from the new `components/useNow.ts` (shared store, 30 s tick, `refreshNow()` after a scan; null on the server and first client render so hydration agrees). `CvNeedsAttentionBanners` takes fresh counts from the parent while rendering (React's "adjust state when a prop changes" pattern) instead of in an effect. `IngestProgressTracker`'s self-referencing `poll` callback became a loop declared inside the effect, with a `cancelled` flag, so no timer is scheduled after unmount.
- **Left as effects, with an explained `eslint-disable-next-line ... -- reason` each (8).** `AdminTagProposals`, `IdentityManager`, `SharingManager`, `NotificationBell`, `OnboardingFlow`, `ParticipantSearch` (fetch-on-mount / on key change) and `CvDownloadButton` (localStorage prefs applied after hydration), `FilterableStats` (which sections rendered is only known from the DOM after commit). Removing the fetch ones properly means adopting a data-fetching library (SWR or React Query); not done here.
- **Checked in a browser** against a local production build and database: theme toggle flips, relabels and persists; the Imports page renders signed in; the notification (60 s) and progress (30 s idle) polls fire on schedule; `/cv/stats` rail has all 21 targets; no console messages on a fresh load. Typecheck, lint, ratchet, file-size and 2208 tests pass.
- **Rollback.** Revert the commit.

---

## 2026-10-28 - pg sslmode made explicit (follow-up to Prisma 7)

- **Why.** After Prisma 7 went live, Vercel logged `SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'` on `/u/[slug]` and the cron route. Behaviour today is already the strict one; the warning says pg v9 will switch those modes to the weaker libpq meaning (no certificate verification for `require`).
- **Change.** `poolConfig` in `lib/db.ts` rewrites `sslmode=prefer|require|verify-ca` to `sslmode=verify-full` (unless `uselibpqcompat` is set). Other values and URLs without `sslmode` (local dev) are untouched. Tests in `tests/db.poolSize.test.ts`.
- **Verify.** After deploy the warning should stop appearing in Vercel runtime errors, and queries still succeed.
- **Rollback.** Revert the commit.

---

## 2026-10-28 - Prisma 6.19 -> 7.10 (step 4 of the platform order, the heavy one)

- **Change.** `prisma` / `@prisma/client` 6.19 -> 7.10.1, plus `@prisma/adapter-pg` and `dotenv`.
  - `prisma/schema.prisma`: `url` / `directUrl` removed from the datasource (v7 rejects them).
  - New `prisma.config.ts`: the CLI uses `POSTGRES_URL_NON_POOLING`; it loads `.env` itself via `dotenv/config`. It reads the variable with `process.env`, not `env()`, because `env()` throws when it is unset and that would break `prisma generate` on installs with no database.
  - `lib/db.ts`: the client now needs the `pg` driver adapter. `poolSizedUrl` became `poolConfig`: it reads `connection_limit`, `pool_timeout`, `connect_timeout` from the pooled URL, removes those (and `pgbouncer`) from the string handed to `pg`, and returns `max` (never below `INGEST_DRAIN_CONCURRENCY`, never lowering a higher value) and `connectionTimeoutMillis` (default 10 s, as in Prisma 6). With no URL (build, unit tests) it builds against a placeholder host `POSTGRES_PRISMA_URL-is-not-set.invalid`, because v7 throws at construction without an adapter.
  - The four `.mjs` scripts that build their own client now pass an adapter. The two seed scripts import `dotenv/config` (v7 no longer loads `.env` on import); the two operator scripts that must never read `.env` (`approve-tag-proposals`, `export-source-documents`) stay shell-only.
- **Kept `provider = "prisma-client-js"`** (still supported in 7.10), so the 22 `@prisma/client` imports and the `.mjs` scripts are unchanged. **Follow-up:** move to the new `prisma-client` generator (`output = ...`, TypeScript output; the `.mjs` scripts would then need tsx or a build step). A Prisma 8 RC exists; check whether it drops `prisma-client-js` before then.
- **Tested against a local Postgres** (embedded Postgres 55432, same as `.env`): all migrations apply to an empty database; `seed:dev` runs; the production build serves `/u/<slug>`, its OG image, `/sample`, and signed-in `/cv`, `/cv/stats`, `/cv/motions`, `/dashboard`, `/settings/sharing` with the seeded data and no server errors; 2204 tests pass.
- **Error behaviour probed through the adapter** (the code branches on these): unique violation -> `PrismaClientKnownRequestError` P2002 (sharing slug OK); serializable conflict -> P2034 (notifications dedup OK); deadlock -> P2010 whose message contains `40P01`, caught by `isDeadlockError`'s string check; interactive transaction timeout -> P2028; missing table -> P2021 (discovery budget OK); unreachable -> P1001; `count(*)` still `bigint`, BigInt ids still `bigint`, `jsonb` still parsed.
- **One behaviour change.** Pool exhaustion no longer raises Prisma's P2024; it is a plain `Error: timeout exceeded when trying to connect`. Nothing in `lib/` or `app/` matches P2024, and `isPermanentError` only matches a landing-page 404, so such jobs stay retryable. Pool of 6 served 6 concurrent 0.5 s transactions in 0.69 s.
- **Verify on the preview / production.** The checks above ran on a local database, not Neon. After merge, watch the first drain for `timeout exceeded when trying to connect` and for TLS errors: pg 8 treats `sslmode=require` as full certificate verification (Neon's certificates are publicly signed, so this should be fine; if it is not, the symptom is a P1010 on every query).
- **Not changed.** No `"type": "module"`, no `PRISMA_*` engine variables to remove (none were set).
- **Rollback.** Revert the merge commit; `npm ci` restores 6.19 and the `url` / `directUrl` datasource. No migration or data change is involved.

---

## 2026-10-28 - TypeScript 5.9 -> 6.0 (step 3 of the platform order)

- **Change.** `typescript` ^5.7 -> ~6.0.3. No source changes: typecheck, lint, 2203 tests, ratchet and `next build` all pass unchanged.
- **Why 6.0, not 7.** TypeScript 7.0.2 (the native port) is `latest`, but `typescript-eslint` 8.72.1 declares `typescript >=4.8.4 <6.1.0`, and the type-aware lint rules and the ratchet depend on it. Moving to 7 would break lint. **Revisit when typescript-eslint supports 7**; until then keep `~6.0`.
- **Rollback.** Revert the merge commit.
- **Next in order.** Prisma 7 (heaviest: new generator, no automatic env loading).

---

## 2026-10-28 - Zod 3 -> 4 (step 2 of the platform order)

- **Change.** `zod` ^3.23 -> ^4.6.7. The 15 API routes that returned `parse.error.flatten()` now call `z.flattenError(parse.error)` (the v3 method is deprecated in v4). The response shape (`formErrors`, `fieldErrors`) is identical, so clients are unaffected.
- **Why nothing else changed.** Typecheck was clean with v4 and no schema uses `.uuid()`, `.default()` on transforms, `z.record` with one argument, or `.errors`. 2203 tests pass.
- **Watch.** Zod 4's string formats (`.email()`, `.url()`) still work but are deprecated in favour of `z.email()` / `z.url()`; not touched here.
- **Lockfile gotcha.** `npm install` on Windows drops the nested `@emnapi/*@1.11.2` entries under `@oxc-resolver/binding-wasm32-wasi`, which breaks `npm ci` on Linux CI. After any install on Windows, copy those two entries back from `origin/main`'s lock.
- **Rollback.** Revert the merge commit.
- **Next in order.** TypeScript 6/7, then Prisma 7.

---

## 2026-10-28 - Next 16 upgrade (branch `chore/next-16`, local, not pushed)

- **Change.** `next` 15.5 -> 16.4.3, `eslint-config-next` -> 16.4.3. `middleware.ts` renamed to `proxy.ts` (export `proxy`; Node runtime, same nonce/CSP logic). `eslint.config.mjs` now imports `eslint-config-next/core-web-vitals` and `/typescript` directly (FlatCompat removed; v16 is a native flat config and FlatCompat crashed on it). `.claude/**` added to the ESLint ignores. `tsconfig.json` took Next's required `jsx: react-jsx` and the `.next/dev/types` include (so an unused `import * as React` in `components/ui/BarList.tsx` was dropped).
- **Not needed.** Async `params`/`cookies()`/`headers()` were already awaited (typecheck clean); no `next lint` usage, no custom webpack config, no parallel routes. The canary codemod crashed on a missing module, so the migration was done by hand.
- **New lint rules.** `react-hooks/set-state-in-effect` (11 spots) and `react-hooks/immutability` (1) arrive with the v16 config; set to `warn` in `eslint.config.mjs` until reworked. Not new debt: the code is unchanged.
- **Ratchet.** Dropped a dead `tagName` + `void tagName` in `lib/calicotab/parseMotions.ts` (flagged by `no-meaningless-void-operator`); `no-unnecessary-condition` baseline 95 -> 94.
- **Checks run.** typecheck, `next build` (Turbopack, Proxy recognised), 2203 vitest tests, ratchet, file-size, arch. All pass.
- **Edge runtime removed.** `app/icon.tsx`, `apple-icon.tsx`, `opengraph-image.tsx`, `twitter-image.tsx` moved from `runtime = 'edge'` to `'nodejs'` (the build warned Edge is deprecated; `/u/[slug]` images were already Node). Checked on a local production server: all four return 200 `image/png`, and the CSP header and inline scripts carry a fresh nonce per request.
- **Verify on the preview.** Branch `preview/next-16`: load `/`, `/icon`, `/opengraph-image`, a signed-in page; confirm no CSP violation in the console.
- **Rollback.** Revert the commit (restores `next` 15.5, `middleware.ts`, the FlatCompat ESLint config, and `tsconfig.json`).
- **Next in order.** Zod 4, then TypeScript 6/7, then Prisma 7.

---

## 2026-10-27 - Function size trim 1: stop tracing server source maps into functions

- **Finding.** Each serverless function traced ~57 MB median / 77 MB max unzipped, and 9-18 of its traced files were `.next/server/chunks/*.map` (server source maps). Those maps are uploaded to Sentry at build time (`withSentryConfig`, when `SENTRY_AUTH_TOKEN` is set), so they need not ship inside functions.
- **Change.** `next.config.ts`: `outputFileTracingExcludes: { '*': ['**/*.map'] }`. Sentry resolves stack traces from the uploaded maps, so error reporting is unaffected. `sourcemaps.deleteSourcemapsAfterUpload` was NOT added: it exists in the installed `@sentry/nextjs` 10.76.2 types but already defaults to `true`, so setting it adds nothing. Client source-map behaviour is unchanged.
- **Measurement (74 routes).** Local Windows builds cannot show the effect: Next joins the exclude glob with `path.join`, which yields backslashes on Windows, so nothing matches there (traces identical before/after). Docker was unavailable (engine 503), so the Linux result was computed by applying Next's exact matching (`picomatch` with `dot`, `contains`, posix paths) to the real baseline traces: median 57.4 -> 51.6 MB, max 77.2 -> 56.5 MB, 806 `.map` entries removed (~10.9 per route, ~8.9 MB per route on average). The key `'*'` was checked to match every route key.
- **Verify on Vercel.** Open the preview deployment (branch `preview/trim-function-sourcemaps`) > Resources / Functions and compare function sizes with a recent main deployment; they should drop by roughly the amounts above. Also confirm the build still uploads source maps (Sentry release) and a test error still resolves to TypeScript.
- **Rollback.** Revert the commit (removes the one config option).

---

## 2026-10-27 - Vercel deployments only for main and preview/* branches

- Hobby's ~100 deployments/day quota was exhausted by agent pushes, which also blocked production deploys. `vercel.json` `git.deploymentEnabled` now creates deployments only for `main` and `preview/*`; agent/feature prefixes are disabled. Name a branch `preview/<name>` to get a preview. `verify` (GitHub Actions) still runs on every PR. Test: `tests/vercelJson.test.ts`.

---

## 2026-10-27 - SAFETY: preview builds no longer run migrations (owner action needed)

- **Incident.** The Vercel Preview build log for PR #201 showed `prisma migrate deploy` applying migration `20261027120000_appearance_candidate` to a real database (`neondb`). `scripts/migrate-if-configured.mjs` assumed previews have no database attached, but the Preview environment had the Postgres URL, so an unmerged migration (one that changes existing user data) ran from a PR build.
- **Now.** Migrations run only for production deployments (`VERCEL_ENV=production`) and for local builds with the URL set. Other Vercel builds skip with a log line. Force with `ALLOW_PREVIEW_MIGRATIONS=1`, only for a preview with its own isolated database. Logic: `scripts/lib/migrate-gate.mjs`; tests: `tests/migrateGate.test.ts`.
- **Owner: check Vercel Settings > Environment Variables.** See whether `POSTGRES_URL_NON_POOLING` and `POSTGRES_PRISMA_URL` are enabled for the Preview environment. If Preview points at the production database, give Preview its own database (a Neon branch) or remove the variables from Preview. Previews reading the production database is still a risk even with migrations gated.
- Also check whether the PR #201 migration was already applied to the production database and whether that was intended.

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
