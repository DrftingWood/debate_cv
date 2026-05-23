# debate cv — editorial redesign (sober voice)

**Date:** 2026-05-23
**Scope:** Landing (`/`) · `/cv` · `/u/<slug>`
**Direction:** Editorial (option B), sober voice (Atlantic / FT / TLS register).
**Status:** Design — awaiting implementation plan.

## Summary

Replace the current indigo-on-cool-gray "polished SaaS" presentation with a coherent editorial design language: warm cream paper, deep ink, a single oxblood accent, italic-Fraunces display headlines, hairline ink rules in place of shadows, and small-caps kickers above bylined section heads. The data, computations, and behaviour are unchanged on every redesigned surface. The personality flexes per surface — insider feel on landing, formal credibility on `/u/<slug>`, personal record on `/cv` — while sharing the same design tokens, type scale, and treatments.

Includes one small structural change: extract the global app header + footer into a `(app)` route group so they no longer leak into the public CV artifact at `/u/<slug>`. This is the architectural prerequisite for `/u/<slug>` to read as a standalone document rather than a tab in someone else's app.

## Goals

- Replace generic-SaaS visual identity with a distinctive, durable editorial language coherent across the three primary surfaces.
- Make the personality flex from "insider" (landing) → "personal" (`/cv`) → "formal" (`/u/<slug>`) using a single set of tokens and treatments.
- Strengthen the credentialing artifact at `/u/<slug>`: strip app chrome, add provenance footnotes ("Source: tournament tabs at calicotab.com · herokuapp.com"), and present the data with the typographic register of a record.
- Preserve every piece of data, every column, every computed metric, and every existing behavioural feature on each page — including the existing print stylesheet.
- Maintain accessibility (WCAG AA contrast, focus rings, semantic structure, mobile responsive variants).

## Non-goals

- No backend, data model, parser, or queue changes. `buildCvData`, `pickHeaderMetrics`, the Gmail extraction path, the ingest queue, Prisma schema — none of these are touched.
- No new features, fields, or surfaces. No dark mode in this pass.
- No restyle of dashboard, settings, onboarding, admin, privacy, terms, or `cv/verify` in this pass. These get a follow-on "apply the tokens" pass that mechanically inherits the new system without re-laying-out anything.
- No new dependencies. No new ORM, state lib, UI kit, or animation lib. We stay on Tailwind + the existing primitives in `components/ui/`.
- No change to copy semantics on `/` — every trust beat, legal claim, and how-it-works step survives verbatim where it carries weight. Only the *presentation* and *headline phrasing* of those beats changes.

## Audience

The site has three audiences that the personality must serve simultaneously:

1. **Signed-out debaters (landing).** Should feel "this is for me, made by someone who knows what BP/AP/EUDC is, not a Vercel template."
2. **The owner (`/cv`).** Should feel like a satisfying personal record — a thing you'd open just to look at, even when you're not preparing an application.
3. **Selection panels & adjudication committees (`/u/<slug>`).** Should read as a credible, scannable, printable record of accomplishment, with visible provenance and zero app chrome.

A single sober editorial language can serve all three. The flex happens through copy register and which treatments are loud (drop caps, pull quotes on landing only) versus quiet (sober masthead + tabular record on `/u/<slug>`).

## Design language

### Palette

The current indigo `primary` (`243 75% 59%`), all four gradient tokens (`gradient-hero`, `gradient-ink`, `gradient-accent`, `gradient-glass`), and `shadow-glow` are **retired**. The new tokens, defined in `app/globals.css` `:root`:

| token | role | value (HSL) | hex (approx) |
|---|---|---|---|
| `--paper` | page background | `38 32% 96%` | `#FAF6EC` |
| `--ink` | primary foreground | `220 14% 11%` | `#181A1F` |
| `--ink-soft` | byline / sub copy | `220 9% 40%` | `#5C636E` |
| `--rule` | hairlines (1px) | `220 14% 11% / 0.12` | — |
| `--oxblood` | single accent | `358 52% 32%` | `#7A2528` |
| `--oxblood-soft` | accent backgrounds (sparingly) | `358 52% 32% / 0.08` | — |
| `--card` | inset surfaces | `0 0% 100%` | `#FFFFFF` |

The existing semantic tokens (`success`, `warning`, `destructive`, `info`) **stay** in the token registry — admin / dashboard / settings still need them — but their usage on the three redesigned surfaces is removed in favour of small-caps text labels with oxblood underlines (see "Badges & semantic colour" below).

The Tailwind config (`tailwind.config.ts`) maps these new tokens into the `colors` block: `paper`, `ink`, `ink.soft`, `rule`, `oxblood`, `oxblood.soft`. The existing `primary` / `secondary` / `accent` / `muted` token names are kept and *re-bound*:

- `primary` → `oxblood` (the accent role)
- `foreground` → `ink`
- `background` → `paper`
- `muted-foreground` → `ink-soft`
- `border` → `rule`

This means components that already use `border-border`, `text-foreground`, `text-muted-foreground`, `bg-background`, etc., will inherit the new palette automatically. The dashboard / settings / onboarding pages get the colour shift for free, which is what we want for the follow-on pass.

### Typography

The three existing fonts are reused but re-cast:

- **Fraunces** is promoted from "occasional hero" to **primary display font**. Italic by default on hero headlines — this single decision carries the most editorial signal.
- **Inter** remains the body sans where serif would be too literary (UI chrome, settings, dashboard, table cells where stats live).
- **Plus Jakarta Sans** is demoted to **UI chrome only** — nav links, button labels, badges, kickers (small caps).

Font weight rules:
- Fraunces display: 400 (regular italic) or 500 (medium italic) for hero. Never 700 — bold italic Fraunces looks shouty.
- Plus Jakarta kickers: 600.
- Inter body / table cells: 400, 500 for emphasis.

### Type scale

Replaces the existing `caption`/`body`/`h1`–`h3`/`display` scale in `tailwind.config.ts`:

| token | spec | use |
|---|---|---|
| `kicker` | 10.5px, Plus Jakarta 600, uppercase, tracking 0.2em, oxblood | section headers (`A CAREER IN PARLIAMENTARY DEBATE`) |
| `byline` | 11.5px, Inter 500, ink-soft, often above a 1px rule | masthead sub-line (`Vol. III · Spring 2026 · IGNOU`) |
| `caption` | 12.5px, Inter 400, ink-soft | small annotations, table footnotes |
| `body` | 15px, Inter, leading 1.55 | UI text (existing) |
| `body-serif` | 16.5px, Fraunces 400, leading 1.55 | hero lede, narrative passages |
| `h3` | 22px, Fraunces 500, italic available | section heads inside surfaces |
| `h2` | 36px, Fraunces 500, italic available, tracking -0.015em | major section heads |
| `display` | 64px desktop / 44px mobile, Fraunces 500 italic, tracking -0.025em, leading 1.02 | landing hero, /cv masthead name, /u/<slug> masthead name |

Tabular numerals (`font-variant-numeric: tabular-nums`) are applied system-wide via a new `.num` utility *and* the existing `font-mono` cells get tabular numerals through the same opt-in rather than monospace where possible.

### Treatments

- **Hairline ink rules** wherever a drop shadow used to communicate elevation. Replace `shadow-xs / sm / md / lg / xl` usage on surfaces with `border-rule` and color contrast. The shadow tokens themselves stay (they're still used in dropdowns, popovers, the More menu) but at lower intensity.
- **Pull-quote rule**: 2px vertical oxblood bar + italic Fraunces body. Used on landing only.
- **Drop caps**: `.dropcap` utility — oxblood, 40px, float left, 0.9 line-height. Used on the landing lede and (optionally) the `/u/<slug>` intro if a future iteration adds an editorial intro paragraph.
- **Buttons**: three variants only — `filled-ink` (primary action), `outlined-ink` (secondary), `ghost` (tertiary). All use `Inter 500`, 9px corner radius (slightly tighter than the current 10px), no `shadow-glow`, no gradient. Existing `Button.tsx` variants are remapped — see component inventory.
- **Badges & semantic colour**: on the three redesigned surfaces, replace `success`/`warning`/`info` pill badges with small-caps text labels:
  - "Broken" / "—" instead of green pill / grey pill.
  - "Reported" gets an oxblood underline only (no warning-yellow background).
  - The `Badge` component itself isn't deleted — admin / dashboard / settings still use it. We add a new `quiet` variant for the editorial surfaces that renders as a small-caps text label rather than a pill.
- **Print stylesheet** in `app/globals.css` `@media print` block is **kept verbatim**. The existing rules (hide chrome via `data-print-hide="true"`, white background, force-open `<details>`, drop shadows) already match the editorial direction more closely than they matched the indigo SaaS look. This is a free win.

### Accessibility verification

- `oxblood #7A2528` on `paper #FAF6EC`: contrast ratio ≈ 9.3:1 (AAA for normal text). ✓
- `ink #181A1F` on `paper`: ≈ 16:1 (well over AAA). ✓
- `ink-soft #5C636E` on `paper`: ≈ 5.5:1 (AA for normal, AAA for large text). ✓
- `oxblood` on `card #FFFFFF`: ≈ 10:1 (AAA). ✓
- `:focus-visible` ring colour shifts from `--ring` indigo to oxblood. Outline width / offset stays.
- Skip link contrast stays at ink-on-paper / paper-on-ink — already passing.

These will be re-verified during implementation with axe-core or a contrast checker against the actual rendered values.

## Surfaces

### Landing — `app/page.tsx`

The current six sections (Hero, HowItWorks, TrustStrip, TrustPanel, Faq, FooterCta) are kept as a skeleton, restyled and renamed to read as parts of a feature article.

#### I · Masthead (in-page, on the landing route)

The global sticky header (`My CV · Dashboard · Settings`) is hidden on the landing route via the route-group split (see "Structural change" below) — signed-out visitors don't need it. In its place, the landing page renders its own minimal masthead:

- A custom in-page wordmark (not the global `BrandMark` component): "debate cv" in Fraunces italic. The landing masthead is bespoke; the global `(app)` header isn't rendered on this route (signed-out users don't need it).
- Second line: small caps, tracking 0.2em — `A PERSONAL RECORD OF THE PARLIAMENTARY KIND`.
- Single 1px ink rule edge-to-edge of the inner `max-w-6xl` container. This rule is the visual signature for the whole site.
- The global `BrandMark` component is separately restyled to Fraunces italic (see component inventory) — that's what appears in the `(app)` header on `/cv`, `/dashboard`, etc. The landing's masthead doesn't use it.

#### II · Feature (replaces `<Hero />`)

```
A CAREER IN PARLIAMENTARY DEBATE

   Your debate cv,
   compiled from your inbox.

   Vol. I  ·  Spring 2026  ·  by Google's Gmail API
   ─────────────────────────────────────────────────

   S ign in with Google. We scan your inbox for the
     Tabbycat private URLs you were already sent,
   fetch each tournament's team, speaker, and break
   tabs, and stitch your personal history into one
   page. No essays. No drag-and-drop. Just a CV.

   [ Sign in with Google → ]    [ Admin sign-in ]
   read-only · private · delete any time
```

Changes from today:

- Kicker (oxblood, small caps) replaces the `Sparkles · Built for debaters` pill.
- Headline becomes italic Fraunces display, two lines, ~60–72px. "compiled from your inbox" carries the italic emphasis.
- Byline rule replaces the underline-on-hover "How it works" link (which moves into the lede paragraph as an inline link).
- Drop cap on the lede (oxblood, 40px).
- Trust microcopy collapses into one inline line under the CTA.
- The right-column glass CV preview is **replaced** with a typeset paper CV excerpt — cream background, hairline rules, real-looking tournament rows (Year · Tournament · Result columns, tabular numerals, italic Fraunces tournament name, sans subline). The site shows what it produces, in the style of what it produces.

#### III · Editor's Note (replaces `<HowItWorks />`)

- Section kicker: `EDITOR'S NOTE · ON METHOD`.
- The three existing steps (`Connect Gmail`, `We find your Tabbycat links`, `Your CV appears`) become three short editorial blocks: oxblood Roman numeral (`I.` / `II.` / `III.`), italic Fraunces sub-heading, two to three lines of serif body.
- Card hover lift (`hover:-translate-y-0.5 hover:shadow-md`) is removed. Blocks sit on paper, separated by hairline rules.
- The inline `<code>` chips for the URL patterns get a sober restyle: `bg-oxblood-soft text-ink` with a thin oxblood underline, no muted-grey background.

#### IV · Colophon (replaces `<TrustStrip />` + `<TrustPanel />`)

Today's two trust sections say overlapping things in two layouts (a pill-strip and a 3-column panel). They merge into one.

- Section kicker: `COLOPHON · PROCESS & POLICY`.
- Three columns: `Scope` (read-only Gmail), `Storage` (AES-256, no emails), `Revocation` (Settings → Disconnect, delete any time). Each is a small kicker + italic Fraunces title + 1–2 lines of body.
- The pill-strip is removed entirely. The trust claims it carried survive in this section.

#### V · Letters (replaces `<Faq />`)

- Renamed section kicker: `LETTERS · FREQUENTLY ASKED`.
- Native `<details>` accordion structure stays (it's good UX, prints well, works without JS).
- Serif questions (Fraunces 17px regular). Hairline ink rule between items (no card border).
- Chevron tinted oxblood; rotates on `[open]` as today.
- Answer body in Inter 14.5px (sans, not serif — answers carry factual content; serif reserved for narrative).

#### VI · Subscribe (replaces `<FooterCta />`)

The `gradient-ink` dark block is **removed** — it's the most out-of-character element on the page today.

- Replaced by a quiet end-of-article block.
- Single horizontal hairline rule.
- Kicker: `SUBSCRIBE`.
- One-line italic Fraunces invitation: *"Sign in, run the scan, watch your history compile."*
- The Sign-in button restyled `filled-ink`. No glow.

#### Behavior preserved on landing

- `if (session?.user) redirect('/cv')` server-side check at the top of the route: identical.
- `SignInButton` and `AdminSignInButton` server actions: identical (NextAuth `signIn('google', { redirectTo: ... })`). Only the visual chrome changes.
- All accessibility scaffolding (skip link, focus rings, semantic landmarks): preserved.
- All Lucide icons: kept, recolored to ink (not indigo).

### `/cv` — `app/cv/page.tsx`

Every piece of data, every column, every conditional rendering preserved. Only the surface changes.

#### I · Masthead (replaces the gradient `<header>` profile block)

```
DEBATE CV — VOL. III · COMPILED 23 MAY 2026

   Abhishek Acharya.
   ─────────────────────────────────────────
   IGNOU  ·  acharya.abhishek04@gmail.com

   Tournaments    Breaks    Best spkr rank    Best avg
        23           9            #3             74.2
```

- Kicker: `DEBATE CV — VOL. <years-active-roman> · COMPILED <today>`. The Volume number derives from `highlights.activeYears` as `to - from + 1`, rendered in Roman numerals. Falls back to `VOL. I` when `activeYears` is null (no tournaments yet — should not normally render since `claimedCount === 0` triggers an onboarding redirect, but the masthead handles it safely). Capped at `VOL. IX`; spans of 10+ years render as `VOL. IX+` rather than `X`/`XX` which read awkwardly. The "COMPILED" date is server-rendered from `new Date()` (`force-dynamic` is already set, so this stays fresh).
- Display-size italic Fraunces name (60–72px desktop).
- Hairline ink rule under the name.
- Affiliation row (Inter, ink-soft, 11.5px): `<school> · <email>` joined with em-space middots. School derives from existing data; falls back gracefully if absent.
- **Stat strip** replaces the four `MetricTile` cards: same data, same `pickHeaderMetrics()` selection logic, but rendered as one tabular row — label in kicker style on top, tabular-numeral ink number (24px Fraunces, regular weight, not italic) below. No card borders, no `primary-soft/70` accent fill, no per-tile elevation.
- The existing `pickHeaderMetrics()` logic in `app/cv/page.tsx` is reused verbatim. Only the renderer (`MetricTile` → new `StatColumn`) changes.

#### II · In Brief (replaces badge row + "More" dropdown)

Today the page renders `<Badge variant="outline">`, `<Badge variant="success">`, `<Badge variant="info">` for tournaments / as-speaker / as-judge, plus `<CvShareButton>`, `<DownloadPdfButton>`, and a `<details>` "More" dropdown with `Verify fields` and `Export CSV`.

- Kicker: `IN BRIEF`.
- An italic Fraunces summary sentence generated from the same data: *"Twenty-three tournaments since 2018. Nine breaks. Speaker in fifteen, chair in eight."* Numbers spelled out under 20, numeric thereafter. (A small helper `toBriefSentence(summary)` lives in the page file.)
- Action affordances reposition to the **right side of the masthead rule** (above the In Brief sentence) — `Share`, `Print to PDF`, and a single "More ↓" disclosure containing `Verify fields` and `Export CSV`. Same actions, same routes, less visual noise. Buttons restyled `outlined-ink` size sm.

#### III · Career notes (replaces `<CvHighlights>` rendering)

`CvHighlights` already picks 3–4 standout achievements from the data. The selection logic isn't touched.

- Section kicker: `CAREER NOTES · HIGHLIGHTS`.
- Each highlight becomes a short note: oxblood kicker (`BEST FORM` / `DEEPEST BREAK` / `MOST CHAIRED`), italic Fraunces title (the achievement), Inter sub-line (context — "WUDC 2024 · Vietnam"). Sit in a 2- or 3-column flow separated by hairline rules. No card borders.
- The underlying `components/CvHighlights.tsx` may either be restyled in place or have its rendering inlined into `app/cv/page.tsx` if it makes the visual easier — both are acceptable; the implementation plan will pick.

#### IV · The Record (replaces the two `<CollapsibleSection>` blocks)

These two `<details>` sections are the heart of the page. Behavior preserved (default open, mobile stacked variant, per-row speaker score expansion, report buttons, link to tab page); chrome changes.

- Section kickers (Roman + small caps): `I · SPEAKING — <N> TOURNAMENTS` / `II · JUDGING — <N> TOURNAMENTS`.
- Drop the `rounded-card border border-border bg-card/60 shadow-xs` wrapper and the `bg-muted/30` header strip.
- Table head: 10.5px small-caps Inter, ink-soft, tracking 0.16em.
- Body rows: 13.5px Inter (current), with tabular numerals applied to every numeric column via the `.num` utility. The existing `font-mono` class on year / teams / rank cells is replaced with `.num` (proportional font with tabular figures, not monospace).
- Row dividers: hairline `rule` instead of `divide-border`. No zebra stripes.
- Hover: oxblood underline on the tournament name only; no row background highlight.
- Tournament name link: Fraunces italic 14.5px. External-link colour shifts to oxblood on hover.
- Per-round speaker-score expansion (the inner `<details>` under each speaker row): keeps current behaviour exactly; chevron tints oxblood; inner mini-table uses the same record-style.
- Mobile stacked-card variant (`md:hidden ul`): structure unchanged. Card border + shadow removed; becomes a serif heading + hairline rule + `<dl>` grid on paper. Tournament name Fraunces italic, year tabular far right.
- `BrokeBadge` and the "Reported" `Badge` on each row: replaced with small-caps text labels. `BROKEN` (no styling change beyond the small-caps) vs `—`. `REPORTED` gets a thin oxblood underline.

#### Behavior preserved on `/cv`

- All redirects: `if (!session?.user?.id) redirect('/')`, `if (claimedCount === 0) redirect('/onboarding')` — identical.
- `buildCvData` call: identical.
- `pendingCount` query: identical.
- `<AutoScanOnVisit />` mount: identical.
- `<CvNeedsAttentionBanners pendingCount={pendingCount} unmatchedCount={unmatched.length} />`: kept above the masthead, restyled as a sober ink-rule banner with kicker `NEEDS ATTENTION`. Same conditional behaviour.
- `<CvShareButton>` and `<DownloadPdfButton>`: kept, restyled. Both still carry `data-print-hide` semantics (the print stylesheet already targets these via `header[class*="sticky"]` and `data-print-hide="true"` — that pattern is preserved).
- `EmptyState` when `totalTournaments === 0`: kept verbatim with editorial-restyled props.
- The `cv/verify` link via `More ↓`: preserved.

### `/u/<slug>` — `app/u/[slug]/page.tsx` + `app/u/[slug]/layout.tsx`

The credentialing artifact. The page selection panels actually open. Sober editorial pays its biggest dividend here.

#### Structural change: route-group `(app)` split

The current `app/layout.tsx` renders a sticky header with `My CV · Dashboard · Settings · NotificationBell` on **every** route, including `/u/<slug>`. The existing layout comment in `app/u/[slug]/layout.tsx` acknowledges this leak and rationalizes it; we fix it instead.

- Create `app/(app)/layout.tsx` containing the sticky header (BrandMark, NavLink trio, NotificationBell) and the global `<Footer>`. This file inherits the auth check from `app/layout.tsx` indirectly (it can call `auth()` itself, or simpler: pass the session down via a Server Component import).
- Move the following routes under `app/(app)/`:
  - `app/(app)/page.tsx` (landing)
  - `app/(app)/cv/`
  - `app/(app)/dashboard/`
  - `app/(app)/settings/`
  - `app/(app)/onboarding/`
  - `app/(app)/admin/`
  - `app/(app)/privacy/`
  - `app/(app)/terms/`
- `app/layout.tsx` shrinks to root concerns only: `<html>`, `<body>`, font CSS variables, `<ToastProvider>`, the skip-link, and the `<main>` wrapper. No header, no footer.
- `app/u/[slug]/` stays where it is — outside the group — inheriting only the root layout. Its own `app/u/[slug]/layout.tsx` provides the minimal public chrome (paper background, public footer).
- `app/api/` is unaffected — API routes don't share UI layouts.

Filesystem-level changes only; the `@/*` path alias is rooted at the repo, so imports inside the moved files continue to resolve. No code changes inside the relocated files beyond what the editorial pass requires for the redesigned surfaces themselves.

The signed-in landing redirect (`if (session?.user) redirect('/cv')` at the top of `app/(app)/page.tsx`) survives the move.

#### I · Masthead (formal mode)

```
DEBATE CV — PUBLIC RECORD · COMPILED 23 MAY 2026

   Abhishek Acharya.
   ─────────────────────────────────────────
   THIRTEEN TOURNAMENTS · VERIFIED VIA PRIVATE URLS

                                       [ Print to PDF ]
```

- Kicker (oxblood, small caps): `DEBATE CV — PUBLIC RECORD · COMPILED <today>`. The "COMPILED" date renders fresh per request (`force-dynamic` is already set).
- Display-size italic Fraunces name — slightly *larger* than `/cv` (72–80px desktop) to match formal mode.
- Hairline ink rule.
- The current `<Badge variant="success">X ingested via private URLs</Badge>` (which does critical credibility work) is preserved semantically and converted to a sober annotation under the rule, formatted as small caps: `<COUNT spelled out> TOURNAMENTS · VERIFIED VIA PRIVATE URLS`. Inter, ink-soft, tracking 0.16em.
- Avatar:
  - If `publicAvatarEnabled && user.image`: render the photo at 80×80, framed by a 1px ink rule. The current `rounded-full` becomes a 4px corner radius — "portrait plate on a journal page" rather than chat avatar. (If `rounded-full` is preferred for legibility on mobile, accept it — only the gradient backdrop is non-negotiable.)
  - Else: paper monogram — Fraunces italic initials inside an 80×80 ruled square. No gradient, no white-on-purple, no `bg-gradient-accent`.
- `DownloadPdfButton`: restyled `outlined-ink` size sm; parked at the right of the masthead rule with `data-print-hide="true"` preserved.

#### II · Career notes

Same `<CvHighlights>` content as `/cv`, same editorial restyle. No public-vs-owner variation needed — highlights are already curated to be share-safe (and the owner controls visibility via Settings).

#### III · The Record — Speaking + Judging

The narrower public column set is correct and stays:

- Speaking: Tournament · Year · Format · Team · Team rank · Speaker rank · Avg score · Outround.
- Judging: Tournament · Year · Format · Prelims chaired · Prelims judged · Last outround chaired · Last outround judged.

What changes:

- Section kickers: `I · SPEAKING — <N> TOURNAMENTS`, `II · JUDGING — <N> TOURNAMENTS` (Roman numerals + small caps, oxblood).
- Drop the `rounded-card border border-border bg-card` wrapper. Table sits directly on paper with a 1px ink rule above the header row.
- Header row: 10.5px small caps Inter, ink-soft, tracking 0.16em.
- Tabular numerals on every numeric column.
- Tournament names: Fraunces italic 14.5px, **external link to the Tabbycat tab page preserved** (`target="_blank" rel="noopener noreferrer"`) — this is the page's most important credibility feature: a panel can click any row to verify against the source.
- A sober credit line *beneath* each table: `Source: tournament tabs at calicotab.com · herokuapp.com.` Inter italic 11px, ink-soft. The "footnote" telling a panel exactly where the data comes from.
- Row dividers: hairlines. No zebra striping. No row hover background highlight (a public viewer doesn't need hover affordance).

#### IV · Colophon (replaces public footer in `app/u/[slug]/layout.tsx`)

Current footer is `<BrandMark> · Built on debate cv. Build your own →`. Editorial pass:

- Hairline rule above.
- Left side, italic Fraunces caption: `— Compiled by debate cv.`
- Right side, small `outlined-ink` CTA: `Build your own →`. Subtle on the artifact, useful for word-of-mouth.
- No avatar, no notifications bell, no app nav — those live in the `(app)` layout that this route doesn't inherit.

#### Behavior preserved on `/u/<slug>`

- `generateMetadata` (slug → user lookup → 404 metadata if disabled): identical.
- `notFound()` for missing or `publicCvEnabled: false`: identical.
- `robots: { index: false, follow: false, nocache: true }`: unchanged.
- `buildCvData(user.id)` call and `totalIngestedTournaments` query: identical.
- `publicAvatarEnabled` gating: preserved.
- `data-print-hide="true"` on `DownloadPdfButton`: preserved.
- Existing print stylesheet: preserved and benefits from the editorial palette (cream → white in print, ink stays).

## Component & file inventory

A complete list of files this design pass touches. Implementation plan will sequence these into atomic commits.

### Tokens & global (foundation)

- `app/globals.css` — replace `:root` CSS variables (palette, gradients, shadows-on-surfaces); update component utilities (`.surface-card`, `.surface-elevated` retire; `.glass-card`, `.hero-texture` retire); add `.dropcap`, `.num`, `.kicker`, `.byline`, `.pull-quote`. Print stylesheet preserved verbatim.
- `tailwind.config.ts` — update `colors` (re-bind primary→oxblood, foreground→ink, background→paper, border→rule; add `oxblood`, `oxblood.soft`, `paper`, `ink`, `ink.soft`, `rule`); update `fontSize` scale (add `kicker`, `byline`, `body-serif`; adjust `display` to 64px); retire `backgroundImage` gradients except where used by surfaces we don't touch this pass (re-evaluate during implementation); retire `boxShadow.glow`; `transitionTimingFunction.soft` stays.
- `app/layout.tsx` — root only: `<html>`, `<body>`, fonts, ToastProvider, skip-link, `<main>`. Header & footer removed (move to `(app)` group). `metadataBase` and global metadata unchanged.

### Layouts (the structural move)

- `app/(app)/layout.tsx` — **new file**. Holds the sticky header (BrandMark, NavLink trio, NotificationBell) and the global `<Footer>`. Calls `auth()` to gate `NotificationBell` visibility.
- `app/u/[slug]/layout.tsx` — restyled: paper background, restyled colophon footer (see "/u/<slug> · IV · Colophon"). No header.

### Pages (route moves + redesigns)

- `app/page.tsx` → `app/(app)/page.tsx` — moved + redesigned (six landing sections per "Landing" above).
- `app/cv/page.tsx` → `app/(app)/cv/page.tsx` — moved + redesigned (masthead, In Brief, Career notes, The Record).
- `app/cv/verify/page.tsx` → `app/(app)/cv/verify/page.tsx` — moved; no visual redesign this pass (token shift inherited).
- `app/dashboard/page.tsx` → `app/(app)/dashboard/page.tsx` — moved; no visual redesign this pass (token shift inherited).
- `app/settings/**` → `app/(app)/settings/**` — moved; no visual redesign this pass (token shift inherited). `settings/layout.tsx` continues to provide the settings sub-nav within the `(app)` shell.
- `app/onboarding/page.tsx` → `app/(app)/onboarding/page.tsx` — moved; no visual redesign this pass.
- `app/admin/page.tsx` → `app/(app)/admin/page.tsx` — moved; no visual redesign this pass.
- `app/privacy/page.tsx`, `app/terms/page.tsx` → `app/(app)/privacy/`, `app/(app)/terms/` — moved; no visual redesign this pass.
- `app/u/[slug]/page.tsx` — stays in place; redesigned (masthead, Career notes, The Record, colophon).
- `app/api/**` — untouched.

### Components (shared)

- `components/BrandMark.tsx` — restyle: Fraunces italic wordmark (replaces Plus Jakarta). One-line change in component output.
- `components/Footer.tsx` — restyle as paper colophon: hairline rule, ink-soft caption, single inline `Build your own →` link. Used by the `(app)` group layout.
- `components/NavLink.tsx` — restyle: ink active state with oxblood underline, ink-soft inactive. Text in Plus Jakarta 500.
- `components/ui/Button.tsx` — variants reduced/remapped:
  - `primary` → `filled-ink` (ink bg, paper fg).
  - `outline` → `outlined-ink` (paper bg, ink border, ink fg).
  - existing `ghost` survives, restyled.
  - `shadow-glow` removed from primary class.
  - destructive variant preserved (settings → delete account uses it).
- `components/ui/Badge.tsx` — add `quiet` variant (small-caps text label, optional oxblood underline). Existing `outline`, `success`, `warning`, `info`, `neutral` variants kept for dashboard / settings / admin. The redesigned surfaces use `quiet`.
- `components/ui/Card.tsx` — variants: existing `Card` becomes paper-on-paper with hairline border (drops shadow). `Card.shadow-elevated` variant retained for popovers / dropdowns only.
- `components/ui/EmptyState.tsx` — restyle: kicker + italic Fraunces title + Inter body, paper background, no card border.
- `components/ui/StatusPill.tsx` — keep behaviour, restyle as small-caps text label with optional oxblood dot prefix.
- `components/ui/Toast.tsx`, `components/ui/Skeleton.tsx`, `components/ui/Spinner.tsx` — token shift only (inherit new palette via existing CSS-var bindings).
- `components/CvHighlights.tsx` — restyled per "Career notes" above (kicker + italic title + sub).
- `components/CvNeedsAttentionBanners.tsx` — restyled as sober ink-rule banner with `NEEDS ATTENTION` kicker.
- `components/CvShareButton.tsx` — restyled (outlined-ink sm, no glow).
- `components/DownloadPdfButton.tsx` — restyled (outlined-ink sm).
- `components/NotificationBell.tsx` — token shift only; bell icon stays.
- `components/SignInOut.tsx` — token shift only; button uses new variants.

### Components NOT touched this pass (token shift inherited)

`AccountActions`, `AdminActions`, `AutoScanOnVisit`, `DashboardActions`, `IdentityManager`, `OnboardingFlow`, `ParticipantSearch`, `ReingestButton`, `RetryFailedButton`, `SettingsSideNav`, `SharingManager`, `UnmatchedRowExpand`, `VerifyMineOnlyToggle`, `CvRowReportButton` — kept as-is; pick up new colours and typography via the token re-binding, no per-component restyle this pass.

## Verification

How we'll know the design landed:

- **Visual diff on each redesigned surface.** Before/after screenshots at desktop (1280) and mobile (390) widths for `/`, `/cv` (signed in, multi-tournament), `/cv` (empty state), `/u/<slug>` (with avatar enabled), `/u/<slug>` (initials fallback).
- **Print preview** for `/cv` and `/u/<slug>`. The existing print stylesheet should produce a clean B&W artifact; we verify nothing is regressed by the token changes.
- **Lighthouse + axe-core** on each redesigned surface. Contrast must remain ≥ 4.5:1 for normal text everywhere; focus rings visible; semantic landmarks intact.
- **Existing tests pass.** No data-shape, behaviour, or API change is intended, so the existing vitest suite (parser, queue, crypto, API harness) is unaffected. Type-check (`npm run typecheck`) and lint (`npm run lint`) must remain clean.
- **Manual UAT** of the three surfaces signed-in as the owner, signed-out on landing, and signed-out at `/u/<slug>` of a known public CV.

## Out of scope (future passes)

These are intentionally **not** included in this design pass:

- Restyle of `dashboard`, `settings/*`, `onboarding`, `admin`, `privacy`, `terms`, `cv/verify`. They get the token shift automatically; layout-level editorial redesign is a follow-on.
- Dark mode (light-on-ink editorial variant). The current system has a `prefers-color-scheme: dark` theme-color but no dark CSS. Adding one is a separate pass.
- New marketing pages, blog, or release-notes surfaces.
- OG image redesign (current `metadataBase` social card stays; an editorial OG can be a follow-on).
- Animations beyond the existing `fade-up` / `fade-in` / `shimmer`. We don't add new motion in this pass.
- Onboarding wizard editorial restyle. The wizard's UX flow is more important to get right than its surface; that's a dedicated pass.
- Brand-name evolution (e.g., adding a "Vol." suffix to the wordmark globally). Wordmark restyle is in scope; renaming or sub-branding is not.

## Risks & mitigations

- **Risk: route-group refactor breaks existing imports or layout inheritance.** Mitigation: move one route at a time, verify dev server + signed-in flow after each move. The `@/*` alias is repo-rooted so import paths inside the moved files stay valid.
- **Risk: dashboard / settings / admin pages look broken under the new tokens before they get their dedicated pass.** Mitigation: token re-binding (`primary` → oxblood, `border` → rule, etc.) is chosen specifically so existing utility-class usage keeps working with sensible defaults. Worst case: the dashboard looks paper-and-ink-y for a release before its follow-on pass, which is acceptable.
- **Risk: removing the four gradient tokens breaks pages we don't expect.** Mitigation: grep for `gradient-hero`, `gradient-ink`, `gradient-accent`, `gradient-glass` before removal; verify no orphan usage.
- **Risk: the `success`/`warning` semantic badges, removed from /cv and /u/<slug>, are still expected by some logic we don't touch.** Mitigation: `Badge` component keeps those variants; only the *redesigned* surfaces stop using them. Dashboard ingest-status, admin actions, and settings continue using the semantic palette.
- **Risk: the volume-roman ("VOL. III") feels gimmicky to some users.** Mitigation: it's small text in the kicker; if it doesn't land, dropping it is a one-line change. Mark as an "iteration candidate" during UAT.

## Open questions (validated during implementation, not blocking spec approval)

- Whether `app/(app)/layout.tsx` should call `auth()` itself or accept a session prop from a parent server component. Both work; pick what reads cleanly when writing the implementation.
- Exact contrast value of `ink-soft` against `card` (`#FFFFFF`) — verify ≥ 4.5:1 with a contrast checker once implemented; nudge ink-soft darker if needed.
- Whether the `cv/verify` page (still a deep utility surface) should be moved out of `cv/` and into a sibling top-level route during the move. Out of scope for this pass; flagged.
