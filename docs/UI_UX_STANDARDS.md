# UI/UX standards

Written 2026-10-27. Forty-three testable rules for every screen in the product, each with a reason, a good and a bad example in this app's own idiom (the "Ledger" system in `docs/DESIGN_INSTRUCTIONS.md` §6), and how it is enforced. A rule with neither a mechanical check nor a reviewer question was cut; the cut list is at the end. The audit that measured the app against these rules is `docs/UI_UX_AUDIT-2026-10-27.md`.

The owner mentioned a deep-research document on UI/UX standards that was not attached and is not in the repository. These rules were researched from the primary sources listed at the end, read on 2026-10-27. If that document turns up, reconcile it with this one rule by rule rather than replacing either.

These rules apply to **new and changed UI**. They are not a licence to rewrite working screens for style (`CLAUDE.md`, "Out of scope"). They sit beside the code rules in `docs/CODING_STANDARDS.md`; AX-1 to AX-3 there are kept, and the rules below make them specific.

**Baseline.** WCAG 2.2 level AA. WCAG 2.2 is the current W3C Recommendation (updated edition 12 December 2024); WCAG 3.0 is still a Working Draft (latest 10 September 2026) and is not a target.

**Enforcement key.**
- `axe:<rule>` is an axe-core rule run by `npm run a11y` (`scripts/a11y-smoke.mjs`, report-only, both themes, 390 px and 1280 px). Rules axe tags `best-practice` run only with `A11Y_BEST_PRACTICE=1`.
- `smoke:<check>` is a measurement the same script makes itself: `overflowX` (the page scrolls sideways), `targets` (pointer targets under 24×24 px, before axe's spacing exception), `nested` (a link or button inside another), `title` (the document title), `console` (console errors), and the full-page screenshots.
- `lint:<rule>` is ESLint in `npm run lint`. `eslint-config-next` turns on only six `jsx-a11y` rules, all as warnings: `alt-text`, `aria-props`, `aria-proptypes`, `aria-unsupported-elements`, `role-has-required-aria-props`, `role-supports-aria-props`.
- `test` is Vitest in `npm test`.
- `Q` is a question the reviewer asks. Automated checks find a little over half of accessibility issues at best (Deque's study of 13,000 pages found 57% by volume), so most rules keep a question even when a tool also checks them.

None of the `axe` or `smoke` checks block a merge yet; `docs/CI_PLAN-2026-10-27.md` describes how a report-only check becomes blocking.

## Summary

| ID | Rule | Enforcement |
|---|---|---|
| UX-1 | One `<main>` holding only page content; header, nav and footer outside it; the skip link lands in it | Q + axe `landmark-one-main`, `region` (best-practice; partial) |
| UX-2 | Every route has its own `<title>`; error states start with "Error:"; `<html lang>` everywhere | axe `document-title`, `html-has-lang` + smoke `title` + Q |
| UX-3 | One `h1` per page; heading levels never skip; shared components take a heading level | axe `page-has-heading-one`, `heading-order` (best-practice) + Q |
| UX-4 | The current page is marked `aria-current="page"` in each nav, exactly once | Q |
| UX-5 | Menus and popovers use the disclosure pattern, not `role="menu"`; focus goes in, Escape closes, focus returns | axe `aria-required-children` + Q |
| UX-6 | Modal dialogs: named, focus moved in and trapped, Escape closes, focus returns to the trigger | axe `aria-dialog-name` + Q |
| UX-7 | When an action replaces the control that had focus, focus moves to the new content's heading | Q |
| UX-8 | Pointer targets at least 24×24 CSS px; 44 px on touch for primary controls | axe `target-size` + smoke `targets` + Q |
| UX-9 | No interactive element inside another (`<Link><Button>`) | smoke `nested` + axe `nested-interactive` + Q |
| UX-10 | Focus is always visible: no `outline-none` without a full-strength `focus-visible` ring | Q |
| UX-11 | Every control's accessible name contains its visible label and, in a list, says which row | axe `button-name`, `link-name`, `label-content-name-mismatch` + Q |
| UX-12 | Toggles expose their state (`aria-pressed`, `role="switch"`) and keep a fixed label | lint `role-has-required-aria-props` + Q |
| UX-13 | Every field has a visible `<label>`; option groups sit in `fieldset` with `legend` | axe `label`, `select-name` + Q |
| UX-14 | Personal-data fields carry `autocomplete`; slug and email fields switch off autocapitalise and spellcheck | axe `autocomplete-valid` + Q |
| UX-15 | Field errors appear in text next to the field, linked by `aria-describedby`, with focus moved to the field; never only in a toast | Q |
| UX-16 | Do not disable a submit button to signal bad input; validate on submit and explain inline | Q |
| UX-17 | Destructive actions confirm and name the consequence; default focus is the safe choice; no double submit | Q |
| UX-18 | Field and control boundaries reach 3:1 against what surrounds them | Q |
| UX-19 | Status messages use one polite live region present at load; errors use `role="alert"`; live regions never nest or poll | Q |
| UX-20 | Toasts carry passive success only; errors and anything with an action stay until dismissed, or render inline | Q |
| UX-21 | A harmless wait (rate limit, cooldown) is a neutral notice with the time remaining, never "failed" | test + Q |
| UX-22 | Work longer than ~10 s shows "X of N", can be cancelled, and has a named progressbar | axe `aria-progressbar-name` + Q |
| UX-23 | Raw codes and stack text (`rate_limited`, `HTTP 500`) never reach the screen; each maps to plain words and a next step | test + Q |
| UX-24 | Every list or table defines its empty state: why it is empty and one direct action; "no data" differs from "nothing matches" | Q |
| UX-25 | Loading screens mirror the page layout, use fluid widths, and announce "Loading …" once | smoke `overflowX` + Q |
| UX-26 | Error boundaries speak plain language, give a reference code, a retry and a way out | Q |
| UX-27 | No blank numeric cell: an em dash means "not published"; a real state gets a word | Q |
| UX-28 | Tabular data uses `DataTable`: `th scope`, row headers, an accessible name | axe `th-has-data-cells`, `td-headers-attr` + Q |
| UX-29 | Wide tables scroll inside a focusable, named region with a visible scroll cue | axe `scrollable-region-focusable` + smoke `overflowX` |
| UX-30 | Below `md`, a table of more than five columns becomes cards (or pins its first column); nothing is truncated away | smoke screenshots at 390 + Q |
| UX-31 | Numeric columns are `.cell-num`; headers carry their unit ("vs you (pp)") | Q |
| UX-32 | Every chart has a text alternative naming what is measured, the range and the sample size | axe `svg-img-alt`, `role-img-alt` + Q |
| UX-33 | Chart text reaches 4.5:1 and chart marks 3:1; no `fillOpacity` on text; labels at least 12 px as rendered | axe `color-contrast` + Q |
| UX-34 | Colour is never the only cue; on a number it means up or down only, with a sign; zero is neutral | Q |
| UX-35 | The sample size is visible next to every aggregate, not only in a tooltip | Q |
| UX-36 | Nothing needed lives only in a `title` or on hover | Q |
| UX-37 | Text contrast 4.5:1 (3:1 for large text) in both themes; no opacity modifiers on text tokens | axe `color-contrast` (both themes) |
| UX-38 | Every surface is themed in light and dark, including prose and native controls (`color-scheme`) | axe `color-contrast` (dark run) + smoke screenshots + Q |
| UX-39 | No sideways page scroll at 320 CSS px | smoke `overflowX` + Q |
| UX-40 | All motion, including JavaScript smooth scrolling, honours `prefers-reduced-motion` | Q |
| UX-41 | Core Web Vitals at the 75th percentile: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 | Q (Lighthouse / Vercel Speed Insights) |
| UX-42 | Copy uses the IA's names (Record, Statistics, Imports, Settings) and the debater's words | Q |
| UX-43 | A link that opens a new tab says so | Q |

## 1. Structure and navigation

**UX-1. One `<main>` that holds only page content.** *Why:* screen-reader users jump by landmark, and the skip link (SC 2.4.1) must skip the repeated header, not land above it. *Good:* `<body><a class="skip-link" href="#main"> <header>…</header> <main id="main">…</main> <footer/></body>`. *Bad:* the app header and `Footer` rendered inside `<main id="main">`, so the skip link lands on the header it was meant to skip. *Enforced:* axe `landmark-one-main` and `region` (best-practice tag). Note that axe does not flag today's defect: a `header` inside `main` is simply not a banner, so there is no misplaced banner to report. The question carries this rule. *Q:* "Does Tab, Enter on the skip link put focus on the first thing after the nav?"

**UX-2. Every route has its own title; error states start with "Error:"; every `<html>` has `lang`.** *Why:* the title is the first thing announced (SC 2.4.2); the GOV.UK error-summary pattern prefixes it so the failure is heard before anything else; `lang` sets pronunciation (SC 3.1.1). *Good:* `export const metadata = { title: 'Sharing' }` on `/settings/sharing` → "Sharing · debate cv". *Bad:* all four settings pages titled "Settings · debate cv"; `app/global-error.tsx` rendering `<html>` without `lang`. *Enforced:* axe `document-title`, `html-has-lang`; smoke `title` lists each page's title so duplicates show; *Q:* "Does the new route export a title that differs from its siblings?"

**UX-3. One `h1` per page and no skipped heading levels.** *Why:* heading navigation is the most common way screen-reader users scan a page (SC 1.3.1, 2.4.6). *Good:* `EmptyState` given a `headingLevel` so it renders `h2` straight under the page `h1`. *Bad:* the settings layout's `h2` "Settings" above each settings page's `h1`; `EmptyState` hard-coding `h3` directly after an `h1`. *Enforced:* axe `page-has-heading-one`, `heading-order` (best-practice); *Q:* "Read the headings alone, in order: is the outline right?"

**UX-4. The current page is marked once per nav.** *Why:* `aria-current="page"` is the only way the active pill is announced. *Good:* `NavLink` sets it from the pathname, with `exact` on `/cv` so Record and Statistics never both claim it. *Bad:* the dashboard's filter tile and filter chip both setting `aria-current="page"` for the same URL. *Q:* "In each nav, does exactly one link say it is current?"

**UX-5. Menus and popovers use the disclosure pattern.** *Why:* `role="menu"` promises arrow-key navigation and typeahead (APG menu-button); the APG's own site-navigation example deliberately avoids it. A button with `aria-expanded` that shows a list of links needs no promise it cannot keep. *Good:* `<button aria-expanded={open} aria-controls="account-panel">` then `<div id="account-panel"><ul><li><Link/></li></ul></div>`, focus moved to the first link on open and back to the button on Escape. *Bad:* `NotificationBell`'s `role="menu"` wrapping a heading `div` and plain links (no `menuitem` children, which axe flags). *Enforced:* axe `aria-required-children`; *Q:* "Does the popover open, close on Escape, and return focus with the keyboard alone?"

**UX-6. Modal dialogs are named, trap focus, close on Escape and return focus.** *Why:* APG dialog (modal) pattern; without the trap, Tab walks into the page behind the overlay. *Good:* `CvRowReportButton`: `aria-modal`, focus to the first checkbox, Tab wraps, Escape closes, focus returns to the row's Report button. *Bad:* a delete-account confirmation that unmounts the trigger and leaves focus on `<body>`. *Enforced:* axe `aria-dialog-name`; *Q:* "Open it, press Tab twenty times, press Escape: where is focus?"

**UX-7. When an action replaces the control that had focus, move focus to the new content.** *Why:* SC 2.4.3; a keyboard or screen-reader user otherwise restarts from the top of the page with no word of what changed. *Good:* each onboarding step's `h2` has `tabIndex={-1}` and is focused when `phase` changes. *Bad:* "Continue" in `OnboardingFlow` swapping the whole card so the button that had focus no longer exists. *Q:* "After the click, where is focus, and was the change announced?"

## 2. Interaction

**UX-8. Pointer targets are at least 24×24 CSS px; primary controls are 44 px on touch.** *Why:* SC 2.5.8 sets 24 px (or 24 px of clear spacing) at AA; Apple asks 44×44 pt and Material 48×48 dp for touch. The repo's `coarse:` variant already raises `Button` to 44 px on a coarse pointer. *Good:* `<Button size="sm">` (32 px, 44 px under `coarse:`). *Bad:* `<Button variant="link" size="sm">` for the dashboard's per-row "Ingest" and "Clear", which skips the size classes entirely (18 px tall, 4 px apart); the toast's dismiss `×` at 16 px. *Enforced:* axe `target-size`; smoke `targets` counts every control under 24 px; *Q:* "Is any new control smaller than 24 px, or closer than 24 px to its neighbour?"

**UX-9. No interactive element inside another.** *Why:* `<a><button>` is invalid HTML, makes two tab stops for one action, and is announced as "link, button". *Good:* a `buttonClasses({ variant, size })` helper exported from `components/ui/Button.tsx`, applied to the `<Link>` itself. *Bad:* `<Link href="/dashboard"><Button>Open imports</Button></Link>` (12 places today). *Enforced:* smoke `nested` counts `a button`, `a a`, `button a` and `button button` on every checked page. axe's `nested-interactive` only looks inside button-like widgets, and it did not flag any of the twelve cases in the 2026-10-27 run. *Q:* "Is there a `<Button>` inside a `<Link>` or an `<a>`?"

**UX-10. Focus is always visible.** *Why:* SC 2.4.7; `globals.css` already draws a 2 px `:focus-visible` outline in `--ring` and the only way to lose it is to switch it off. *Good:* leave the global outline alone, or `focus-visible:ring-2 focus-visible:ring-ring` (7:1 against the canvas). *Bad:* `outline-none focus:ring-2 focus:ring-primary/20`, about 1.2:1, so the ring is invisible. *Q:* "Does the change add `outline-none`? What replaces it, at what contrast?"

**UX-11. Accessible names contain the visible label and say which row.** *Why:* SC 2.5.3 (speech users say what they see) and SC 2.4.6; thirty buttons all named "This is me" cannot be told apart in a screen reader's controls list. *Good:* `aria-label={`Report a problem with ${tournamentName}`}` on the icon-only report button. *Bad:* the sharing switch named "Toggle public sharing" beside the visible text "Public sharing"; "Find me" repeated on every unmatched row. *Enforced:* axe `button-name`, `link-name` (and `label-content-name-mismatch`, an experimental rule); *Q:* "Read the controls list: is every name unique and does it start with the visible words?"

**UX-12. Toggles expose state and keep a fixed label.** *Why:* SC 4.1.2; APG switch and toggle-button patterns say the label must not change with the state, or the user cannot tell whether it names the state or the action. *Good:* `<button aria-pressed={mineOnly}>Only me</button>`. *Bad:* `VerifyMineOnlyToggle` flipping its text between "Only me" and "Everyone" with no `aria-pressed`. *Enforced:* lint `jsx-a11y/role-has-required-aria-props` (catches `role="switch"` without `aria-checked`); *Q:* "Does the control say whether it is on, without its text changing?"

## 3. Forms

**UX-13. Every field has a visible label; option groups have a legend.** *Why:* SC 1.3.1, 3.3.2 and 4.1.2; a placeholder disappears as soon as the user types and is not reliably announced. *Good:* `CvRowReportButton`'s `<fieldset><legend>What looks wrong?</legend>` and `<label htmlFor="report-comment-…">`. *Bad:* the delete-account field whose only label is a placeholder containing the email. *Enforced:* axe `label`, `select-name`; *Q:* "Cover the placeholder: can you still tell what the field is for?"

**UX-14. Personal-data fields carry `autocomplete`; slug and email fields switch off autocapitalise and spellcheck.** *Why:* SC 1.3.5, and a phone capitalising "Maya-rao" makes a valid slug fail validation. *Good:* `<input autoComplete="off" autoCapitalize="none" spellCheck={false}>` on the public-CV slug; `autoComplete="email"` on an email field. *Bad:* the slug input with neither. *Enforced:* axe `autocomplete-valid`; *Q:* "What does a phone keyboard do to the first letter typed here?"

**UX-15. Field errors are text next to the field, linked to it, with focus moved there.** *Why:* SC 3.3.1 and 3.3.3; GOV.UK's error-message pattern (error after the hint, `aria-describedby`, visually hidden "Error:" prefix, error summary at the top when there are several). A toast disappears in five seconds, sits far from the field and cannot be linked to it; NN/g calls toasts "a bad way to implement an error message". *Good:* `<input aria-invalid aria-describedby="slug-hint slug-error">` then `<p id="slug-error" className="text-caption text-destructive">That address is taken. Try maya-rao-2.</p>`. *Bad:* `SharingManager` reporting "slug_taken" only through `toast.show({ kind: 'error' })`. *Q:* "Submit it wrong: is the error next to the field, does it say how to fix it, and is focus on it?"

**UX-16. Do not disable submit to signal bad input.** *Why:* a disabled button cannot be focused and does not say why it is disabled (GOV.UK button guidance: avoid disabled buttons); validate on submit (GOV.UK validation pattern). Disabling while a request is in flight is fine (`loading`). *Good:* "These are me — continue" stays enabled; pressing it with nothing ticked shows "Tick at least one name that is you" under the list. *Bad:* the same button disabled at zero, so the helpful message written for that case can never appear. *Q:* "If the button is disabled, where on screen does it say why?"

**UX-17. Destructive actions confirm, name the consequence, default to safety and cannot double-submit.** *Why:* NN/g heuristic 5 (error prevention), SC 3.3.4's intent for data changes, GOV.UK's warning-button guidance (add a confirmation step; do not rely on red alone). *Good:* "Disconnect Gmail? New tournaments stop arriving. Your record stays and you stay signed in." with focus on Cancel and `loading` on the confirm button. *Bad:* `IdentityManager` saving an empty selection that removes every claimed tournament with no confirmation. *Q:* "What is lost if this is clicked by mistake, and does the screen say so before it happens?"

**UX-18. Field and control boundaries reach 3:1.** *Why:* SC 1.4.11; the hairline `border-border` token is `--border` at 16% (1.25:1 on white in light, 1.56:1 in dark), right for table rules and wrong for the edge of a text box. *Good:* a field border at `hsl(var(--border) / 0.5)` or stronger (about 3:1 in light; check dark separately), or `border-input` once that token is raised. *Bad:* `border border-border bg-paper` on the slug and delete-confirmation inputs; a switch whose off track is `bg-ink/10`. *Q:* "Squint: can you see where the field is before you click it, in both themes?"

## 4. Feedback and status

**UX-19. One polite live region, present at load; `role="alert"` for errors; no nesting; no polling regions.** *Why:* SC 4.1.3; live regions must exist before their content changes (Soueidan; Roselli); a region inside a region is announced twice or not at all; `aria-live` on a section that re-renders every five seconds talks over everything else. *Good:* the toast viewport as a single `role="status"` container; each card a plain `div`. *Bad:* `aria-live="polite" aria-atomic="true"` on the toast viewport plus `role="status"` or `role="alert"` on each card inside it (and `aria-atomic` re-reading every toast when one is added); `IngestProgressTracker`'s whole section `aria-live` while it polls. *Q:* "Turn on a screen reader: is each message read exactly once?"

**UX-20. Toasts carry passive success only; errors and actions persist.** *Why:* SC 2.2.1 (a time limit must be adjustable; a five-second toast is one); the APG alert pattern ("avoid designing alerts that disappear automatically"); Material says snackbars with an action stay until acted on. *Good:* "Link copied" as a 5 s toast that pauses on hover and focus. *Bad:* "Scan failed", "Report not sent" and the "View your CV" action link all auto-dismissing after 5 s. *Q:* "If the user looked away for ten seconds, what did they miss?"

**UX-21. A harmless wait is a neutral notice with the time remaining.** *Why:* NN/g heuristics 1 and 9; labelling a cooldown "failed" sends the user looking for a fault that does not exist. The server already sends `Retry-After`. *Good:* an info notice "Your mailbox was scanned a moment ago. You can scan again in 1:42." with the button disabled and counting down, re-enabled at zero. *Bad:* `DashboardActions.ScanButton` throwing the friendly cooldown text into an error toast headed "Scan failed". *Enforced:* `tests/ingest.scanErrorMessage.test.ts` (extend it to cover the kind and the wait); *Q:* "Is anything here called an error that the user cannot and need not fix?"

**UX-22. Long work shows "X of N", can be cancelled, and has a named progressbar.** *Why:* NN/g response-time limits (past 10 s, show percent done and offer a way out); the progressbar needs a name (axe). *Good:* "Ingesting… 7/23" with a Stop button, and `role="progressbar" aria-label="Import progress"`. *Bad:* a `role="progressbar"` with no name. *Enforced:* axe `aria-progressbar-name`; *Q:* "If this takes two minutes, what does the user see, and can they stop it?"

**UX-23. Raw codes never reach the screen.** *Why:* NN/g error-message guidelines (plain language, the specific problem, a next step); GOV.UK says never "An error occurred". *Good:* a mapping helper beside `scanErrorMessage` that turns `bad_request`, `unauthorized`, `HTTP 500` into a sentence and an action. *Bad:* `description: result.error` printing `rate_limited` or the first 200 characters of an HTML error page; "Could not load sharing (HTTP 500)". *Enforced:* a unit test per mapping helper; *Q:* "Could this text contain a code, a URL path or a stack trace?"

## 5. Empty, loading and error states

**UX-24. Every list or table defines its empty state.** *Why:* NN/g on empty states: say why it is empty and give a direct path to fill it; never show "no records" while still loading. "Nothing matches this filter" is a different state from "nothing yet". *Good:* "No tournaments ingested yet. Scan Gmail finds the links, then Ingest all parses each one." with an "Open imports" action. *Bad:* the public CV rendering only its header when sharing is on and there are no rows; onboarding staying on the scan step with a 5 s toast when the scan finds nothing. *Q:* "What does this look like with zero rows, and with zero rows after a filter?"

**UX-25. Loading screens mirror the page, use fluid widths and announce once.** *Why:* NN/g: skeletons for full-page loads under 10 s; skeletons are `aria-hidden`, so without a status line a screen-reader user hears nothing. A fixed-width skeleton bar wider than the phone makes the page scroll sideways while it loads. *Good:* `loading.tsx` with `w-full max-w-sm` bars and `<p role="status" className="sr-only">Loading statistics…</p>`. *Bad:* `w-96` skeleton bars (384 px) in a 390 px viewport; a 4-column skeleton for a table that has 3. *Enforced:* smoke `overflowX` (catches it on slow loads); *Q:* "Does the skeleton have the same shape as the page, and does a screen reader hear 'Loading'?"

**UX-26. Error boundaries speak plain language and give a reference, a retry and a way out.** *Why:* NN/g heuristic 9; Next.js passes `error.digest` precisely so the user can quote it without seeing internals. *Good:* "This page did not load. Try again, or go to your record. Reference: 3c9f…" *Bad:* `{error.message}` rendered verbatim in `app/error.tsx`. *Q:* "What does this screen show for a thrown Prisma error?"

**UX-27. No blank numeric cell; a real state gets a word.** *Why:* Ledger §6: an em dash means "the source did not publish this"; a blank reads as a bug. Using the same dash for a real outcome hides that outcome. *Good:* `<Nil />` for a speaker score the tab did not publish; "Did not break" in `text-ink-soft` in the Result column. *Bad:* `<Nil />` for "did not break" on the public CV. *Q:* "Can every dash on this screen be read as 'not published'?"

## 6. Tables

**UX-28. Tabular data uses `DataTable` with proper headers and a name.** *Why:* SC 1.3.1; WAI tables tutorial; APG: use a native table whenever possible, and grid only for interactive cells. Row headers let a screen reader announce "Worlds 2025, Speaker avg 76.4" instead of a bare number. *Good:* `<Table label="Speaking record by tournament">` with `<Th>` (which sets `scope="col"`) and a `<Th scope="row">` first cell. *Bad:* the dashboard's raw `<table className="ledger">` with bare `<th>` and no name. *Enforced:* axe `th-has-data-cells`, `td-headers-attr`; `CODING_STANDARDS.md` AX-1; *Q:* "Is this built on `DataTable`, and does each row have a header cell?"

**UX-29. Wide tables scroll inside a focusable, named region with a visible cue.** *Why:* SC 2.1.1: a keyboard user cannot scroll a region that holds no focusable element unless the region itself takes focus (axe `scrollable-region-focusable`, serious). The Ledger rule says the page body never scrolls sideways. The July audit found the public CV hiding its Result column behind an unmarked scroll. *Good:* `TableScroll` rendering `<div role="region" aria-label={label} tabIndex={0} className="table-scroll">` with CSS scroll shadows on any edge that has more content. *Bad:* a bare `overflow-x-auto` div around a `min-w-max` table. *Enforced:* axe `scrollable-region-focusable`; smoke `overflowX`.

**UX-30. Below `md`, a wide table becomes cards; nothing is truncated away.** *Why:* NN/g on mobile tables (lock the first column, show that more is available, or switch layout); SC 1.4.10. A phone is the primary device (`DESIGN_INSTRUCTIONS.md` §6, Layout). *Good:* `/cv`'s speaking cards: one `panel` per tournament with a `dl` of labelled figures. *Bad:* the public CV rendering its desktop table at 390 px; mobile `dd` values with `truncate` whose full text exists only in `title`. *Enforced:* smoke screenshots at 390 px; *Q:* "At 390 px, can every value be read without hovering or scrolling sideways?"

**UX-31. Numeric columns are `.cell-num`; headers carry their unit.** *Why:* Ledger rule 2 (figures are mono and tabular, aligned down the page); a header that hides its unit in a tooltip misleads (SC 1.3.1, 2.4.6). *Good:* `<Th numeric>vs you (pp)</Th>` beside `<Th numeric>vs you (pts)</Th>`. *Bad:* two columns both headed "vs you", one in percentage points and one in speaker points. *Q:* "Is every number right-aligned in mono, and is its unit in the visible header?"

## 7. Charts and figures

**UX-32. Every chart has a text alternative.** *Why:* SC 1.1.1; W3C complex-images tutorial (short alternative plus long description or data table); the GOV.UK Analysis Function asks for alt text or a data table on every chart. *Good:* `<svg role="img" aria-labelledby="t d"><title id="t">Speaker average by season</title><desc id="d">2023: 74.1 (n=18) … 2026: 77.0 (n=9)</desc>`. *Bad:* the score histogram as loose `div`s with the bin ranges only in `title`. *Enforced:* axe `svg-img-alt`, `role-img-alt`; *Q:* "With the screen off, what does a screen reader say this chart shows?"

**UX-33. Chart text reaches 4.5:1 and marks 3:1, at a legible rendered size.** *Why:* SC 1.4.3 and 1.4.11; the Analysis Function asks 4.5:1 for all chart text. An SVG with a fixed 640-unit `viewBox` scaled to a 326 px panel draws "12 px" labels at about 6 px. *Good:* `fill="hsl(var(--muted-foreground))"` on `<text>` (5.3:1 light, 6.0:1 dark); opacity only on gridlines. *Bad:* `fill="currentColor" fillOpacity={0.38}` on the `n=` line (about 2.1:1); histogram bars at `bg-ink/15` (about 1.3:1). *Enforced:* axe `color-contrast` (it checks SVG text only partly); *Q:* "Screenshot at 390 px: can you read the smallest label?"

**UX-34. Colour is never the only cue; on a number it means up or down.** *Why:* SC 1.4.1 and Ledger rule 3: green up or kept, red down or lost, gold a break, blue analysis, amber attention, emerald the one brand accent. *Good:* `DeltaChip` pairing `val-pos` with ▲ and "+2.8"; `val-flat` for a delta that rounds to zero. *Bad:* a green "−0.0"; gold on a "Pro ×N" badge that is not a break; a rejected tag in `text-oxblood` (the emerald accent). *Q:* "Name the claim each colour on this screen is making."

**UX-35. The sample size is visible next to every aggregate.** *Why:* `DESIGN_INSTRUCTIONS.md` §9 rule 1 ("a 100% win rate over two rounds is not a statistic"); thin samples are marked in text and use the same threshold as the findings engine (`MIN_QUIRK_ROUNDS`). *Good:* `TeammatesSection` printing `n = 2` instead of a win rate for a thin row. *Bad:* the thin-sample "·" marker at 50% opacity with its round count only in `title`; `StatsSplitTable` defaulting `thinBelow` to 4 while findings need 6. *Q:* "Next to each percentage or average, where is the n?"

**UX-36. Nothing needed lives only in a `title` or on hover.** *Why:* SC 1.4.13; touch devices never show `title`, and keyboard users rarely get it. *Good:* `/cv`'s visible paragraph explaining "Team rank", "Spk avg" and "Spk tab" under the table. *Bad:* team placement "#3 of 40 · top 8%" only in a `title`; truncated tournament names on mobile cards with no way to read them in full. *Q:* "On a phone, is every piece of information on this screen reachable?"

## 8. Visual design

**UX-37. Text reaches 4.5:1 (3:1 for large text) in both themes.** *Why:* SC 1.4.3. The tokens pass on their own (in light, `muted-foreground` is 5.3:1 on a card; in dark, 6.0:1). They fail as soon as an opacity modifier is added: `text-ink-soft/50` is about 2.0:1. *Good:* `text-ink-soft` at full strength for secondary text. *Bad:* `text-ink-soft/50`, `opacity-60` on text. *Enforced:* axe `color-contrast`, run in both themes by `npm run a11y`.

**UX-38. Every surface is themed in light and dark.** *Why:* contrast applies to whatever the user is shown; MDN's `color-scheme` makes native form controls and scrollbars follow the theme. *Good:* `[data-theme='dark'] { color-scheme: dark; }` beside the dark tokens; prose colours mapped to tokens. *Bad:* `prose prose-stone` on `/privacy` and `/terms` (fixed stone greys on the graphite canvas); the OG image and `global-error.tsx` still in the old editorial palette. *Enforced:* axe `color-contrast` (dark run); smoke screenshots in dark; *Q:* "Did you look at it in dark?"

**UX-39. No sideways page scroll at 320 CSS px.** *Why:* SC 1.4.10 (reflow) and the Ledger rule "the page body must never scroll sideways". *Good:* `flex-wrap` on header button groups; `grid-cols-2 sm:grid-cols-4`. *Bad:* `/admin/tags`'s four `nowrap` buttons in one `justify-between` row. *Enforced:* smoke `overflowX` at 390 px (run with a 320 px viewport before shipping a new layout); *Q:* "Did you check 320 px?"

**UX-40. All motion honours `prefers-reduced-motion`.** *Why:* MDN `prefers-reduced-motion`; WCAG technique C39 (for SC 2.3.3, AAA, adopted here because the guard already exists in `globals.css`). CSS animations are covered by that guard; JavaScript `scrollTo({ behavior: 'smooth' })` is not. *Good:* `behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'`. *Bad:* `PageJumpNav`'s back-to-top button always smooth-scrolling. *Q:* "With reduce motion on in the OS, does anything still slide?"

## 9. Performance

**UX-41. Core Web Vitals at the 75th percentile: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1.** *Why:* web.dev's "good" thresholds, unchanged since INP replaced FID in March 2024. A stats page that shifts as charts load, or a filter chip that takes half a second to respond, is felt before it is measured. *Good:* skeletons with the real layout's dimensions (no shift when data arrives); `next/font` with `display: swap` (already in `app/layout.tsx`). *Bad:* a client-side filter that re-renders 900 lines of stats on every click. *Q:* "Did a Lighthouse mobile run, or Vercel Speed Insights, show any of the three outside 'good' on the changed page?"

## 10. Copy

**UX-42. Copy uses the IA's names and the debater's words.** *Why:* NN/g heuristic 2 (match the real world) and heuristic 4 (consistency); `DESIGN_INSTRUCTIONS.md` §5 and §8. *Good:* "Imports", "Record", "Reconnect Gmail. Your record stays." *Bad:* "Find yourself on the dashboard", page title "My CV", "Ingest jobs", "queue drains", "Revoke the OAuth grant", "Tournaments in flight" over four zeroes. *Q:* "Would a second-year debater understand every word without knowing how the app is built?"

**UX-43. A link that opens a new tab says so.** *Why:* WCAG advisory technique G201; an unexpected new tab breaks the Back button (SC 3.2.5's intent). *Good:* `<ExternalLink aria-hidden />` visible, plus `<span className="sr-only"> (opens in new tab)</span>`. *Bad:* the tournament-name links on `/cv`, whose icon is `opacity-0` until hover and has no text. *Q:* "Does every `target="_blank"` say so, visibly and to a screen reader?"

## Considered and dropped (no check or reviewer question yet)

- **Enforced keyboard order audit** (SC 2.4.3 beyond UX-7): needs a scripted Tab walk per page. Playwright can do it; add it to `a11y-smoke.mjs` when there is time to keep the expected orders current.
- **`eslint-plugin-jsx-a11y` recommended set**: only six of its rules run today, through `eslint-config-next`. Turning on the recommended set as warnings would catch `click-events-have-key-events`, `no-static-element-interactions` and `label-has-associated-control`. It is a new dev dependency, so it needs its own PR (DP-2). Once it lands, UX-9, UX-11 and UX-13 gain a lint check.
- **Automated non-text contrast** (UX-18, UX-33 marks): axe does not measure borders or SVG shapes. A Vitest check over the HSL tokens (like `.reports/contrast.mjs`, used for this audit) could pin the hairline-versus-field distinction. It is not written yet.
- **Real-user Core Web Vitals in CI**: Vercel Speed Insights is not installed and Lighthouse CI is not configured. UX-41 is a review question until one of them is.
- **3.3.8 Accessible authentication**: sign-in is Google OAuth only; there is no in-app credential entry to test.
- **3.3.7 Redundant entry**: no multi-step form asks for the same thing twice today.

## Sources (read 2026-10-27)

**WCAG and the W3C**
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Standards status: https://www.w3.org/WAI/standards-guidelines/wcag/
- WCAG 3.0 Working Draft: https://www.w3.org/TR/wcag-3.0/
- Technique C39 (reduced motion): https://www.w3.org/WAI/WCAG22/Techniques/css/C39
- Tables tutorial: https://www.w3.org/WAI/tutorials/tables/ and https://www.w3.org/WAI/tutorials/tables/caption-summary/
- Complex images: https://www.w3.org/WAI/tutorials/images/complex/

**WAI-ARIA Authoring Practices**
- Tabs: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
- Disclosure: https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
- Disclosure navigation (no menu role): https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/
- Menu button: https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
- Modal dialog: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- Alert: https://www.w3.org/WAI/ARIA/apg/patterns/alert/
- Table: https://www.w3.org/WAI/ARIA/apg/patterns/table/
- Grid: https://www.w3.org/WAI/ARIA/apg/patterns/grid/
- Sortable table: https://www.w3.org/WAI/ARIA/apg/patterns/table/examples/sortable-table/
- Switch: https://www.w3.org/WAI/ARIA/apg/patterns/switch/
- MDN `status` role: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role
- MDN `aria-busy`: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-busy

**Nielsen Norman Group**
- 10 heuristics: https://www.nngroup.com/articles/ten-usability-heuristics/
- Error messages: https://www.nngroup.com/articles/error-message-guidelines/
- Empty states: https://www.nngroup.com/articles/empty-state-interface-design/
- Response times: https://www.nngroup.com/articles/response-times-3-important-limits/
- Progress indicators: https://www.nngroup.com/articles/progress-indicators/
- Skeleton screens: https://www.nngroup.com/articles/skeleton-screens/
- Indicators, validations and notifications: https://www.nngroup.com/articles/indicators-validations-notifications/
- Mobile tables: https://www.nngroup.com/articles/mobile-tables/

**Touch targets**
- Apple HIG, accessibility: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Material 3 structure: https://m3.material.io/foundations/designing/structure

**GOV.UK Design System**
- Error summary: https://design-system.service.gov.uk/components/error-summary/
- Error message: https://design-system.service.gov.uk/components/error-message/
- Validation: https://design-system.service.gov.uk/patterns/validation/
- Notification banner: https://design-system.service.gov.uk/components/notification-banner/
- Button: https://design-system.service.gov.uk/components/button/
- Question pages: https://design-system.service.gov.uk/patterns/question-pages/
- Warning text: https://design-system.service.gov.uk/components/warning-text/

**Performance, theming, motion, loading**
- Core Web Vitals thresholds: https://web.dev/articles/defining-core-web-vitals-thresholds and https://web.dev/articles/vitals
- MDN `prefers-color-scheme`: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-color-scheme
- MDN `color-scheme`: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/color-scheme
- MDN `prefers-reduced-motion`: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
- Next.js `loading.js`: https://nextjs.org/docs/app/api-reference/file-conventions/loading (docs now track Next 16; the convention is unchanged for the 15.5 in use here)
- React Suspense: https://react.dev/reference/react/Suspense

**Toasts and live regions**
- Material 3 snackbar: https://m3.material.io/components/snackbar/guidelines
- Adrian Roselli, "Defining Toast Messages": https://adrianroselli.com/2020/01/defining-toast-messages.html
- Sara Soueidan, accessible notifications with ARIA live regions: https://sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-1/
- Carbon, notification accessibility: https://carbondesignsystem.com/components/notification/accessibility/

**Tables and charts**
- Adrian Roselli, under-engineered responsive tables: https://adrianroselli.com/2020/11/under-engineered-responsive-tables.html
- GOV.UK Analysis Function, charts: https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-charts/
- GOV.UK Analysis Function, chart colours: https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-colours-in-charts/

**Tooling**
- axe-core rule descriptions: https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md
- axe `scrollable-region-focusable`: https://dequeuniversity.com/rules/axe/4.11/scrollable-region-focusable
- Playwright accessibility testing: https://playwright.dev/docs/accessibility-testing
- eslint-config-next rule set: https://github.com/vercel/next.js/blob/canary/packages/eslint-config-next/src/index.ts
- Deque automated-coverage study: https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/
- Lighthouse accessibility scoring: https://developer.chrome.com/docs/lighthouse/accessibility/scoring
- npm registry, for the version and date of `playwright` and `@axe-core/playwright`: https://registry.npmjs.org/playwright and https://registry.npmjs.org/@axe-core/playwright
