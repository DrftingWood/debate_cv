# Editorial Redesign — UI Review

**Audited:** 2026-05-24
**Baseline:** `docs/superpowers/specs/2026-05-23-editorial-redesign-design.md` (treated as UI-SPEC)
**Screenshots:** not captured (no dev server; code-only audit per orchestrator config)
**HEAD audited:** `181acde feat(public-cv): editorial colophon footer + paper-on-paper layout`

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Editorial voice landed end-to-end; one CTA label drifts from spec ("Download PDF" vs spec's "Print to PDF"); affiliation row hard-codes "Auto-compiled from Gmail" instead of spec's `<school>` |
| 2. Visuals | 3/4 | Hairline rules, drop cap, italic-Fraunces masthead, paper CV excerpt all present; favicon / OG image still ship the retired indigo `#4338CA` SaaS brand to the outside world |
| 3. Color | 3/4 | Oxblood appears 64x across 23 files but largely concentrated on accents (links, kickers, "Reported" underline); cv/verify retains literal warning-yellow blocks; `bg-primary-soft/30` highlight in NotificationBell is now an oxblood haze on hover surfaces |
| 4. Typography | 2/4 | The Tailwind `text-kicker / byline / body-serif / h2 / h3 / display` scale is defined in `tailwind.config.ts` but the three redesigned surfaces use 47 raw arbitrary `text-[NNpx]` declarations instead of the named tokens. Inconsistent and brittle. |
| 5. Spacing | 3/4 | Vertical rhythm reads well (`space-y-10`/`space-y-24` blocks, hairline-separated rows); no out-of-scale arbitrary values found in the three audited surfaces; small tic: `gap-1.5` on the In Brief action cluster is a one-off |
| 6. Experience Design | 3/4 | All behaviour-preserved guarantees from spec honoured (auth redirects, force-dynamic, `data-print-hide`, NeedsAttentionBanners polling); avatar lacks aria-label on `/u/<slug>`; "More" action affordance is a native `<details>` with no keyboard-discoverable affordance beyond the disclosure triangle (no `aria-haspopup`, no Esc-to-close) |

**Overall: 17/24**

---

## Top 3 Priority Fixes

1. **Replace 47 arbitrary `text-[NNpx]` declarations with the new editorial token scale.** The whole point of registering `text-kicker / byline / body-serif / h3 / h2 / display` in `tailwind.config.ts` was to make the scale a single source of truth. Today, `app/(app)/cv/page.tsx:83` writes `text-[44px] … md:text-display` instead of just `text-h1 md:text-display`; `app/page.tsx:105` repeats the pattern; `app/u/[slug]/page.tsx:103` redefines the masthead size with `text-[44px] … md:text-[64px]` and bypasses `text-display` entirely; table cells across `/cv` use `text-[13.5px]` and `text-[10.5px]` directly instead of `text-body` or a new `text-table` token. Audit `app/page.tsx`, `app/(app)/cv/page.tsx`, `app/u/[slug]/page.tsx`, and `components/CvHighlights.tsx` for every `text-\[[0-9.]+px\]` and migrate to the named scale. Where the named scale doesn't fit (e.g. 14.5px, 15.5px, 13.5px), either widen the scale OR snap to the nearest existing token; do not leave the codebase with two parallel size systems. — *user impact:* design drift, brittle dark-mode/responsive work later — *concrete fix:* grep `text-\[[0-9.]+(px|rem|em)\]` in `app/page.tsx`, `app/(app)/cv/page.tsx`, `app/u/[slug]/page.tsx`, `components/CvHighlights.tsx`, `components/CvNeedsAttentionBanners.tsx`, `components/BrandMark.tsx`, `components/Footer.tsx` and migrate.

2. **Update brand-identity assets to match the editorial palette.** `app/icon.tsx`, `app/apple-icon.tsx`, and `app/opengraph-image.tsx` all still render the retired indigo SaaS identity: indigo `#4338CA` square monogram "DC", indigo-on-white pill chips ("Gmail read-only" / "Private to you" / "Open source"), and a `linear-gradient(160deg, #FAFAFA 0%, #EEF2FF 100%)` background that contradicts the cream-paper palette. The spec marks "OG image redesign" as out-of-scope, but the favicon and apple-touch-icon are the brand's appearance in *every* browser tab and iOS home screen of every user who already signed in — they're load-bearing brand surfaces, not marketing decoration. — *user impact:* a user who tabs back to their CV sees an indigo square that no longer matches the page it points at; share previews on Slack/Twitter still advertise the old aesthetic — *concrete fix:* swap `#4338CA` → `hsl(358 52% 32%)` (oxblood) and `#FAFAFA → #FAF6EC` (paper) in the three OG / icon files; restyle the OG monogram to a cream rectangle with an italic-Fraunces "debate cv" wordmark to match `BrandMark.tsx`.

3. **Reconcile copy with the contract.** `DownloadPdfButton.tsx:24` ships the label `"Download PDF"`. The spec explicitly chose `"Print to PDF"` for the `/cv` masthead action ("Share, **Print to PDF**, and a single 'More ↓' disclosure", design.md:236). The label "Download PDF" implies a server-rendered file when the actual behaviour is `window.print()` — that misalignment is exactly what the spec was correcting. Also, `app/(app)/cv/page.tsx:92` hard-codes the affiliation line as `[user?.email, 'Auto-compiled from Gmail']` whereas the spec specified `<school> · <email>` (design.md:226: "School derives from existing data; falls back gracefully if absent"). The school field exists in the data model but isn't wired through. — *user impact:* the masthead now reads `acharya.abhishek04@gmail.com  ·  Auto-compiled from Gmail`, which is meta-commentary, not a credential. *Concrete fix:* (a) rename the button label, (b) thread `user.school` from `buildCvData` into the masthead, fall through to `Auto-compiled from Gmail` only when school is null/empty.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**What landed.** Editorial register reads through all three surfaces — kickers (`A CAREER IN PARLIAMENTARY DEBATE`, `EDITOR'S NOTE · ON METHOD`, `COLOPHON · PROCESS & POLICY`, `LETTERS · FREQUENTLY ASKED`, `SUBSCRIBE`, `IN BRIEF`, `CAREER NOTES · HIGHLIGHTS`, `I · SPEAKING — N TOURNAMENTS`, `II · JUDGING — N TOURNAMENTS`, `NEEDS ATTENTION`, `DEBATE CV — PUBLIC RECORD · COMPILED …`) all match the spec's voice exactly. The `toBriefSentence()` helper (`app/(app)/cv/page.tsx:217–277`) spells out numbers below 20 as specified. Provenance footnote `"Source: tournament tabs at calicotab.com · herokuapp.com."` is rendered under both public tables (`app/u/[slug]/page.tsx:172`, `220`) per spec.

**Findings.**

- **WARNING — `DownloadPdfButton.tsx:24` ships `"Download PDF"`, spec called for `"Print to PDF"`.** The button calls `window.print()` (line 21), so "Download" is misleading — it opens the OS print dialog. The spec's renaming was specifically to drop that ambiguity (design.md:236, 307).
- **WARNING — `app/(app)/cv/page.tsx:92` hard-codes the affiliation row as `'Auto-compiled from Gmail'`.** Spec called for `<school> · <email>` (design.md:226). The school never enters the JSX; the placeholder string is meta-commentary about the product, not a personal credential. The `/u/<slug>` masthead handles affiliation correctly via the verified-tournament count (`spellOrCount(totalIngestedTournaments)` at `app/u/[slug]/page.tsx:115`), but `/cv` does not.
- **INFO — Generic-label sweep finds no live regressions in the redesigned surfaces.** `Cancel` appears in `AccountActions.tsx:59,154` and `CvRowReportButton.tsx:218` (out-of-scope modal flows — acceptable).
- **INFO — `app/page.tsx:147` hard-codes `"DEBATE CV — VOL. III · COMPILED 23 MAY 2026"` inside `PaperCvExcerpt`.** This is intentional sample content (the "what we produce, in the style of what it produces" landing self-reference) — date will read as stale tomorrow, but the spec accepted this trade-off implicitly by treating the excerpt as a static demonstration.

### Pillar 2: Visuals (3/4)

**What landed.** The three signature treatments are all rendered: hairline ink rules (`<hr className="hairline">` on all three mastheads + between Letters items), italic-Fraunces display headlines (`font-serif italic` at landing hero, `/cv` name, `/u/<slug>` name), drop cap on the landing lede (`<p className="dropcap …">` at `app/page.tsx:114`). The paper CV excerpt in the right hero column (`PaperCvExcerpt`, `app/page.tsx:144–192`) replaces the previous glass card and reads as a typeset journal entry — exactly the self-referential demo the spec asked for. `BrandMark.tsx` is the new italic-Fraunces wordmark (`debate cv` with the `cv` tinted oxblood). `Footer.tsx` is the paper colophon. Public CV avatar at `app/u/[slug]/page.tsx:96` is `rounded` (4px) with a 1px ink-rule border — matches spec's "portrait plate on a journal page" with the accepted `rounded` fallback.

**Findings.**

- **WARNING — Browser favicon, apple-touch icon, and OG share image all still render the retired indigo SaaS brand.** `app/icon.tsx:17`, `app/apple-icon.tsx:17`: indigo `#4338CA` rounded-square monogram with "DC" in bold sans. `app/opengraph-image.tsx:19,31,67,68,69`: indigo gradient background, indigo-on-cream-white monogram, three coloured pill chips in indigo/green/amber. These are the brand's appearance on every tab, every iOS home screen, every shared link — the contradiction with the editorial palette inside the app is jarring. Spec marks "OG image redesign" as a follow-on (design.md:431), so this is technically scoped out, but I'm calling it out because icons aren't OG art — they're persistent brand presence.
- **WARNING — Avatar fallback styling is incomplete vs. spec.** `app/u/[slug]/page.tsx:99` renders the initials fallback with `bg-paper` (cream), `border-ink/20`, italic Fraunces — but no portrait-plate ruled frame texture (spec said "ruled square"). It reads as a flat box, not a journaled portrait plate. Minor and subjective; accept-as-shipped is reasonable.
- **WARNING — Landing FAQ chevron is `▾` (Unicode triangle) rendered as Fraunces 18px.** Works visually, but it's a glyph hack instead of a Lucide icon (everywhere else uses Lucide). Inconsistent with the rest of the icon language (`app/page.tsx:377`).
- **INFO — `surface-card` utility from `globals.css:95` is only used once in the audited surfaces** (`app/page.tsx:146` — the PaperCvExcerpt right column). All other Card-like wrappers on the three surfaces are inlined hairline borders. Honest editorial direction — but it means the `surface-card`/`surface-elevated` utilities are nearly orphaned and the PaperCvExcerpt visually competes with the rest of the page by being the lone bordered surface.

### Pillar 3: Color (3/4)

**What landed.** Oxblood is the single accent, sized correctly: 64 total occurrences across 23 files, with the highest-density concentration on the legitimate accent surfaces — `OnboardingFlow.tsx` (10), `app/page.tsx` (8), `app/(app)/cv/page.tsx` (7), `app/(app)/dashboard/page.tsx` (5). On the three audited surfaces, oxblood appears on: kickers, focus rings (`--ring: 358 52% 32%`), the BrandMark's `cv` accent, "Reported" underline, `<code>` chips in the Editor's Note, FAQ chevron, Roman numerals in HowItWorks, `text-oxblood` links inline in Colophon body, and the `bg-primary` notification badge in `NotificationBell.tsx:111`. None of these are decorative — they all carry user-visible meaning. That's a 60/30/10 success.

`paper` and `ink` token re-binding works as designed: `text-foreground`, `text-muted-foreground`, `bg-background`, `border-border` resolve to the new palette automatically wherever they appear (and they appear throughout `dashboard`, `settings`, `admin` — out-of-scope surfaces that get the colour shift "for free" per spec).

**Findings.**

- **WARNING — `cv/verify` retains hardcoded `border-warning/30 bg-warning/[0.06]` and `text-warning` chrome** (`app/(app)/cv/verify/page.tsx:174,175`). It's an out-of-scope surface per spec, but the user lands there from the `/cv` "More → Verify extracted fields" action, so the colour mismatch is reachable from a redesigned surface. Sticky-yellow warning blocks contradict the editorial sober register.
- **WARNING — Hardcoded indigo `#4338CA` lives in three files outside the runtime UI but still served:** `app/icon.tsx:17`, `app/apple-icon.tsx:17`, `app/opengraph-image.tsx:19,31,67,68,69`. `app/global-error.tsx:35,40,50,51` also uses raw hex (`#fafafa`, `#666`, `#ccc`, `#fff`) — this is the global error boundary, so it sits outside the Tailwind layer by design, but it could at least lean on inline neutrals matched to the new palette.
- **INFO — `app/layout.tsx:65–66` correctly updates the `theme-color` meta tags to `#FAF6EC` (paper) / `#181A1F` (ink).** Good.
- **INFO — `NotificationBell.tsx:163` styles unread rows as `bg-primary-soft/30`.** That now resolves to oxblood-soft/0.024 — a barely-visible cream haze, which is fine, but it's so faint that "unread" indication is now carried almost entirely by font-weight. Worth UAT.

### Pillar 4: Typography (2/4)

**What landed.** The Fraunces / Inter / Plus Jakarta split is wired correctly (`app/layout.tsx:7–23`). Italic Fraunces drives every display headline. The custom font-size scale (`kicker`, `byline`, `body-serif`, `h3`, `h2`, `display`) is in `tailwind.config.ts:76–85`. The `.kicker` and `.byline` utility classes are heavily used (47 `text-(kicker|byline|caption|body|body-serif|...)` occurrences across the audited components). Tabular numerals via `.num` are applied consistently across stat columns and table numeric cells.

**Findings — this pillar is where the redesign leaves the most quality on the table.**

- **BLOCKER — 47 raw arbitrary `text-[NNpx]` declarations across the three primary surfaces and their supporting components, bypassing the scale that was deliberately defined to prevent exactly this drift.** Specifically:
  - `app/(app)/cv/page.tsx`: `text-[44px]` (L83), `text-[17px]` (L122), `text-[13px]` (L138), `text-[10.5px]` (L382, L410, L494, L557, L636, L658, L700, L745), `text-[28px]` (L385), `text-[14.5px]` (mobile cards), `text-[15.5px]` (L601, L724), `text-[13.5px]` (L555, L656), `text-[10px]` (L516).
  - `app/u/[slug]/page.tsx`: `text-[26px]` (L99), `text-[44px]` (L103), `text-[64px]` (L103), `text-[11px]` (L114), `text-[13px]` (L130, L184), `text-[10.5px]` (L131, L185), `text-[11.5px]` (L172, L220).
  - `app/page.tsx`: `text-[22px]` (L86, L165, L251), `text-[44px]` (L105), `text-[28px]` (L148), `text-[10px]` (L162), `text-[15px]` (L174, L178, L182, L186, L253, L305, L383), `text-[12px]` (L202, L215, L219), `text-[17px]` (L372), `text-[18px]` (L377).
  - `components/BrandMark.tsx:6,9` — `text-[18px]` instead of a `text-brand` named size.
  - `components/CvNeedsAttentionBanners.tsx:115,132`, `components/CvHighlights.tsx:114` — `text-[14.5px]` for the editorial body sub-line.

  The spec's whole rationale for declaring the type scale (design.md:83–97) was to make `text-display`, `text-h2`, `text-body-serif`, etc. the single source of truth. Shipping 47 inline pixel values defeats that. Many of the raw sizes (`14.5px`, `15.5px`, `13.5px`, `10.5px`) don't even appear in the scale — they're new values that arrived ad hoc.
- **WARNING — `text-h1` is defined in the config (`48px`) but unused on any audited surface.** Both the landing hero and `/cv` name go straight from `text-[44px]` to `md:text-display`. If `h1` will never be used, drop it; otherwise route at least one of these mastheads through it.
- **WARNING — `font-mono` survives in the speaker-score per-round mini-table (`app/(app)/cv/page.tsx:533`).** Spec said `.num` (proportional tabular figures) replaces `font-mono` on table numerics — the desktop column cells got the upgrade (using `num` class), but the inline per-round expansion cells didn't.

### Pillar 5: Spacing (3/4)

**What landed.** Vertical rhythm uses consistent `space-y-10` / `space-y-24` / `space-y-14` blocks. Section internals use `gap-x-8/10 gap-y-6/8` grids. Hairline-separated rows in CvHighlights and the FAQ accordion are clean. Mobile stacked cards on `/cv` use `border-t border-ink/10 py-5` which matches the editorial register.

**Findings.**

- **INFO — No arbitrary spacing pixel values found in the three redesigned surfaces.** Grep for `\[[0-9].*px\]` in spacing context returns only `w-[320px]` (CvShareButton popover width) and `w-[220px]` (More dropdown width) — fixed dialog widths, acceptable.
- **WARNING — `app/(app)/cv/page.tsx:133` uses `gap-1.5` for the In Brief action cluster.** Everywhere else uses `gap-3`, `gap-4`, `gap-6`, `gap-8`. The `.5` increment is an outlier — visually it forces Share / Print to PDF / More to crowd. Bumping to `gap-2` or `gap-3` would honour the established rhythm.
- **INFO — Padding values use Tailwind defaults throughout (`px-3 px-4 px-5 px-6 py-2.5 py-3 py-5`).** No 4px-grid violations spotted.

### Pillar 6: Experience Design (3/4)

**What landed.** Every behaviour-preserved guarantee from spec is honoured:

- Auth redirects (`app/page.tsx:16` `if (session?.user) redirect('/cv')`; `app/(app)/cv/page.tsx:33,42`; `app/u/[slug]/page.tsx:68` `notFound()`) all intact.
- `force-dynamic` set on `/cv` and `/u/<slug>` for fresh compile dates.
- Print stylesheet preserved verbatim (`app/globals.css:166–214`); `data-print-hide="true"` applied to CvShareButton, DownloadPdfButton, CvNeedsAttentionBanners, "More" dropdown, and the public-CV print button block (5 attachments across the audited surfaces).
- `CvNeedsAttentionBanners` is wired to the cheap `/api/cv/status` poll (preserved from earlier work) — pending and unmatched banners get the editorial restyle (italic Fraunces body, oxblood loader, ink-rule top border) without disturbing the poll.
- EmptyState renders with the new kicker + italic Fraunces + Inter body (`components/ui/EmptyState.tsx`).
- Route-group split delivered: `app/(app)/layout.tsx` exists, sticky header + Footer relocated, `app/layout.tsx` (root) is now `<html>/<body>/<ToastProvider>/<skip-link>/<main>` only, public CV layout sits outside the group (`app/u/[slug]/layout.tsx`) and renders its own colophon. The "app chrome leaking into `/u/<slug>`" defect the spec called out is genuinely fixed.
- Native `<details>` accordion on landing FAQ + per-row speaker score expansion preserved (works without JS, prints expanded).

**Findings.**

- **WARNING — The "More" disclosure on `/cv` (`app/(app)/cv/page.tsx:136–156`) is a bare `<details>` with no `aria-haspopup`, no `aria-expanded`, no keyboard-escape handler.** `CvShareButton` and `NotificationBell` both correctly wire `aria-haspopup`, `aria-expanded`, outside-click, and Esc-to-close (CvShareButton.tsx:54–62, NotificationBell.tsx:70–78). The new "More" affordance silently drops all of that. It works visually but screen-reader users get no signal that activating it opens a menu containing two more actions, and keyboard users can't close it with Esc.
- **WARNING — Public CV avatar img has no descriptive alt text other than the user's name** (`app/u/[slug]/page.tsx:95`). That's acceptable, but the initials fallback container at L99 has no `aria-label` describing what the initials represent — a screen reader announces just "AA" or similar. Add `role="img" aria-label={`${user.name} initials`}`.
- **WARNING — `BrokeBadge` ("Broken" / "—") and "Reported" labels (`app/(app)/cv/page.tsx:408–414, 494, 636, 700, 745`) are inline `<span>` elements without `aria-label` distinguishing them from surrounding cell text.** Sighted users get small-caps + oxblood underline as visual cues; assistive tech reads just the word "Broken" or "Reported" with no context that this is a status. Wrap as `<span role="status">` or supply an aria-label.
- **INFO — `volumeRoman()` (`lib/cv/volumeRoman.ts`) handles all the edge cases spec called out** (null, reversed span, ≥10 → "IX+"). Solid utility, tested behaviour preserved.

---

## Files Audited

**Surfaces (three primary):**
- `app/page.tsx` — landing
- `app/(app)/cv/page.tsx` — `/cv`
- `app/u/[slug]/page.tsx` — public CV
- `app/u/[slug]/layout.tsx` — public CV layout

**Shared components touched by redesign:**
- `app/(app)/layout.tsx` — route-group shell
- `app/layout.tsx` — root layout (post-split)
- `components/BrandMark.tsx`
- `components/Footer.tsx`
- `components/NavLink.tsx`
- `components/CvHighlights.tsx`
- `components/CvNeedsAttentionBanners.tsx`
- `components/CvShareButton.tsx`
- `components/DownloadPdfButton.tsx`
- `components/NotificationBell.tsx`
- `components/ui/Button.tsx`
- `components/ui/Badge.tsx`
- `components/ui/Card.tsx`
- `components/ui/EmptyState.tsx`
- `components/ui/StatusPill.tsx`

**Foundation / tokens:**
- `app/globals.css`
- `tailwind.config.ts`
- `lib/cv/volumeRoman.ts`

**Brand-identity assets (out-of-scope-but-flagged):**
- `app/icon.tsx`
- `app/apple-icon.tsx`
- `app/opengraph-image.tsx`
- `app/global-error.tsx`

Out-of-scope surfaces (dashboard, settings, onboarding, admin, privacy, terms, cv/verify) inspected at the grep level only — their token shifts inherit cleanly from the re-binding per spec design.md:60–66.
