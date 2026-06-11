# Design Teardown — Debate CV

**Date:** 2026-06-11
**Mandate:** Full teardown. Nothing survives without re-justification. `docs/DESIGN_INSTRUCTIONS.md` is the constitution (owner ruling, Phase 0); the current *execution* of it is on trial. If the result looks like the current site, the teardown failed.

---

## Phase 0 — Rulings (owner-confirmed)

1. **The design doc governs.** The 2026-06-11 "Tab Room Terminal" retheme is dead. The doc's "never a hacker dashboard" rule wins over the phosphor terminal, and the OS-fallback theming that served the terminal as a first impression to dark-mode phones is specifically condemned.
2. **Taste anchors** (where the audience already lives): raw tab sites (calicotab/Tabbycat tabs, hellomotions, tournament Sheets), LinkedIn/Notion/Docs (the CV link must survive next to a LinkedIn URL), Instagram circuit culture (break announcements as stories; screenshot-first, mobile, high-contrast). Explicitly **not** chosen: gamified stat-profiles (chess.com/Strava). No streaks, no badges-as-game.
3. **Owner's confessed suspicions:** the sample CV doesn't sell, and the site still reads as a template. Both are confirmed below, with the structural reasons.
4. **Blast radius:** full UI rebuild authorized. Stack (Next/Tailwind/Prisma) fixed; everything in the UI layer is replaceable.

---

## Phase 1 — Brutal audit

### 1.1 The first impression was a coin flip you rigged against yourself

The theme script reads `localStorage`, falls back to OS preference. The majority of 18–30 phone users run OS dark mode. So the modal first impression of a product whose only conversion barrier is *"can I trust this with my Gmail?"* was a green-black terminal with phosphor accents — the visual genre of the exact thing a user fears when granting mail access. This is not a taste problem; it is handing the trust objection a costume. (Ruled dead in Phase 0; recorded here because the *mechanism* — first-impression surfaces inheriting a mood toggle — must never return. Credential surfaces don't have moods.)

### 1.2 The sample CV is a thumbnail, and debaters can smell a fake tab

`SampleCvPreview` is a ~30%-width hero card: **three** hardcoded tournament rows, a nine-bar decorative chart, and a header claiming "23 tournaments · 9 breaks". The numbers and the visible record don't reconcile — and the audience consists of people whose sport is checking whether claims survive scrutiny. `/sample` adds only five rows.

Worse, `/sample`'s hero copy is a design memo shipped to users: *"This is the artifact users should understand before signing in… This is the product promise, not decoration."* That sentence is the author explaining the design doc to himself. A debater reads it and learns nothing about their own record.

**Cost:** the doc's single first-session win — *see a sample CV, understand the value, believe sign-in is worth the trust cost* — is structurally impossible. You cannot believe in an artifact you've only seen as a postage stamp. This is the owner's suspicion #1, and it's not a polish problem: the landing's information architecture allocates the artifact a sidebar.

### 1.3 The landing page is the shadcn marketing skeleton wearing archive tokens

Structure of `app/page.tsx`: hero (eyebrow + H1 + subhead + two CTAs + three trust chips) → three-card value strip → three-step numbered how-it-works → privacy panel → FAQ accordion → inverted dark final-CTA band. That is the stock Tailwind/shadcn landing template, section for section. Swapping token values onto a template skeleton does not change the genre; the **layout** is the genre signal. This is the owner's suspicion #2, confirmed at the bone level — no amount of re-coloring fixes it because the bones are the problem.

Copy tells, named:

- **"No AI glow."** in the hero subhead. The product's first paragraph spends itself negating a hype it never raised. Negating AI discourse still imports AI discourse into the ten most expensive words on the site. (Doc §8: avoid AI hype. Negation is a form of it.)
- **FAQ #1: "Is this an AI tool?"** The user's actual first anxieties are *is my data safe / what exactly do you read / who sees this*. Leading the FAQ with AI is answering the author's Twitter feed, not the user.
- **"The import flow exists to get out of your way."** A section headline about the importer's self-awareness. Doc §2: the importer is plumbing. Plumbing doesn't get headlines.
- **"Privacy before polish", "Questions worth asking", "No magic, no elite gate."** Self-referential meta-copy — the site reviewing itself. This is the single strongest portfolio-project tell in the codebase.

### 1.4 The signed-in app is still the dead editorial magazine

Doc §11 killed "Vol."-style editorial furniture. It's alive: the CV masthead renders **"DEBATE CV — VOL. III · COMPILED 11 JUNE 2026"**, the H1 is the user's name in *serif italic with a full stop* ("Maya Rao."), "In Brief" writes literary prose with spelled-out numbers ("Two tournaments. One break."), sections are Roman-numeraled, the Imports page is headlined **"Tournaments, in flight."** This is the literary-magazine register the doc explicitly forbids ("never a literary/editorial magazine"), and it survived because the retheme only moved token *values*.

The purest artifact: **`font-serif` resolves to Space Grotesk oblique.** The stylesheet lies about itself — a "serif slot" rendering a grotesk so that hundreds of `font-serif italic` call sites didn't need touching. A design system that needs an alias to impersonate a dead design system is two design systems, and both lose.

### 1.5 The type system is three eras in a trench coat

Editorial-era token names (`kicker`, `byline`, `dropcap`, `pull-quote` — the last two defined and *unused*), terminal-era fonts (Space Grotesk / Inter / IBM Plex Mono), and a px-soup scale (10.5 / 11.5 / 12.5 / 13.5 / 14 / 15 / 16.5…). Inter + Space Grotesk is the default pairing of every 2024–26 Tailwind starter — it is the typographic equivalent of the template skeleton in §1.3. Cost: the site cannot read as "could only belong to Debate CV" while set in the two most templated faces on Google Fonts.

### 1.6 Color: one green doing four jobs, and a red name wired to it

Tournament green is simultaneously primary action, success state, verification signal, and *decorative eyebrow color*. Doc §6: "Do not use color as decoration. Color must carry meaning." Green eyebrows on every section header are decoration, and they dilute the one meaning green must keep (act / verified). Break gold — the color with the best story in the palette — is demoted to a single table-cell text color. And the alias `oxblood` (a dark red) resolves to green: mislabeled wiring, kept to avoid churn that the Phase 0 ruling now authorizes.

### 1.7 IA: top nav passes the doc, the sub-nav fails it

Top nav (CV / Growth / Imports / Share / Settings) matches doc §5 — credit where due. But:

- **`CvSubNav` re-introduces "Analytics"** as a tab under a top-nav item named "Growth". Two names for one surface; the doc explicitly chose "Growth" *because it names the value*.
- **"Verify" and "Tags" are implementation jobs promoted to peer tabs of the record itself.** Provenance-checking and taxonomy moderation are maintenance tasks, not destinations of equal rank with the CV.
- **"Share" is a nav item that teleports into `/settings/sharing`.** Share is a verb performed *on the record*, not a place. A nav item that dumps you in settings is the author's sitemap, not the user's job.
- Signed-out, "How it works" is hidden on mobile (`hidden sm:inline`) — on a doc-mandated mobile-first product.

### 1.8 Mobile is where the identity dies

The CV's 13-column speaking table collapses on phones to a generic 2-column `<dt>/<dd>` card grid — the most default data fallback Tailwind offers. The ledger identity, the entire visual thesis, evaporates on exactly the device the audience holds. Nothing on the site is screenshot-worthy, for an audience whose circuit culture (Phase 0 anchor #3) circulates *screenshots of results* as a social currency.

### 1.9 The public CV buries the credential and has no share face

`/u/<slug>` opens with avatar + italic name + byline, then icon highlight tiles, then tables. A selector arriving from a LinkedIn or WhatsApp link gets no scannable credential block — the headline facts (champion of X, N breaks, best average) are scattered into tiles. And the killer: **there is no `og:image` anywhere.** Twitter card is declared `summary_large_image` with no image to summarize. Every time a debater pastes their CV link into WhatsApp, Instagram DM, or LinkedIn — the product's actual distribution channels — the preview is a blank card. For a product whose pitch is *shareable proof*, the share preview is the most important pixel surface that was never designed.

### 1.10 Component sprawl, inverted priorities

Six Button variants (plus a deprecated alias), seven Badge variants, Card/CardHeader/CardBody/CardFooter — generic-primitive sprawl. Doc §7 says record-native components should *dominate* and generic primitives are foundation-only. The actual ratio: the record language is three CSS classes (`.record-panel`, `.eyebrow`, `.data-label`); everything else is the shadcn idiom. Stock template motion (`fade-up`, `fade-in`, `shimmer`) decorates entrances on a product that claims to be a ledger. Ledgers don't fade in.

### Audit verdict

The doc is sound. The execution is a competent Tailwind template wearing the doc's vocabulary as token names. The artifact that must sell the product is a thumbnail; the voice is a dead magazine; the share surface — the product's entire social loop — doesn't exist. The current site serves the author's iteration history (editorial era → terminal era → rename pass). It does not yet serve a debater on a phone deciding in 60 seconds whether this is worth their inbox.

**What did I get wrong about your intent?** If any of the above defends something you actually built deliberately for a reason the repo doesn't record, overrule it in writing — in this file.

---

## Phase 2 — The overhaul: **TAB SHEET**

One organizing idea, fused from the three taste anchors: **the product is the tournament tab, elevated to credential grade.** Not a website *about* a record — the website *is* the record. Every screen behaves like a results sheet posted on the tab-room door: ruled, dense, typographically certain, with exactly one moment of ceremony (gold, for breaks). It must be table-literate like calicotab, respectable next to LinkedIn, and screenshot-able like a break announcement.

The test for every decision below: *does this make the site feel like a verified competitive record, for a debater on a phone?*

### 2.1 Typography

**Dies:** Inter, Space Grotesk, the `font-serif`→grotesk impersonation, `kicker`/`byline`/`dropcap`/`pull-quote` tokens, the px-soup scale, all serif-italic headings, names with full stops.

**Replaces — a three-face system with a records pedigree (all free, Google Fonts, variable):**

- **Display: Archivo** (Expanded width axis, weights 600–900) — a grotesque built for headlines and *literally named for archives*. Masthead, page titles, and the wordmark in Archivo Expanded caps. Commands at modest sizes through width and weight, not just scale — which is how a results sheet shouts.
- **Text/UI: Libre Franklin** — the Franklin Gothic lineage is the typeface of printed results pages and newsprint agate. Body, UI, table prose. Reads as "printed record," not "SaaS default," and holds at 13px table sizes.
- **Data: Spline Sans Mono** — designed for UI data rather than code editors (no terminal connotation). Every numeral, rank, year, score, ID, and column header. `font-variant-numeric: tabular-nums` globally on it, not opt-in via `.num`.

**Scale:** strict rem scale with two reading modes — **agate** (12.5–13.5px table text; the audience reads dense tabs daily, do not inflate) and **document** (16px body). Display hierarchy via Archivo width/weight steps.

**The ownable signature:** the section header *is a tab column-header* — Spline Sans Mono caps, letterspaced, with a **2px ink rule above and a hairline below**, exactly the header-row grammar of a tab sheet. This one pattern replaces eyebrows, kickers, *and* Roman numerals across the entire product. No other site has it because no other site is a tab.

### 2.2 Color

**Dies:** the entire dark theme (tokens, `ThemeToggle`, theme-init script, OS fallback), green-as-decoration, the `oxblood`/`ink`/`paper`/`archive-white` aliases, shadows as elevation language.

**Replaces — one theme, jobs separated (doc §6 buckets, re-derived values):**

- **Sheet white** — warm paper, a touch brighter than current (`~48 30% 97%`). One background. Credential artifacts don't have moods; `/u` and print already force light, which was the product confessing its true nature.
- **Record ink** — near-black, warm. Text and the heavy rule.
- **Rules, two weights** — hairline gray for row separators, **2px ink for header rules**. The heavy rule is the system's spine; the current all-hairline timidity is what reads "template."
- **Ballot green** — *only* primary action and verified state. Never headers, never decoration. If green appears, you can click it or trust it.
- **Break gold** — promoted from a text color to the ceremony system: break/champion rows carry a gold edge-rule and gold result text. **Gold is earned, never decorative** — a palette rule that is also the product's worldview.
- **Score blue** — charts only. **Signal red/amber** — destructive/warning only.

### 2.3 Layout & grid

**Dies:** the card-grid marketing skeleton, `record-panel` boxes, three-card value strips, rounded-12px cards, the inverted dark CTA band, elevation shadows, `fade-up` entrances.

**Replaces:** a **document grid**. Content sits *on* the sheet, separated by rules and whitespace — not *in* boxes. Radius collapses to 2px (records have corners); shadows survive only on true overlays (popovers). Tables are the backbone of every page, full-width to the container, not widgets embedded in cards.

**The landing page is inverted — the artifact IS the page:** a compact masthead, then immediately a **full-fidelity sample record: 15–20 rows of one believable fictional season arc** — including the noise that makes records credible (a 17th-place speaker rank, a missed break, judging rows, a reserved break) — rendered in the *production* CV components. A slim sticky bar carries the conversion: "Sample record · **Build my debate CV** · read-only Gmail · private until shared." Marketing copy demotes to short interstitials between record sections; the privacy table sits adjacent to the CTA. The product sample stops being decoration and becomes the sales argument, which is doc §6 verbatim — finally executed.

**Mobile-first means the mobile row is designed first:** the bespoke **result line** replaces the `<dt>/<dd>` fallback — two lines per tournament: line 1, tournament name + year + gold break marker; line 2, a mono data string (`3rd · 74.2 avg · #8 spk · QF`). Dense, thumb-scannable, and deliberately screenshot-able: this is the unit that gets dropped into the group chat.

### 2.4 Navigation & IA

**Dies:** `CvSubNav` (Record/Analytics/Tags/Verify), "Share" as a nav destination, "Analytics" as a name anywhere, mobile-hidden nav items.

**Replaces:**

- **Signed-out:** Sample · How it works · Privacy · **Build my debate CV** — all visible on mobile (doc §5, now actually honored on phones).
- **Signed-in:** **Record · Growth · Imports · Settings.** Share becomes a primary *action on the record* (button in the record masthead opening the share capsule), because sharing is a verb. "Verify" dissolves into per-row source affordances plus a review queue inside Imports — provenance is a property of rows, not a sibling page of the CV. "Tags" becomes a contribution prompt where tags matter (Growth coverage notes, row detail), not a top-level tab. *(Owner decision flagged — Phase 3.)*
- **Public `/u`:** restructured as a credential, in reading order: name + **headline-fact stat block** (3–4 big mono facts: titles, breaks, best avg, span) + verified-source line → record tables → colophon CTA ("Compiled by Debate CV — build your own"). A selector must absorb the credential in one screen without scrolling.
- **`og:image`, finally:** a generated share card per public CV (and one for the site) via `next/og` `ImageResponse` — name, headline facts, gold break strip, set in Archivo/Spline Mono. The WhatsApp/Instagram/LinkedIn preview becomes a break-announcement-grade artifact. This single addition serves the screenshot culture anchor harder than any on-page redesign.

### 2.5 Component language

**Dies:** Card/CardHeader/CardBody/CardFooter as the dominant idiom, 7-variant Badge, 6-variant Button, soft-circle EmptyState icons, generic stat tiles, the "CV-in-a-box" brand mark.

**Replaces — doc §7's record-native set, actually built:** `RecordHeader` (masthead with heavy rule), `TournamentRow` (desktop `<tr>` + mobile result line, one component), `SourceBadge` (mono `TAB ✓` chip linking to the source URL — verification as a visible property of every row), `BreakMarker` (gold), `StatBlock` (big mono numeral over ruled label), `ImportStep`, `ClaimRow`, `GrowthStrip`, `TrustRow`, `ShareCapsule`. Buttons collapse to three variants (primary ballot-green, ghost, destructive), squared (2px), Libre Franklin semibold, sentence case. Badges collapse to status colors only. No imagery anywhere — the record is the imagery.

**Brand:** wordmark **DEBATE CV** in Archivo Expanded caps; mark = a gold break-slash or ruled tab glyph. The lowercase "debate cv" twee-ism dies with the editorial era. *(Owner decision flagged.)*

### 2.6 Copy voice

**Dies:** "No AI glow.", FAQ-leading "Is this an AI tool?", "Tournaments, in flight.", "VOL. III · COMPILED", spelled-out-number literary prose, every self-referential line ("This is the product promise, not decoration", "Privacy before polish", "No magic, no elite gate").

**Replaces:** tab-literate declaratives that talk about *the user's record*, never about the site.

- Hero: **"Every break, on the record."** Subhead: "Debate CV compiles your tournaments — results, speaker scores, breaks, judging — into one verified record you can share."
- Microcopy grammar: `label: fact.` ("Gmail scope: read-only. Used to find tournament links you were sent.")
- FAQ reordered to actual anxieties: what do you read in Gmail → what's stored → who can see this → what if a tournament's missing → Tabbycat affiliation. AI gets one quiet answer near the end, if at all.
- "In Brief" survives as an idea, reborn as a factual mono summary line, not literary prose.
- Status language (Done/Pending/Running/Failed/Unmatched) survives — it's already terse and correct.

### 2.7 Motion

**Dies:** `fade-up`/`fade-in` entrance animations, `shimmer` skeletons.

**Replaces:** paper doesn't animate. Instant state changes; 150ms transitions on interactive states only; static ruled placeholders for loading. **One ceremony:** when an ingested tournament row lands on the record, a single gold flash-and-settle — the "posted to the tab" moment. That is the entire motion budget, which is why it will be felt.

**What did I get wrong about your intent?** Overrule by editing this section; every subsystem above stands alone, so a veto on one (e.g., the brand mark) doesn't unravel the rest.

---

## Phase 3 — Implementation plan (ordered, shippable; tracks doc §12)

Each chunk ships green (`lint`, `typecheck`, `vitest`, `next build`) and is independently revertible.

1. **Truth & copy pass** *(small, no visual risk)* — kill self-referential strings, "No AI glow", FAQ reorder, "in flight", "VOL." kicker. Pure copy edits across landing/sample/app mastheads.
2. **Design tokens v2** *(the gate for everything else)* — fonts → Archivo / Libre Franklin / Spline Sans Mono via `next/font`; delete dark theme block, `ThemeToggle`, theme-init script (one `data-theme="light"`); new color values with separated jobs; radius → 2px; shadow collapse; new rem type scale; delete `kicker`/`byline`/`serif`-alias/`oxblood`/`ink`/`paper` (mechanical rename across call sites — churn authorized by Phase 0 ruling).
3. **Primitives & record components** — Button collapse (3 variants), two-weight rule system, tab-style section header, `StatBlock`, `SourceBadge`, `BreakMarker`, mobile **result line**, static skeletons.
4. **Landing + `/sample`** — artifact-first inversion: hand-authored 15–20-row fictional season dataset, production CV components, sticky CTA bar, privacy table adjacent to CTA. The conversion surface, rebuilt around the owner's suspicion #1.
5. **Public `/u` + `og:image`** — credential-ordered masthead with headline-fact stat block; `ImageResponse` share card. The social loop, finally designed.
6. **Signed-in shell & IA** — nav → Record/Growth/Imports/Settings; `CvSubNav` dissolved; Share becomes a record action; Verify → row affordance + Imports queue; Tags → contextual prompt.
7. **CV record view** — `RecordHeader`, `TournamentRow` everywhere, factual "in brief" line, gold ceremony styling on break rows.
8. **Growth** — absorb `/cv/analytics` under the Growth name; charts re-skinned to the rule system (hand-rolled SVG approach survives — it's print-safe and already doc-aligned).
9. **Imports / onboarding / settings re-skin** — document grid, `ImportStep`/`ClaimRow`/`TrustRow`.
10. **Accessibility & mobile QA** — gold/green contrast on sheet white, table semantics, focus states, print regression on `/u`.
11. **Motion last** — the gold settle, nothing else.

### Decisions required from the owner before building

| # | Decision | Recommendation |
|---|---|---|
| D1 | Delete dark mode entirely (tokens, toggle, script)? | **Yes.** A doc-compliant dark theme is its own future design cycle; forced-light on `/u`/print already proves the product's nature. |
| D2 | Dissolve `CvSubNav` — Verify → per-row + Imports queue; Tags → contextual? | **Yes**, but it changes a surface shipped with sign-off on 2026-06-11, so it needs explicit re-approval. |
| D3 | Brand: ARCHIVO-caps "DEBATE CV" wordmark + gold-slash mark, lowercase dies? | **Yes** — lowercase + box mark is editorial-era residue. |
| D4 | Type trio: Archivo / Libre Franklin / Spline Sans Mono? | **Yes** — free, variable, records-pedigree, and not the template pairing. |
| D5 | Sample dataset: real tournament names (WUDC, Australs…) with a fictional persona and believable noise? | **Yes** — real events make the sample credible; the persona stays fictional. Owner should review the season arc for circuit realism. |

### Owner rulings (2026-06-11, recorded same session)

- **D1 — Approved.** Dark mode is deleted: tokens, `ThemeToggle`, theme-init script. One sheet-white theme.
- **D2 — Approved.** `CvSubNav` dissolves; top nav becomes Record/Growth/Imports/Settings, Share becomes a record action, Verify → per-row affordances + Imports queue, Tags → contextual prompts. (Supersedes the 2026-06-11 sub-nav sign-off in `docs/HANDOFF.md`.)
- **D3 — Approved.** New brand: ARCHIVO Expanded caps "DEBATE CV" + gold break-slash / ruled-tab glyph; lowercase wordmark and box mark die.
- **D4 — Approved.** Type trio: Archivo / Libre Franklin / Spline Sans Mono. Inter, Space Grotesk, IBM Plex Mono, and the `font-serif`→grotesk alias all die.
- **D5 — Proceeding on recommendation** (not separately ruled): real tournament names + fictional persona + believable noise in the sample dataset; owner reviews the season arc for circuit realism when chunk 4 ships.

All five chunk-blocking decisions are resolved; the build can proceed in the Phase 3 order. `docs/DESIGN_INSTRUCTIONS.md` remains the constitution; this teardown is its execution spec.
