# Debate CV Design Instructions

This file is the standing product/design brief for Debate CV. Treat it as the source of truth before making visual, IA, or copy decisions.

## 1. Primary audience

Design first for university debaters, roughly ages 18–30, using a mix of mobile and laptop. Many are current university students; some are working and still active in debate. Their first job is not to admire the site. Their first job is to understand whether Debate CV can show them a credible record of what they have done.

The primary first-session win is:

> See a sample debate CV, understand the value, and believe signing in is worth the trust cost.

Secondary audiences exist — other debaters, debate societies, tournament institutions, selectors — but the owner of the CV is the first user.

## 2. Product promise

Debate CV should promise a verified, shareable, analyzable record of a debater's competitive history.

The core promise is:

> Know what you have done, verify it easily, share it cleanly, see your growth, and learn factual quirks about your performance.

Never lead with implementation details. Gmail, Tabbycat, parsing, queues, OAuth, and private URLs are plumbing. They are important for trust, but they are not the emotional hook.

## 3. Required emotional register

The product should feel:

- Competitive, but not toxic.
- Calm, but not sleepy.
- Academic, but not decorative.
- Utilitarian, but not generic.
- Source-backed, but not institutional cosplay.
- Serious enough for public proof, but still clearly built for debaters.

The product should never feel:

- Like an AI gimmick.
- Like a toy project.
- Like an elite-only gate.
- Like generic SaaS.
- Like a hacker dashboard.
- Like a literary/editorial magazine.
- Like an official tournament institution unless it actually becomes one.

## 4. Positioning rules

### Lead with the artifact

The first screen must sell the output, not the importer.

Good:

- "Your debate history, readable and ready to share."
- "Build a private, source-backed debate CV."
- "See tournaments, breaks, speaker scores, and growth over time."

Bad:

- "Compiled from your inbox."
- "By Google's Gmail API."
- "We scan your Gmail for private URLs."
- "Three steps from sign-in to ingestion."

### Consent to value, not to a provider

The main CTA should name the user outcome. Prefer "Build my debate CV" over "Sign in with Google." Google sign-in can appear as supporting trust text.

### Make trust concrete

The product asks for a sensitive permission. Privacy copy must be explicit, operational, and scannable:

- What scope is requested.
- What is searched.
- What is stored.
- What is not stored.
- Who can see the CV.
- How to disconnect/delete.
- Whether tokens are encrypted.

Never make aspirational privacy claims. If a claim is not technically true in production, do not ship it in copy.

## 5. Information architecture

### Signed-out IA

Signed-out users are evaluating value and trust. Navigation should focus on:

1. Sample CV
2. How it works
3. Privacy
4. Build my CV

Do not lead signed-out users into inaccessible app furniture such as Dashboard/My CV unless those pages provide meaningful public preview states.

### Signed-in IA

Signed-in users are managing a record. Navigation should be task-based.

Header: **Record · Statistics · Motions · Imports** (owner decision 2026-10-29). Settings, and Admin for allowlisted operators, live in the account menu at top right. There is no second navigation bar under the CV pages: each destination lives in one nav level, and four items fit a 320px phone strip.

Imports is a pipeline of stages: **Sources → In progress → Review → On record**. Review (`/dashboard?stage=review`) holds everything the user must answer before a row reaches the record: imports where we could not find their name, and (behind the discovery flag) the Found list of public-tab matches, which was `/cv/found` and now redirects there. The operator tools (Tags, Verify) are reached from the Admin page.

Avoid naming primary surfaces after implementation objects. "Imports" is better than "Dashboard" because it names the job. "Record" is better than "CV" in nav because it names what the page holds.

### First-run flow

The desired mental model is:

1. Preview the artifact.
2. Connect or import.
3. Claim identity.
4. Review found tournaments.
5. See the CV.
6. Share/export when ready.
7. Explore growth and quirks.

Implementation order may differ, but the UI should present this user story.

## 6. Visual system — "Ledger" (owner-directed, 2026-07)

The reference is a bank statement or a brokerage dashboard: the surface a person already trusts for numbers that are theirs. Structured, quiet, dense with figures, and completely unbothered about being pretty.

Four rules govern everything:

1. **The canvas is quiet and the data is loud.** Cool near-white (light) or graphite (dark) canvas, white / near-black surfaces, hairline rules. Nothing is tinted for decoration and nothing floats without a reason.
2. **Every figure is monospaced and tabular.** Columns of numbers must align optically down the page. This is the single strongest signal that a table is a real ledger and not a marketing card.
3. **Colour is a value judgement, never a mood.** Green = up / kept / verified. Red = down / lost. Gold = a standout competitive result (a break). Blue = analysis and projections. Amber = attention. A colour that is not making one of those claims does not ship.
4. **One accent.** Emerald carries brand, primary action, and "verified". A filled emerald control should be the only saturated block of colour on most screens.

### Color

- Statement canvas / graphite canvas.
- Ledger ink for primary text; a single muted grade below it.
- Hairline rules at low opacity — never a heavy border.
- Emerald for primary action, verification, and success.
- Break gold for standout competitive results.
- Score blue for analysis and charts.
- Amber/red only for warning and destructive states.
- Purple (`core-purple`, owner decision 2026-10-29) means one thing only: an adjudication-core role (CA, DCA, core). It is the single colour outside the value set above and appears nowhere else.
- Career charts (one stacked bar per year) use a grey "did not break" tier below an ink rule, a blue ramp for quarters-and-below / semis / finals, and break gold for champions. Every tier clears 3:1 against the surface in both themes.

### Typography

Three layers, no fourth:

- Sans (Inter) for interface and body copy.
- Display grotesk (Space Grotesk) for headings and the brand mark, at medium weight with tight tracking. Never semibold-and-shouty.
- Mono (IBM Plex Mono) for every numeral, score, rank, year, ID, and micro-label.

No serif voice and no decorative italics. Debate CV is a record system, not an editorial publication.

### Surfaces and structure

- Three surface tiers only: the sheet (`panel`), the well (`panel-inset`), the floating thing (`panel-raised`).
- Tables use the shared `.ledger` mechanics: uppercase mono headers, hairline row rules, no vertical rules, numeric columns right-aligned.
- Wide tables scroll inside their own container. The page body must never scroll sideways.
- Never leave a numeric cell blank — an em dash means "the source didn't publish this"; a blank cell reads as a bug.

### Spacing

Eight named steps on a 4px base, defined in `app/globals.css`: `hair` 4, `inline` 8, `tight` 12, `stack` 16, `panel` 24, `group` 32, `section` 48, `page` 64. New and rebuilt components use the names; half-steps (2px, 6px) are for optical fixes inside primitives only. Page widths: `max-w-prose` for reading text, `max-w-content` (1120px) for most pages, `max-w-wide` (1280px) for the record and statistics tables.

### Layout

Mobile-first. Assume a user may be checking the site on a phone between debate contexts.

Above the fold, users should understand:

1. What the product produces.
2. Why it matters.
3. What action to take.
4. Why the permission request is safe enough.
5. What the sample CV looks like.

Avoid long explanatory sections before proof. The product sample is not decoration; it is the sales argument.

### Icons (owner decision 2026-10-29)

- **Phosphor**, through `components/ui/icons.ts` only. Regular weight at 16px and below, Light (`weight="light"`) at 20px and above, Duotone only for large empty-state art.
- **Label first.** A debate idea (tournaments, breaks, rounds, motions, partners) always has its text label; the icon is decoration beside it. Icon-only controls are limited to universal glyphs (theme, notifications, close, copy, external link, more), each with an accessible name.
- **Debate marks** (`components/ui/DebateMarks.tsx`) cover what no library draws: Break (a knockout bracket), Champion (the bracket with a filled winner's dot), Major (◆), Speaker (a lectern), Core (the inner circle, in `core-purple`). They use Phosphor's 256 grid and stroke so the two sit together. Panel, partner and info-slide marks come with their pages.
- **No trophies or medals.** Results are data: a text label and, where it helps, a mark.

## 7. Component language

Prefer components that feel native to debate records:

- Record header
- Tournament row
- Source/verification badge
- Import queue step
- Claim/identity match row
- Growth strip
- Quirk card
- Share capsule
- Privacy/trust row
- Break/result marker

Generic cards and buttons are allowed only as foundation primitives. The dominant language should come from records, sources, scores, breaks, and share states.

## 8. Copy voice

Copy should be short, factual, and debater-literate. It should respect the user's time.

Use:

- "private record"
- "source-backed rows"
- "verified tournament links"
- "growth over time"
- "private until shared"
- "review ambiguous matches"

Avoid:

- AI hype
- grand literary phrasing
- fake institutional authority
- vague productivity language
- excessive OAuth/parser detail in hero copy
- elite-signaling language that implies only top debaters belong

## 9. Statistics and findings

Statistics must be factual and explainable. Do not imply AI interpretation unless the product truly uses it and can explain it.

Three hard rules, enforced in `lib/cv/speakerStats.ts`:

1. **Sample size travels with the number.** Every aggregate carries the count it was computed from, and the UI renders it. A 100% win rate over two rounds is not a statistic.
2. **No style inference.** A split reports rounds, win rate and mean score with a delta against the user's own baseline. The delta is arithmetic, not a personality claim.
3. **Every finding contains its number and clears a minimum sample**, and must be checkable against a table on the same page.

Good findings:

- "You finish stronger than you start: your last three prelims average 1.4 more than your first three." (7 tournaments)
- "CG is your weakest seat at 41%, against a 53% overall round win rate." (22 decided rounds)
- "Across your tournaments you finish in the top 8% of the speaker tab on average."

Bad findings:

- "You are becoming a strategic closer."
- "AI detected your debate style."
- "You are an elite performer."

### Field context is the honest measure

A raw speaker average is not comparable across circuits. Wherever a score is shown as evidence of level, show the placement against the field that was actually in the room next to it.

### Placement is a team fact (owner rule, 2026-10)

- **How high the user placed** — any "top N%", "best finish" or placement percentile — is the TEAM's prelim rank against the number of teams on the team tab. Never the speaker tab, and never a speaker rank compared with a team count.
- **How strong a break was** is the furthest outround reached (then a won final, then break seed). Never speaker rank.
- Speaker-tab figures (speaker average, speaker-tab rank, speaker-tab percentile) stay, but are always labelled "speaker tab" so they cannot be read as the user's placement.
- One definition for all of it: `lib/cv/teamPlacement.ts`.

## 10. Privacy and trust requirements

Privacy is a conversion requirement, not a footer obligation.

Every major entry point should make these facts discoverable:

- Gmail access is read-only.
- The importer searches for tournament links.
- Email bodies are not stored.
- The CV is private until shared/exported.
- Users can disconnect Gmail.
- Users can delete account data.
- Token encryption status is stated accurately.

If production behavior changes, update copy in the same PR.

## 11. What should die from the old direction

Do not preserve these patterns just because they already exist:

- Editorial labels such as "Vol.", "Editor's Note", and "Colophon" as primary UI language.
- Main CTAs that say only "Sign in with Google."
- Generic dashboard framing.
- Sample cards that are decorative but not useful.
- Color/token names that preserve old mental models without meaning.
- Overexplaining Gmail before proving the CV's value.

## 12. Implementation sequencing

When continuing the redesign, ship in this order:

1. Truth and privacy copy alignment.
2. Design tokens and primitives.
3. Landing page and sample CV.
4. Signed-in IA.
5. Import flow clarity.
6. CV record view.
7. Growth/quirks.
8. Share/export controls.
9. Accessibility and mobile QA.
10. Motion and polish only after structure is correct.

## 13. Review checklist

Before merging a UI change, ask:

- Does this help a university debater understand or manage their debate record?
- Can the user understand the value in under 60 seconds on mobile?
- Is the CV artifact visible before the mechanics dominate the page?
- Is privacy concrete and truthful?
- Does this feel like a verified debate record, not a generic SaaS app?
- Are growth claims factual and explainable?
- Does every color, label, and component earn its place?

If the answer is no, cut or redesign the element.
