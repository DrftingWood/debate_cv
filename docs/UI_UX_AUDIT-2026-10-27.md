# UI/UX audit (2026-10-27)

This audit covers every route and shared component, measured against `docs/UI_UX_STANDARDS.md` (rule IDs such as **UX-8** point there). It is a docs-only change: no UI code was changed. The findings are for implementers to pick up. The proposed split into parallel tasks is at the end.

## How this was done

- **Code.** Every `.tsx` file under `app/` (except `app/api`) and `components/` was read in full: 14,957 lines across about 100 files. Line numbers were checked against `origin/main` at `8ab4509`.
- **Rendered pages.** The app was run against a throwaway Postgres 16 in Docker, following `CLAUDE.md` "Local development against real data": `prisma migrate deploy`, `npm run seed:dev`, the printed session cookie, and `next dev`.
  - `npm run a11y` (`scripts/a11y-smoke.mjs`, added in this PR) loaded 13 routes at 390 px and 1280 px, in light and dark. Signed-out routes ran without the cookie.
  - It ran axe-core 4.13 (bundled with `@axe-core/playwright` 4.13.0, on Playwright 1.64.0) with the WCAG 2.2 A/AA tags plus `best-practice`.
  - It also measured sideways overflow and targets under 24 px, and saved full-page screenshots.
  - The results are in the section "Rendered checks" below. The screenshots live in `.reports/a11y/`, which is git-ignored and not committed (they show seeded names).
- **Contrast.** Ratios were computed from the HSL tokens in `app/globals.css` for both themes.
- **Earlier audit.** `origin/claude/ui-ux-issues-audit-62ja8z` (2026-07-26, two commits, never merged) listed 18 defects found on rendered pages. Each was rechecked on `main`. Most are still present and are folded in below, marked *(July)*. The branch's fixes can be cherry-picked as a starting point, but it is three months behind `main` and touches `lib/cv/*`, so rebase it file by file rather than merging it.

**Priorities.**
- **P0:** blocks a task, or is a clear WCAG A/AA failure on a core path.
- **P1:** a significant accessibility or UX defect, or a misleading figure.
- **P2:** moderate.
- **P3:** polish or copy.

**Counts.** 7 P0, 36 P1, 60 P2, 31 P3: **134 findings**.

| Area | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| Navigation and shell (NAV) | 0 | 4 | 4 | 3 |
| Forms and onboarding (FORM) | 0 | 5 | 7 | 2 |
| Dashboard, ingest status and errors (DASH) | 0 | 6 | 7 | 4 |
| CV table and mobile cards (CV) | 0 | 3 | 7 | 5 |
| Stats and charts (STAT) | 3 | 7 | 9 | 5 |
| Motions page (MOT) | 0 | 0 | 2 | 1 |
| Settings (SET) | 1 | 5 | 7 | 2 |
| Public CV (PUB) | 1 | 0 | 5 | 2 |
| Admin, incl. /cv/tags and /cv/verify (ADM) | 0 | 1 | 7 | 3 |
| Empty, loading and error states (STATE) | 0 | 3 | 5 | 2 |
| Copy and privacy pages (COPY) | 2 | 2 | 0 | 2 |
| **Total** | **7** | **36** | **60** | **31** |

**The P0s.**
- STAT-1: the empty histogram.
- STAT-2: chart text, including `n=`, at about 2:1.
- STAT-3: thin-sample markers at about 2:1.
- SET-1: the unlabelled delete-account field.
- PUB-1: the public CV shows no results on a phone.
- COPY-1: privacy and terms are unreadable in dark.
- COPY-2: the retired-brand OG card on every shared CV link.

The known issue from the brief, the **"Scan failed" heading on the 2-minute cooldown**, is DASH-1 (P1). The **toast semantics** are DASH-2, and **focus management** is NAV-2, NAV-3, NAV-11, FORM-1, SET-3 and CV-4.

---

## 1. Navigation and shell

**NAV-1 [P1] The skip link and landmarks are wrong: the app header and footer render inside `<main>`.** `app/layout.tsx:112-123` wraps every route in `<main id="main">`. `app/(app)/layout.tsx:45` (`<header>`), `:84` (the Sections `<nav>`) and `:98` (`<Footer />`) render inside it, and so does the landing page's own header (`app/page.tsx:79`).
- **Why:** "Skip to content" lands on the header it exists to skip (SC 2.4.1). The banner and contentinfo landmarks vanish: a `header` inside `main` is not a banner (SC 1.3.1, UX-1).
- **Fix:** keep `<main>` out of the root layout. Render `<header>…</header><main id="main" className="flex-1">{children}</main><Footer/>` in `app/(app)/layout.tsx`, and the same shape in `app/page.tsx`, `app/sample/page.tsx` and `app/u/[slug]/layout.tsx`. The root keeps the skip link and the flex column.

**NAV-2 [P1] `NotificationBell` is `role="menu"` with no menu items.** `components/NotificationBell.tsx:123-144`: a `div role="menu"` containing a heading `div`, a `ul` and plain `Link`s.
- **Why:** axe `aria-required-children` (serious). The menu role promises arrow-key navigation that is not there (APG menu button; UX-5). Focus stays on the bell when the panel opens and is not returned on Escape.
- **Fix:** disclosure pattern. Drop `role="menu"`, set `aria-controls` on the button, render `<div id="notifications-panel" role="region" aria-label="Notifications"><ul>…`, focus the first link on open, and return focus to the bell on Escape.

**NAV-3 [P1] `UserMenu` is `role="menu"` with `menuitem`s but no menu keyboard model.** `components/UserMenu.tsx:63-121`: no arrow keys, no focus into the menu on open, no focus return; `aria-haspopup="true"`.
- **Why:** UX-5; APG.
- **Fix:** the same disclosure conversion as NAV-2 (a two-link list). Alternatively, keep the menu and implement the APG keyboard model, but the disclosure pattern is the APG's own recommendation for navigation.

**NAV-4 [P1] Twelve `<Link><Button/></Link>` nestings.**
- **Where:**
  - `app/(app)/cv/page.tsx:136-138, 201-205`
  - `app/(app)/cv/stats/page.tsx:92-94`
  - `app/(app)/cv/motions/page.tsx:107-109`
  - `app/(app)/error.tsx:47-51`
  - `app/not-found.tsx:16-18`
  - `app/page.tsx:120, 387`
  - `app/sample/page.tsx:63, 244`
  - `app/(app)/admin/page.tsx:129`
  - `app/(app)/admin/tags/page.tsx:45`
- **Why:** this is invalid interactive nesting (axe `nested-interactive`, SC 4.1.2). It creates two tab stops for one action and is announced as "link, button". It includes the landing page's primary "See a sample CV" call to action (UX-9).
- **Fix:** export `buttonClasses({ variant, size })` from `components/ui/Button.tsx` (the `base`, `variants` and `sizes` strings already exist) and apply it to the `Link`: `<Link href="/dashboard" className={buttonClasses({ variant: 'primary' })}>`.

**NAV-5 [P2] The desktop header nav has no accessible name.** `app/(app)/layout.tsx:51`. The mobile strip is labelled "Sections"; the desktop `<nav>` is not.
- **Fix:** `aria-label="Sections"` on both (only one is visible at a time).

**NAV-6 [P2] Signed-out visitors on `/privacy` and `/terms` get the signed-in nav.** `app/(app)/layout.tsx:54-58, 88-92`. Record, Statistics, Imports and Settings all bounce a signed-out visitor to `/`.
- **Why:** against `DESIGN_INSTRUCTIONS.md` §5 ("do not lead signed-out users into inaccessible app furniture").
- **Fix:** render the nav only when `session?.user?.id`. Signed out, show "Sample CV · Privacy · Build my CV".

**NAV-7 [P2] The back-to-top button is focusable while invisible.** `components/PageJumpNav.tsx:102-115` hides it with `opacity-0 pointer-events-none` but it stays in the tab order.
- **Why:** a keyboard user tabs onto an invisible control (SC 2.4.7).
- **Fix:** add `tabIndex={showTop ? 0 : -1}` and `aria-hidden={!showTop}`, or unmount it while hidden.

**NAV-8 [P2] The dashboard's tile and chip both claim `aria-current="page"` for the same URL.** `app/(app)/dashboard/page.tsx:466, 597`. On the bare `/dashboard` the "Private URLs" tile is also marked current, although no filter is applied.
- **Why:** UX-4.
- **Fix:** set `aria-current` on the chips only, and only while `browsing`.

**NAV-9 [P3] Two names for one page.** `/cv`'s title is "My CV" (`app/(app)/cv/page.tsx:36`) but the nav says "Record". Banners and onboarding say "dashboard" (`components/CvNeedsAttentionBanners.tsx:142`, `app/(app)/onboarding/page.tsx:70, 79`, `app/(app)/settings/reports/page.tsx:72`) where the nav says "Imports".
- **Fix:** title "Record"; replace "dashboard" with "Imports" in copy (UX-42).

**NAV-10 [P3] The `CvSubNav` fade mask hides its last tab.** `components/CvSubNav.tsx:35`, at 390 px. The mask cue exists, but nothing tells a screen-reader user there are more tabs. Low impact because every link is still in the DOM.
- **Fix:** none needed beyond checking at 320 px.

**NAV-11 [P3] Inconsistent popovers.** The account menu, bell, Share and Download popovers each re-implement outside-click and Escape (`UserMenu.tsx:35-49`, `NotificationBell.tsx:65-79`, `CvShareButton.tsx:48-63`, `CvDownloadButton.tsx:60-75`), and none moves or returns focus.
- **Fix:** one small `usePopover(triggerRef, panelRef)` hook in `components/ui/` that does all four, used by NAV-2, NAV-3, CV-4 and CV-5.

## 2. Forms and onboarding

**FORM-1 [P1] Changing onboarding steps drops focus to `<body>` and announces nothing.** `components/OnboardingFlow.tsx:229-392` swaps the whole card on `phase`; the button that was clicked no longer exists.
- **Why:** SC 2.4.3 and 4.1.3 (UX-7).
- **Fix:** put `ref` and `tabIndex={-1}` on each step's `h2` and focus it in a `useEffect` on `phase`.

**FORM-2 [P1] A scan that finds nothing is a dead end.** `components/OnboardingFlow.tsx:156-165`: phase stays `scan`; the only feedback is a 5 s toast.
- **Why:** first-run path (NN/g empty states; UX-24).
- **Fix:** render an inline empty state. "No tournament links found in this Gmail account." Then: "Paste a private URL instead" (link to `/dashboard`), "Signed in with a different Google account?" (sign-out link), and "Scan again".

**FORM-3 [P1] A failed preflight leaves the user on a spinner.** `components/OnboardingFlow.tsx:91-94`: on a failed request, a toast and `return`. The "Reading names" card spins forever.
- **Why:** NN/g heuristic 9.
- **Fix:** keep an `error` state. Render `role="alert"` text with "Try again" (re-run) and "Skip to picking names".

**FORM-4 [P1] Preflight counters update silently.** `components/OnboardingFlow.tsx:278-284`.
- **Why:** SC 4.1.3.
- **Fix:** add a single `role="status"` line, "12 of 40 tournaments read", updated at most every few seconds. Do not put `aria-live` on the counters themselves.

**FORM-5 [P1] Form-control borders fail 1.4.11.** These fields use the hairline `border-border` (16% alpha):
- `components/SharingManager.tsx:180`
- `components/AccountActions.tsx:122`
- `components/CvRowReportButton.tsx:223`
- `components/ParticipantSearch.tsx:132`
- `components/AdminTagProposals.tsx:283-287`
- `components/stats/StatsFilterBar.tsx:171, 210, 231`

The field edge measures 1.25:1 in light and 1.56:1 in dark. The `input` token in `tailwind.config.ts:16` (22%) is no better, about 1.4:1.
- **Why:** UX-18.
- **Fix:** raise the `input` colour token to about `hsl(var(--input) / 0.55)` (≈3:1 in light; check dark) and switch these fields to `border-input`. Leave `border-border` for table rules.

**FORM-6 [P2] Several focus states switch the global outline off for a ring that cannot be seen.**
- **Where:**
  - `focus:outline-none … focus:ring-primary/20` at `SharingManager.tsx:180` and `CvRowReportButton.tsx:223`
  - `ring-primary/30` at `ParticipantSearch.tsx:132`
  - `ring-destructive/40` at `AccountActions.tsx:122`
- **Why:** about 1.2-1.6:1, against the 7:1 global `:focus-visible` outline the code throws away (UX-10).
- **Fix:** delete `outline-none` and the faint ring, so the `globals.css:337` outline applies.

**FORM-7 [P2] Disabled submit buttons hide the reason.**
- **Where:**
  - "These are me — continue" (`OnboardingFlow.tsx:367-379`; the guiding toast at `:180-187` can therefore never fire)
  - "Send" on the report dialog (`CvRowReportButton.tsx:230-238`; needs a category or 8 characters, said nowhere)
  - "Re-ingest selected" (`DashboardActions.tsx:422`)
  - "Download" with no columns (`CvDownloadButton.tsx:268`)
- **Why:** UX-16; GOV.UK button guidance.
- **Fix:** leave each one enabled and show the requirement inline on submit ("Tick at least one name that is you"). Or keep it disabled and add a visible hint line tied to the button with `aria-describedby`.

**FORM-8 [P2] Checkboxes render in browser blue *(July)*.** `OnboardingFlow.tsx:333`, `IdentityManager.tsx:162` and `CvRowReportButton.tsx:198` use `rounded border-border text-primary focus:ring-*`. Those classes need `@tailwindcss/forms`, which is not installed. `CvDownloadButton.tsx:235, 256` uses `accent-current`.
- **Why:** an unbranded saturated blue against the one-accent rule (Ledger rule 4).
- **Fix:** `accent-primary h-4 w-4` everywhere, as `StatsFilterBar.tsx:196` already does.

**FORM-9 [P2] The onboarding step list is not marked up as progress.** `OnboardingFlow.tsx:406-423`: `<ol>` has no name; `aria-current="step"` is on an inner span; completed steps show only an `aria-hidden` icon; upcoming circles are `bg-ink/10 text-ink-soft`, which is ≈4.0-4.3:1 at 12.5 px.
- **Fix:** `aria-label="Setup progress"`, `aria-current="step"` on the `<li>`, sr-only "completed", and `bg-surface-3 text-ink` for upcoming steps.

**FORM-10 [P2] `refreshNames` ignores failures.** `OnboardingFlow.tsx:120-141` does not check `r.ok`, so an API failure shows "No names extracted", which is false. It is also called twice on entering `pick` (`:110` and `:144`).
- **Fix:** drop the duplicate call. On error, show the error and a Retry, not the empty state.

**FORM-11 [P2] The onboarding scan step states only one of the §10 privacy facts.** `OnboardingFlow.tsx:240-244` says "read-only" but not "email bodies are not stored", "disconnect any time" or "private until shared".
- **Fix:** add one `data-label` row: "Read-only · email bodies never stored · disconnect in Settings · private until you share".

**FORM-12 [P2] Report dialog: the error toast may be unreachable under `aria-modal`.** `CvRowReportButton.tsx:169-175` sends "Report not sent" to a toast that lives outside the `aria-modal` dialog, and it auto-dismisses after 5 s. VoiceOver ignores content outside a modal.
- **Fix:** render the error inside the dialog as `role="alert"` text above the buttons.

**FORM-13 [P3] The sign-in form has no pending state.** `app/page.tsx:39-57`: a double tap starts OAuth twice, with no feedback in between. `ReconnectGmailButton.tsx:191-196` only sets `isPending` after a dynamic import resolves.
- **Fix:** a small client submit button using `useFormStatus()` that sets `loading`.

**FORM-14 [P3] The search input is not a search field and has no visible label.** `ParticipantSearch.tsx:128` uses a placeholder only. `UnmatchedRowExpand.tsx:40-46` does not focus the search when it opens.
- **Fix:** `type="search"`, a visible label "Search the participant list for {tournamentName}", and `autoFocus` when expanded.

## 3. Dashboard (Imports), ingest status and errors

**DASH-1 [P1] The harmless 2-minute cooldown is shown as "Scan failed".**
- **Where:** `components/DashboardActions.tsx:59` throws `scanErrorMessage(…)`; `:74-80` renders it as `kind: 'error'`, `title: 'Scan failed'`. `lib/ingest/scanErrorMessage.ts:11-13` writes friendly text that then lands under a failure heading in red.
- **The data exists:** the server sends `retryAfter` in the body and in a `Retry-After` header (`app/api/ingest/gmail/route.ts:42-46`, `lib/rateLimit.ts:161-172`). `lib/utils/api.ts:36-41` throws it away, keeping only `error`.
- **Why it happens often:** `AutoScanOnVisit` on `/cv` (`components/AutoScanOnVisit.tsx:50-56`) uses up the cooldown, so the next deliberate click is refused. Its comment says the cooldown is 5 minutes; the server's is 2.
- **Why it matters:** NN/g heuristics 1 and 9; UX-21.
- **Fix:**
  1. `postJson` returns `retryAfterSec` (from the body's `retryAfter` or the header) on a non-OK result.
  2. `scanErrorMessage` returns `{ kind: 'info' | 'error', title, description, retryAfterSec? }`. For 429: `kind: 'info'`, title "Scanned a moment ago", description "You can scan again in 1:42."
  3. `ScanButton` keeps a `cooldownUntil` state. The button shows "Scan again in 1:42", ticks every second, is `disabled` with that text as its visible reason, and re-enables at 0. No error toast.
  4. Extend `tests/ingest.scanErrorMessage.test.ts`.
  5. Correct the 5-minute comment in `AutoScanOnVisit`.

**DASH-2 [P1] The toast system breaks four rules at once.** `components/ui/Toast.tsx`:
- **Nested live regions:** the viewport is `aria-live="polite" aria-atomic="true"` (`:83-84`) and each card is also `role="alert"` or `role="status"` (`:104`). Messages are read twice or not at all. `aria-atomic` on the container re-reads every visible toast when one is added (UX-19).
- **Everything auto-dismisses at 5 s** (`:50`): errors, and toasts with an action link ("View your CV", `DashboardActions.tsx:273`). No pause on hover or focus. This fails SC 2.2.1 (UX-20).
- **The dismiss button is a 16×16 px target** (`:126-133`; SC 2.5.8, UX-8).
- **The action is a raw `<a href>`** (`:118`), so it does a full page reload instead of `next/link`.
- **Fix:**
  - One `role="status"` viewport, with no live attributes on the cards. Errors go to a second, always-present `role="alert"` region.
  - `kind: 'error'` and any toast with `action` do not auto-dismiss. Others pause the timer on `mouseenter`/`focusin`.
  - Dismiss button: `h-8 w-8 coarse:h-11 coarse:w-11` with a centred icon.
  - Use `Link` for the action.

**DASH-3 [P1] The ingest progress bar has no name and the whole section is a polite live region on a 5-second poll.** `components/IngestProgressTracker.tsx:103-106, 121-127`.
- **Why:** axe `aria-progressbar-name` (serious). Every poll re-announces the ETA and counts, talking over whatever the user is doing (UX-19, UX-22).
- **Fix:**
  - `aria-label="Import progress"` on the bar.
  - Remove `aria-live` from the section.
  - Add an sr-only `role="status"` line that changes only when `completed` crosses a milestone or the queue empties ("Imports finished: 23 processed, 1 failed").

**DASH-4 [P2] The row actions "Ingest", "Re-ingest", "Clear", "Lock" and "Unlock" are 20 px tall.** `app/(app)/dashboard/page.tsx:495-520` uses `variant="link" size="sm"` buttons (`DashboardActions.tsx:235, 301, 468`). `components/ui/Button.tsx:85` gives the `link` variant no size classes at all, so even `coarse:` does not enlarge them.
- **Measured:** 53×20 ("Lock") and 87×20 ("Re-ingest"), 14 of each at 1280 px. axe's `target-size` passed them under the spacing exception, because the rows are far apart vertically.
- **Why:** UX-8. They pass 2.5.8 only by luck of layout, and they are the dashboard's main per-row controls.
- **Fix:** in `Button.tsx`, give `link` a minimum box: `inline-flex min-h-6 coarse:min-h-[44px] px-1`. Use `gap-3` in `RowActions`.

**DASH-5 [P1] Raw error codes reach the screen.**
- **Where:**
  - `description: result.error` in toasts: `DashboardActions.tsx:189, 246, 311, 372, 438, 481`; `RetryFailedButton.tsx:35`; `ReingestButton.tsx:32`; `CvShareButton.tsx:69`
  - The raw `job.lastError` in red under each failed row: `dashboard/page.tsx:358-362, 416-423`
  - `postJson` falling back to the first 200 characters of an HTML error page: `lib/utils/api.ts:37-39`
- **Why:** NN/g error messages; GOV.UK "never 'An error occurred'" (UX-23).
- **Fix:**
  - Add `lib/ingest/userMessage.ts`, which maps known codes (`rate_limited`, `unauthorized`, `bad_request`, `not_a_private_url`, `HTTP 5xx`, network) to a sentence and a next step, with a unit test.
  - For `lastError`, show a category ("The tab site did not respond", "This page no longer exists") and keep the raw text behind a `<details>` "Technical detail".

**DASH-6 [P1] A scrape warning is shown as an error, with an emoji.** `DashboardActions.tsx:277-283`: `kind: 'error'`, title "⚠ Scrape warnings". It arrives as a third toast after two success toasts from the same click (`:252, :266`).
- **Why:** severity mismatch (NN/g), and three toasts for one action.
- **Fix:** one toast per action. Warnings go into its description as `kind: 'info'`, and the row shows a persistent amber "Partial data" marker.

**DASH-7 [P1] The dashboard table has no headers semantics or name, and its scroll region is not focusable.** `app/(app)/dashboard/page.tsx:371-441` is a raw `<table className="ledger … min-w-max">` with bare `<th>` and no caption, inside `overflow-x-auto` with no `tabIndex`.
- **Why:** UX-28, UX-29; axe `scrollable-region-focusable`.
- **Fix:** rebuild it on `DataTable` (`TableScroll`, `Table label="Imported tournament links"`, `Th`, `Td`), which picks up NAV-free fixes from STATE-3.

**DASH-8 [P2] "Clear" resets a URL's ingest with no confirmation.** `DashboardActions.tsx:293-328`.
- **Why:** UX-17.
- **Fix:** an inline "Clear this import? The tournament stays on your record until you ingest it again. Clear / Cancel" step, or make the result undoable.

**DASH-9 [P2] Button text that changes during a long run is not announced.** `IngestAllButton` (`DashboardActions.tsx:131-135`, "Ingesting… 7/23") and `ScanButton` (`:85`). Only sighted users see progress; there is a Stop button, but its state is not announced either.
- **Fix:** mirror the progress into the DASH-3 status line rather than relying on the button label.

**DASH-10 [P2] The empty state contradicts the Gmail-disconnected banner.** `dashboard/page.tsx:227-232`: "Click Scan Gmail…" shows while `ScanButton` is disabled because Gmail is disconnected.
- **Fix:** when `!gmailToken`, say "Reconnect Gmail, or upload a CSV of private URLs".

**DASH-11 [P2] Tournament names and URLs on the mobile cards are truncated with no way to read them.** `dashboard/page.tsx:325, 336` (confirmed in the 390 px screenshot: "World Universities Debating C…").
- **Fix:** `line-clamp-2 break-words` for the name. The URL can stay truncated: the link opens it.

**DASH-12 [P2] The filter chips are under 44 px on touch.** `dashboard/page.tsx:468` (about 28 px; they pass 24 px).
- **Fix:** `coarse:min-h-[44px]`, as `NavLink` does.

**DASH-13 [P2] `AutoScanOnVisit` fires for users with no Gmail token *(July)*.** `components/AutoScanOnVisit.tsx:50-56` makes a request that always 400s and logs a console error on every `/cv` visit.
- **Fix:** pass `enabled={!!gmailToken}` from `app/(app)/cv/page.tsx:122`.

**DASH-14 [P3] "Tournaments in flight" heads the page in the steady state *(July)*.** `dashboard/page.tsx:145`.
- **Fix:** "Imports" when nothing is pending; "Importing N tournaments" while busy.

**DASH-15 [P3] The "⚠ No data scraped" line uses a glyph for its warning.** `dashboard/page.tsx:536`.
- **Fix:** a lucide `AlertTriangle aria-hidden` with the text "No data scraped" (UX-34).

**DASH-16 [P3] The Failed tile hint "retry from the chip below" points at a chip that only appears after another click.** `dashboard/page.tsx:215`.
- **Fix:** "open Failed to retry".

**DASH-17 [P3] Dates use the browser locale.** `dashboard/page.tsx:347, 426` (`toLocaleDateString()`, which renders 20/5/2025 in the screenshots), while the CV header uses `en-GB` day-month-year.
- **Fix:** one `formatDate` helper.

## 4. CV table and mobile cards

**CV-1 [P1] Mobile cards truncate tournament names, team names and partners, and keep the full text only in `title`.** `app/(app)/cv/page.tsx:625-632, 746-753` (name), `:789-797` (`Field`: `dd` is `truncate` with `title`).
- **Measured:** the card-title links are 23 px tall, under the 24 px floor (14 instances at 390 px). This is the July finding, reproduced.
- **Why:** a phone is the primary device, and touch never shows `title` (UX-30, UX-36). Partners and team names are the facts most likely to be long.
- **Fix:** `Field` uses `break-words` (no `truncate`). Card titles use `line-clamp-2` with `inline-flex min-h-6`.

**CV-2 [P1] The speaking ledger is wider than a 1280 px viewport, and the gap has grown *(July, "still open")*.** `app/(app)/cv/page.tsx:477` (`min-w-max`, 13 columns). Measured at 1280 px: the table is 1,369 px inside a 1,238 px box, 131 px over (July measured about 80). There is no scroll cue (see STATE-3).
- **Why:** the Report column, and at narrower desktop widths the Result column, sit off-screen with nothing saying so (UX-29).
- **Fix:** merge "Pts" into "Team rank" as `#3 · 18 pts`, or drop the "Teams" column (it repeats inside the rank's "of N"), and add the STATE-3 scroll shadows.

**CV-3 [P1] Tournament links open a new tab without saying so; the icon is invisible until hover.** `app/(app)/cv/page.tsx:512-524` (`opacity-0 … group-hover:opacity-60`), and the mobile cards `:625-632`, `:746-753`, which have no icon at all.
- **Why:** UX-43 (WCAG G201).
- **Fix:** show the `ExternalLink` icon at full `text-ink-soft` and add `<span className="sr-only"> (opens in new tab)</span>`.

**CV-4 [P2] The Share popover does not take focus and fails silently on copy.** `components/CvShareButton.tsx:99-186`:
- `role="dialog"` but focus stays on the trigger and is not returned.
- "Loading…" (`:106`) is not announced.
- `navigator.clipboard.writeText` has no `.catch` (`:150-152`), so a blocked clipboard does nothing visible.
- **Fix:** move focus to the panel's first control on open and back on Escape (NAV-11); `role="status"` on the loading line; on failure, select the URL text and say "Press Ctrl+C to copy".

**CV-5 [P2] Download popover: focus not managed; the All/None buttons are tiny.** `components/CvDownloadButton.tsx:156-276`. "All" and "None" (`:205-218`) are bare text buttons about 15×18 px, 8 px apart.
- **Fix:** NAV-11 for focus. Give All/None `min-h-6 px-1.5` (UX-8).

**CV-6 [P2] The "Reported" badge is a live region in a static table.** `app/(app)/cv/page.tsx:319` puts `role="status"` on every reported row.
- **Why:** UX-19. It is not a status message.
- **Fix:** drop `role="status"`. Keep the `aria-label`, or better, put visible text "Reported" with no label.

**CV-7 [P2] The team placement and the column explanations are hover-only on the desktop ledger.** `app/(app)/cv/page.tsx:543` (`title` "3 of 40 teams · top 8%") and `:486-496` (`Th title`). The paragraph at `:232-241` covers the headers, but not the placement.
- **Fix:** render `#3<span className="text-ink-soft">/40</span>` inline, as the mobile card does (`:653`).

**CV-8 [P2] Mobile cards repeat the break.** `app/(app)/cv/page.tsx:637-638` shows a "Broke" badge next to the outround text. Desktop moved the label inside the gold badge (`:580-588`) for exactly this reason.
- **Fix:** `<Badge variant="gold">{outround ?? 'Broke'}</Badge>` on mobile too.

**CV-9 [P2] The round-ledger motion text exists only in `title` when a round has several motions.** `app/(app)/cv/page.tsx:414-421` ("+1 more this round").
- **Fix:** a nested `<details>` listing all motions, or show each on its own line.

**CV-10 [P2] The "compiled" date is the render date, not the data date.** `app/(app)/cv/page.tsx:114-118, 150`: "Debate record · compiled 27 Oct 2026" changes on every visit.
- **Why:** reads as a fact about the data.
- **Fix:** use the latest `ingestedAt` ("updated 12 Oct 2026").

**CV-11 [P3] The record's `h1` is the user's name with no context for a screen reader.** `app/(app)/cv/page.tsx:151-153`. The `data-label` above it is not part of the heading.
- **Fix:** `<h1><span className="sr-only">Debate record of </span>{name}</h1>`.

**CV-12 [P3] "Report" is the same accessible name in every row on mobile.** `CvRowReportButton.tsx:122-123` sets `aria-label` only when `iconOnly`; on mobile the name is just "Report" (UX-11).
- **Fix:** always set `aria-label={`Report a problem with ${tournamentName}`}`, which keeps the visible word.

**CV-13 [P3] The round-ledger summary chevron animates without regard to reduced motion.** `app/(app)/cv/page.tsx:379` (`transition-transform`). It is covered by the global guard (`globals.css:368`), so this is fine. Listed so the guard is not removed.

**CV-15 [P3] The Report column header is empty (axe `empty-table-header`).** `app/(app)/cv/page.tsx:498, 691`: `<Th aria-label="Report" />` has no text.
- **Fix:** `<Th><span className="sr-only">Report a problem</span></Th>`.

**CV-14 [P3] The Gmail-disconnected banner on `/cv` is a section labelled the same as its visible label.** `app/(app)/cv/page.tsx:124-139`. It duplicates the dashboard banner's code.
- **Fix:** extract a `GmailDisconnectedNotice` and use `role="region" aria-labelledby` on its visible title (GOV.UK notification banner).

## 5. Stats and charts

**STAT-1 [P0] The score histogram draws no bars *(July)*.** `components/ui/BarList.tsx:153-165`: the column wrapper is a flex item of `flex h-28 items-end`, so it never stretches, and the bar's `height: N%` resolves against an indefinite height, giving 0 px. Measured in the rendered page: all 12 bars are 0 px tall at both 390 and 1280 px. `/cv/stats` ships an empty chart. Even when the bars are fixed:
- The "your average" bin is marked by colour alone (`bg-primary` vs `bg-ink/15`, `:162`; caption "the highlighted one" at `components/stats/StatsSections.tsx:180`).
- The other bars are about 1.3:1.
- The chart has no text alternative.
- **Why:** SC 1.1.1, 1.4.1, 1.4.11 (UX-32 to UX-34).
- **Fix:**
  - Drop `items-end` (let the columns stretch; keep `justify-end`).
  - Use `bg-ink/40` for the other bars.
  - Add a visible "▲ you" `data-label` under the highlighted bin.
  - `role="img"` with an `aria-label` listing bins and counts.

**STAT-2 [P0] Chart text fails contrast, including the sample size.** `components/ui/TrendChart.tsx:139, 180, 221, 233` render `<text>` at `fillOpacity` 0.45, 0.5, 0.55 and 0.38. That is about 2.9, 3.3 and 3.9:1 in light, and 2.1:1 for the `sub` line. The `sub` line carries `n=` (`StatsSections.tsx:547`) and "N events" (`:823`), which §9 requires to be visible.
- **Why:** SC 1.4.3 (UX-33, UX-35).
- **Fix:** `fill="hsl(var(--muted-foreground))"` on every `<text>`. Opacity only on gridline `<line>`s.

**STAT-3 [P0] Thin-sample markers in the cross-tabs are about 2:1.** `components/stats/CrossTabsSection.tsx:61, 68` and `components/stats/TopicTypeSection.tsx:29, 37` use `text-ink-soft/50` and `/60`: about 2.0-2.2:1 in light and 2.5:1 in dark. The round count behind the "·" is only in `title`.
- **Why:** SC 1.4.3, 1.4.13; §9.
- **Fix:** full `text-ink-soft`, and print the count: `· 3 rds`.

**STAT-4 [P1] `TrendChart` text shrinks to about 6 px on a phone.** `components/ui/TrendChart.tsx:55, 110-112`: the fixed 640-unit `viewBox` is scaled to the panel width (about 326 px at 390), so `fontSize={12}` renders at about 6 px. Measured: the first axis label's box is 8 px tall at 390 px and 24 px at 1280 px.
- **Why:** SC 1.4.4 / 1.4.10.
- **Fix:** measure the container (a `ResizeObserver` in a small client wrapper) and set the `viewBox` width to the real width. Or draw the labels as HTML overlays.

**STAT-24 [P1] `/cv/stats` scrolls sideways on a phone (found by rendering).** At 390 px the document is 770 px wide. The cause: the "Info slides" and "Framing" blocks are grid items (`components/stats/StatsViews.tsx:249-261`, `grid gap-6 lg:grid-cols-2`) without `min-w-0`, so each grows to its `min-w-max` table (664 px) instead of letting the table scroll inside its panel.
- **Why:** SC 1.4.10; Ledger "the page body must never scroll sideways" (UX-39). The whole page, not just the table, pans.
- **Fix:** `min-w-0` on the two `div.space-y-2` grid items (and on any other grid child that holds a `TableScroll`).

**STAT-5 [P1] Split tables have two columns headed "vs you", in different units *(July)*.** `components/StatsSplitTable.tsx:56-60`. One is percentage points, one speaker points; the unit is only in `title`.
- **Why:** UX-31, a misleading figure.
- **Fix:** "vs you (pp)" and "vs you (pts)".

**STAT-6 [P1] The engine splits mark "thin" below 4 rounds while findings need 6 *(July, partly fixed)*.** `StatsSplitTable.tsx:20` (`thinBelow = 4`) and `StatsSections.tsx:797-801` (no override). `StatsViews.tsx` already passes `MIN_SPLIT_ROUNDS`.
- **Why:** §9 rules 1 and 3.
- **Fix:** default `thinBelow` to `MIN_QUIRK_ROUNDS`.

**STAT-7 [P1] The pressed state of filter chips is nearly invisible.** `components/stats/StatsFilterBar.tsx:107` and `components/stats/CrossTabsSection.tsx:169`: pressed is `bg-card` against `bg-surface-2` (about 1.04:1).
- **Why:** SC 1.4.11, 1.4.1.
- **Fix:** pressed = `bg-ink text-paper` (as the dashboard chips do) or `ring-1 ring-primary bg-primary/10`, plus a check glyph. List the active filters in the summary sentence (`FilterableStats.tsx:103-105`).

**STAT-8 [P1] A signed zero shows as a coloured "−0.0".** `components/stats/StatsSections.tsx:422, 430, 478-480, 485, 577, 592`: sign by `> 0 ? '+' : '−'` and colour by `>= 0`, so 0 becomes a green "−0.0".
- **Why:** UX-34; colour must mean up or down.
- **Fix:** reuse `signed()` from `StatsViews.tsx:39-43` (sign by the rounded value) and use `val-flat` when it rounds to 0. Also see AI-1 in `CODING_STANDARDS.md`: `signed` is already defined six times.

**STAT-9 [P1] Thin rows still print a headline win rate.** `StatsSplitTable.tsx:82` prints a muted "100%" over 2 rounds.
- **Why:** §9 rule 1.
- **Fix:** print `n = 2` in the win-rate and delta cells when thin, as `TeammatesSection` does (`StatsViews.tsx:187-193`).

**STAT-10 [P2] Wide stats tables are not keyboard-scrollable and lose their row labels on a phone.** `components/ui/DataTable.tsx:24` (see STATE-3) and every `min-w-max` stats table; `StatsSplitTable.tsx:49` has 8 columns.
- **Fix:** STATE-3, plus `sticky left-0 bg-card` on the first column of split tables.

**STAT-11 [P2] Hover-only content across the stats views.** All of these keep the full text only in `title` (UX-36):
- `StatTile.tsx:84` (truncated label, *July*)
- `BarList.tsx:52` (it also truncates the sample note passed as `detail` from `JudgingViews.tsx:145`)
- `StatsSections.tsx:241, 319-321, 456-458`
- `StatsViews.tsx:168`
- `CareerViews.tsx:257, 271, 285, 299, 313` ("X and N more")
- `BreakViews.tsx:68`
- `StatsFilterBar.tsx:198`
- **Fix:** `break-words` instead of `truncate`. Use a `<details>` for "and N more".

**STAT-12 [P2] The `TrendChart` accessible name lacks the measure and the sample sizes.** `TrendChart.tsx:114`. The visible titles (`StatsSections.tsx:358, 506, 840`) are not associated with the chart.
- **Fix:** a `title` prop rendered as `<title>`, with `baselineLabel` and `n` in `<desc>`.

**STAT-13 [P2] Gold on a non-break.** `components/stats/StatsViews.tsx:175`: `<Badge variant="gold">Pro ×N</Badge>`.
- **Why:** Ledger rule 3 (gold = a break).
- **Fix:** `variant="neutral"`.

**STAT-14 [P2] "Back" does not undo a filter, contrary to the comment.** `FilterableStats.tsx:73, 91` uses `replaceState`, so filters add no history entries.
- **Fix:** `pushState`, or correct the comment.

**STAT-15 [P2] Heading levels skip.** `app/(app)/cv/stats/page.tsx:87` (the `EmptyState` `h3` straight after the `h1`).
- **Fix:** STATE-5.

**STAT-16 [P2] The empty header cell and blank column in split tables.** `StatsSplitTable.tsx:61, 103` render an empty `<th>` and blank cells when `!showPoints`.
- **Why:** UX-27; axe `empty-table-header`.
- **Fix:** omit the column.

**STAT-17 [P2] Stats tables have no row headers.** The first column is `Td` in every stats table.
- **Fix:** add a `Th scope="row"` variant to `DataTable` and use it (UX-28).

**STAT-18 [P2] An odd tile count leaves a grey hole on mobile.** `components/ui/StatTile.tsx:125`: a two-column `StatRow` with an odd number of tiles shows an empty `bg-border` cell.
- **Fix:** `[&>*:last-child:nth-child(odd)]:col-span-2`.

**STAT-19 [P3] Jargon and terse units.**
- Δ and z headers (`StatsSections.tsx:446-447`): use "vs field" and "z-score", or `<abbr>`.
- "12r" (`CrossTabsSection.tsx:102`, `TopicTypeSection.tsx:53`): use "12 rds".
- "thin" (`StatsSplitTable.tsx:76`): use "few rounds".
- The finding copy says "points more often" for a percentage-point gap (`lib/cv/speakerStats.ts:1212`, *July*). That one line is in `lib/cv`; the change is copy only and does not touch parsing, so `PARSER_VERSION` is unaffected.

**STAT-20 [P3] The hint "Points above the field mean" shows even when the value is negative.** `StatsSections.tsx:425, 431`.
- **Fix:** "vs the field mean".

**STAT-21 [P3] Mutually exclusive toggles use `aria-pressed`.** `CrossTabsSection.tsx:159-165`.
- **Fix:** `role="radiogroup"` with `role="radio"` and `aria-checked` (APG).

**STAT-22 [P3] The partner dropdown overflows at 320 px.** `StatsFilterBar.tsx:184` (`min-w-[16rem]`).
- **Fix:** `min-w-[min(16rem,100%)]`.

**STAT-23 [P3] The stats skeleton is wider than a phone.** `app/(app)/cv/stats/loading.tsx:16, 20` (`w-72`, `w-96`). See STATE-2.

## 6. Motions page

**MOT-1 [P2] Tournament names in the `<summary>` are truncated with no way to read them.** `app/(app)/cv/motions/page.tsx:182`.
- **Fix:** `break-words`, or `line-clamp-2` at most.

**MOT-2 [P2] A caveat about the motion's data lives only in `title`.** `motions/page.tsx:221` ("round data may not apply to this motion").
- **Fix:** render it as caption text under the badge.

**MOT-3 [P3] The loading skeleton always draws 4 columns; non-admins see 3.** `app/(app)/cv/motions/loading.tsx:19` vs `page.tsx:147`. It is also wider than a phone (`:13, 17`, `w-80`/`w-96`; STATE-2).

## 7. Settings

**SET-1 [P0] The delete-account confirmation field has no label.** `components/AccountActions.tsx:116-123`: its only label is a placeholder containing the email. The instruction text at `:110` is not linked to it.
- **Why:** SC 1.3.1, 3.3.2, 4.1.2 on the most destructive action in the product (UX-13).
- **Fix:**
  - `<label htmlFor="delete-confirm">Type {email} to confirm</label>`.
  - `aria-describedby` pointing at the warning.
  - `aria-invalid` while the value does not match.
  - `autoCapitalize="none" spellCheck={false}`.

**SET-2 [P1] A user with no email can never delete their account.** `AccountActions.tsx:99-100, 125-131`: "Permanently delete" stays disabled when `userEmail` is null, with no reason given.
- **Why:** blocks a task; UX-16.
- **Fix:** fall back to typing "DELETE". Keep the button enabled and validate on press, with inline text.

**SET-3 [P1] Disconnect and Delete lose focus on open and on Cancel.** `AccountActions.tsx:16-27, 58, 86-97, 145-155`: the trigger unmounts and the confirm panel replaces it. Cancel unmounts it again.
- **Why:** SC 2.4.3 (UX-7, UX-17).
- **Fix:** focus the confirm field (or the Cancel button, the safe default) on open, and focus the trigger on Cancel.

**SET-4 [P1] Slug errors appear only as a 5-second toast.** `components/SharingManager.tsx:81-96, 173-195`. The field has no `aria-invalid`, and its rules text (`:193`) is not linked.
- **Why:** SC 3.3.1, 3.3.3; GOV.UK error message (UX-15).
- **Fix:** keep `slugError` in state and render `<p id="slug-error">` under the field ("That address is taken. Try maya-rao-2."). Set `aria-describedby="slug-hint slug-error"` and `aria-invalid`, and focus the field.

**SET-5 [P1] The sharing switches' off state is invisible.** `SharingManager.tsx:236-245`: the off track is `bg-ink/10` (about 1.2:1) and the thumb `bg-background` (about 1.1:1).
- **Why:** SC 1.4.11.
- **Fix:** off track `bg-ink-soft/40` with a `border-ink-soft`; thumb with `shadow-sm` and a border.

**SET-6 [P1] Unticking every name and saving removes the whole record without warning.** `components/IdentityManager.tsx:184-198`.
- **Why:** UX-17.
- **Fix:** when the save unclaims anything, confirm inline: "This removes N tournaments from your record. Remove / Cancel".

**SET-7 [P2] The switch names do not match their visible labels, and touch sizing distorts the switch.** `SharingManager.tsx:125, 208` are named "Toggle public sharing" and "Toggle avatar visibility" next to the visible "Public sharing" (SC 2.5.3). On a coarse pointer, the global `button { min-height: 44px; min-width: 44px }` (`globals.css:246-250`) probably stretches the `h-6 w-11` track.
- **Fix:** `aria-labelledby` pointing at the visible label. Wrap the track in a 44 px transparent hit area and exempt `[role=switch]` from the global rule.

**SET-8 [P2] Slug field details.** `SharingManager.tsx:171-191`:
- It is not in a `<form>`, so Enter does nothing.
- Phones capitalise the first letter (no `autoCapitalize="none"`), and validation then fails (UX-14).
- The `/u/` prefix is not in the label.
- **Fix:** wrap it in `<form onSubmit>`, add the attributes, and put the prefix in the label.

**SET-9 [P2] The sharing load error is a raw "HTTP 500" with no retry; loading is not announced.** `SharingManager.tsx:105-110`.
- **Fix:** `role="alert"` with plain text and a Retry button (as `IdentityManager.tsx:118-133` does), and `role="status"` on "Loading…".

**SET-10 [P2] Saving identities replaces the list with a spinner, losing focus.** `IdentityManager.tsx:105, 109-116`.
- **Fix:** refetch without unmounting (`aria-busy` on the list); after saving, announce "Saved: 3 names" in a status line.

**SET-11 [P2] The identity checkbox list has no group name.** `IdentityManager.tsx:152`.
- **Fix:** `<fieldset><legend className="sr-only">Names that are you</legend>`.

**SET-12 [P2] Every settings page has the same title, and the heading order is reversed.** `app/(app)/settings/layout.tsx:6-8` (title "Settings"; no sub-page exports metadata) and `:33` (an `h2` "Settings" above each page's `h1`).
- **Why:** UX-2, UX-3.
- **Fix:** per-page `metadata.title` ("Profile", "Sharing", "Account", "Reports"); render the layout's "Settings" as a non-heading `data-label`, or as the `h1` with each page's title as `h2`.

**SET-15 [P2] The "Your data" list is invalid `dl` markup (axe `definition-list`, serious).** `app/(app)/settings/account/page.tsx:111, 162-170`: each `DataStat` wraps `dt`/`dd` in a `div` (allowed) but adds a hint `div` after the `dd` (not allowed). The term's `title` (`:163`) repeats the hint.
- **Fix:** make the hint a second `<dd>` and drop the `title`.

**SET-13 [P3] Settings tabs wrap "Public sharing" onto two lines at 390 px *(July)*.** `components/SettingsSideNav.tsx:22, 27`.
- **Fix:** `shrink-0` on the `li` and `whitespace-nowrap` on the link.

**SET-14 [P3] The account tiles cramp at 320-390 px; figures use display type.** `app/(app)/settings/account/page.tsx:111` is `grid-cols-3` at every width; `:166` uses `font-display font-semibold`, not `.figure`.
- **Fix:** `grid-cols-1 sm:grid-cols-3` and `.figure`.

## 8. Public CV (`/u/<slug>`)

**PUB-1 [P0] There is no mobile layout: the desktop table renders at 390 px *(July)*.** `app/u/[slug]/page.tsx:215-291` uses `TableScroll` with no card alternative. Rendered at 390 px, the speaking table shows only **Tournament** and **Year**. Every score, rank and break sits off the right edge, with no cue that the table scrolls (and, per STATE-3, it cannot be scrolled from the keyboard).
- **Why:** this is the shareable artifact, the page most likely to be opened on a phone from a message. A recipient reads a list of tournament names and never sees a result (UX-30). That blocks the page's one job.
- **Fix:** reuse `/cv`'s card markup (`app/(app)/cv/page.tsx:617-669`). Extract it into a shared `TournamentCard` so both pages stay in step.

**PUB-2 [P2] At 1280 px the Result column has no room to spare *(July, mostly fixed)*.** `app/u/[slug]/page.tsx:217`: `min-w-max` inside a `max-w-5xl` wrapper (`layout.tsx:24`). Format is now abbreviated ("BP"), and with the seed data the table fits at 1280 px. But "Final (Champion)" runs into the panel's right edge. A multi-category result ("Open: Octofinals · ESL: Grand Final") or a long team name would push Result off-screen again, because `max-w-[10rem] truncate` on a `td` (`:252`) is ignored by auto table layout.
- **Fix:**
  - Wrap the team cell's contents in `<span className="block max-w-[10rem] truncate">`.
  - Let the tournament name wrap.
  - Add the STATE-3 scroll shadows.

**PUB-3 [P2] The theme toggle is a dead control *(July)*.** `app/u/[slug]/layout.tsx:23` pins `data-theme="light"` on the wrapper; `ThemeToggle` flips `<html>`. The button changes its own icon and nothing else (`page.tsx:165-167`).
- **Fix:** remove it from `/u` (forced light is the intended print-like look).

**PUB-4 [P2] Team placement and column explanations are hover-only.** `app/u/[slug]/page.tsx:224-225, 257-262`. A bare "#5" lacks the field size that §9 asks for.
- **Fix:** `#5<span className="text-ink-soft">/40</span>` inline, plus a visible legend.

**PUB-5 [P2] "Did not break" renders as an em dash.** `app/u/[slug]/page.tsx:279-283`.
- **Why:** UX-27; the dash means "not published".
- **Fix:** "Did not break" (or "Prelims") in `text-ink-soft`.

**PUB-6 [P2] An enabled CV with no rows renders only its header.** `app/u/[slug]/page.tsx:203-346`.
- **Fix:** `EmptyState` "No tournaments on this record yet."

**PUB-7 [P3] The avatar `alt` duplicates the name in the `h1` beside it.** `page.tsx:175`.
- **Fix:** `alt=""`.

**PUB-8 [P3] "N verified tournaments" counts discovered URLs, not tournaments.** `page.tsx:191-193`. It can disagree with the Tournaments tile.
- **Fix:** use `summary.totalTournaments`.

## 9. Admin (`/admin`, `/admin/tags`, `/cv/tags`, `/cv/verify`)

Operator-only surfaces, so most findings are P2.

**ADM-1 [P1] "Approve all" empties the list even when a pass failed.** `components/AdminTagProposals.tsx:87-97` calls `setProposals([])` unconditionally. The page then says "No pending proposals" while some remain.
- **Why:** a false status (NN/g heuristic 1).
- **Fix:** clear only on full success; otherwise refetch.

**ADM-2 [P2] Per-row controls have identical names and no in-flight guard.** `AdminTagProposals.tsx:258-290`: Approve/Reject have no row context, the reject-note input is placeholder-only, and a double click posts twice.
- **Fix:** contextual `aria-label`s, a per-row pending id, and a label for the note.

**ADM-3 [P2] The status filter buttons show selection by colour only.** `AdminTagProposals.tsx:151-166`. The table at `:208-221` is off-ledger (no `scope`, no caption).
- **Fix:** `aria-pressed`, and `DataTable`.

**ADM-4 [P2] The `/admin/tags` header forces sideways scroll at 390 px.** `app/(app)/admin/tags/page.tsx:35-50` (four nowrap buttons in a `justify-between` row); `app/(app)/admin/page.tsx:100` (`grid-cols-4`).
- **Fix:** `flex-col gap-3 sm:flex-row` with `flex-wrap`, and `grid-cols-2 sm:grid-cols-4` (UX-39).

**ADM-5 [P2] "Rejected" renders in the brand emerald.** `components/TagProposalControls.tsx:454` (`text-oxblood` maps to `--primary`).
- **Fix:** `text-destructive`.

**ADM-6 [P2] Hundreds of selects share the name "Select motion type".** `TagProposalControls.tsx:110, 412`. On `/cv/tags` the tournament names are `div.kicker`, not headings (`app/(app)/cv/tags/page.tsx:131-138`).
- **Fix:** `aria-label={`Motion type for ${roundLabel}, ${tournamentName}`}`, and make tournament names `h2`.

**ADM-7 [P2] `/cv/verify` shows every participant by default *(July)*.** `app/(app)/cv/verify/page.tsx:37` (`mineOnly = mineParam === '1'`). The toggle (`components/VerifyMineOnlyToggle.tsx:20-37`) flips its label between "Only me" and "Everyone" and has no `aria-pressed` (UX-12).
- **Fix:** default to mine (`mineParam !== '0'`); a fixed label "Only me" with `aria-pressed`.

**ADM-8 [P2] Parser warnings on `/cv/verify` render in the brand accent, not amber.** `verify/page.tsx:207-209`.
- **Fix:** `text-warning` on `bg-[hsl(var(--warning)/0.06)]`.

**ADM-9 [P3] Expanding a verify card loses focus.** `verify/page.tsx:231-243`: the "Show what the parser read" link navigates with `scroll={false}`.
- **Fix:** focus the detail section on mount, or use `<details>`.

**ADM-10 [P3] Old editorial idiom.**
- Uppercase strings hard-coded in JavaScript: "DEBATE CV — TAGS" and `t.name.toUpperCase()` (`cv/tags/page.tsx:105, 136, 156`), "DEBATE CV — VERIFY" (`verify/page.tsx:144`). Screen readers may spell these out.
- Italic empty states: `cv/tags/page.tsx:120`, `admin/page.tsx:149, 211`.
- **Fix:** the CSS `uppercase` class; `EmptyState`.

**ADM-11 [P3] The verify table is off-ledger.** `verify/page.tsx:261-302` does not use `.ledger` or `cell-num`, so numbers are left-aligned. The "Source" link opens a new tab without saying so (`:194-200`).

## 10. Empty, loading and error states

**STATE-1 [P1] Error boundaries print the raw error message.** `app/error.tsx:27` and `app/(app)/error.tsx:40-41` render `error.message` verbatim. Next.js replaces server-side messages with a generic one in production, but client errors pass through: a TypeError reads "Cannot read properties of undefined (reading 'map')".
- **Why:** UX-26.
- **Fix:** fixed plain text, plus "Reference: {error.digest}" when present. Keep `console.error`.

**STATE-2 [P1] Several loading skeletons are wider than a phone, so the page scrolls sideways while loading.**
- `app/(app)/cv/stats/loading.tsx:16, 20` (`w-72`, `w-96`)
- `app/(app)/cv/motions/loading.tsx:13, 17` (`w-80`, `w-96`)
- `app/(app)/cv/verify/loading.tsx:18, 19, 25`
- `app/(app)/cv/tags/loading.tsx:9`

A 390 px viewport leaves about 350 px of content box.
- **Why:** UX-25, UX-39.
- **Fix:** `w-full max-w-sm` and similar.

**STATE-3 [P1] `TableScroll` is not focusable and has no scroll cue *(July)*.** `components/ui/DataTable.tsx:13-25` is a bare `overflow-x-auto`.
- **Why:** axe `scrollable-region-focusable` (serious, SC 2.1.1) on every wide table that holds no link. Nothing on screen says a column is hidden (UX-29). This is how the public CV hid its Result column.
- **Fix:** `<div role="region" aria-label={label} tabIndex={0} className="table-scroll …">`, threading `label` from `Table`. Add a `.table-scroll` class in `globals.css` with the "background-attachment: local" scroll-shadow pattern (the July branch has one, `49241cb`, `globals.css` +36 lines).

**STATE-4 [P2] Skeletons announce nothing.** `components/ui/Skeleton.tsx:7` is `aria-hidden`, and no `loading.tsx` other than the root (`app/loading.tsx`, which uses `Spinner`) has a status line.
- **Fix:** `<p role="status" className="sr-only">Loading statistics…</p>` in each `loading.tsx`.

**STATE-5 [P2] `EmptyState` hard-codes `h3`.** `components/ui/EmptyState.tsx:30` sits straight under an `h1` on `/cv`, `/cv/stats`, `/cv/motions` and the dashboard.
- **Why:** UX-3.
- **Fix:** a `headingLevel` prop, defaulting to 2.

**STATE-6 [P2] `global-error.tsx` has no `lang` and uses the old editorial palette, with no dark variant.** `app/global-error.tsx:29-41`.
- **Why:** SC 3.1.1 (UX-2), UX-38.
- **Fix:** `<html lang="en">`, Ledger hex values, and a `prefers-color-scheme: dark` block in an inline `<style>`.

**STATE-7 [P2] There is no `color-scheme` declaration.** `app/globals.css:33, 105` set tokens per `[data-theme]`, but nothing sets `color-scheme`, so native scrollbars, date pickers and select popups stay light in dark mode (UX-38).
- **Fix:** `[data-theme='dark'] { color-scheme: dark; }` and `[data-theme='light'] { color-scheme: light; }`.

**STATE-8 [P2] Back-to-top always smooth-scrolls.** `components/PageJumpNav.tsx:104`: the `globals.css:368-381` guard covers CSS, not `scrollTo({ behavior: 'smooth' })`.
- **Why:** UX-40.
- **Fix:** choose `'auto'` when `matchMedia('(prefers-reduced-motion: reduce)').matches`.

**STATE-9 [P3] The not-found page's "Back to home" is a nested link-button.** `app/not-found.tsx:16`. NAV-4 covers it.

**STATE-10 [P3] The dashboard skeleton mismatches the summary view.** `app/(app)/dashboard/loading.tsx:22-29` draws a table the summary page no longer shows.
- **Fix:** tiles plus a single link line.

## 11. Copy and privacy pages

**COPY-1 [P0] The privacy and terms pages are close to unreadable in dark mode.** `app/(app)/privacy/page.tsx:21` and `app/(app)/terms/page.tsx:19` use `prose prose-stone`, whose fixed stone greys land on the graphite canvas. Body text is about 2:1, and headings and links are close to invisible. Nothing adds `prose-invert` or maps the `--tw-prose-*` variables.
- **Rendered:** axe `color-contrast` flagged 46 nodes on `/privacy` in dark, at both widths, and none in light. In the dark screenshot the section headings are nearly invisible.
- **Why:** SC 1.4.3, on the trust page that §10 depends on.
- **Fix:** map the typography plugin's variables to tokens once in `globals.css` (`.prose { --tw-prose-body: hsl(var(--foreground)); --tw-prose-headings: hsl(var(--foreground)); --tw-prose-links: hsl(var(--primary)); … }`), drop `prose-stone`, and use `font-sans` for body copy (§6).

**COPY-2 [P0] The OG card, shown wherever a public CV link is shared, uses the retired direction.** `app/opengraph-image.tsx:4, 27-36, 69, 80`: Georgia italic serif, oxblood `#7A2528`, "compiled from your inbox", "Sign in with Google. We scan your inbox…". Every `/u/<slug>` link pasted into a chat shows this card.
- **Why:** `DESIGN_INSTRUCTIONS.md` §4 bad examples, §6 (no serif, no italics) and §11. This is P0 on the brand rather than accessibility grounds: it is the first impression of every shared CV.
- **Fix:** rebuild on Ledger (Space Grotesk, emerald, canvas tokens as hex) with the hero copy, and add `app/u/[slug]/opengraph-image.tsx` with the person's name and headline figures.

**COPY-3 [P1] The privacy page's "Settings" link misses the page that deletes data.** `app/(app)/privacy/page.tsx:78` links `/settings`, which redirects to Profile. "Delete my data" is on `/settings/account`.
- **Fix:** link `/settings/account`.

**COPY-4 [P1] Implementation language in user copy.** Each item, with its file and a replacement:
- "Ingest jobs", "queue drains", "Person rows" (`settings/account/page.tsx:115-125`): "imports", "your record", "names you claimed".
- "Revoke the OAuth grant" (`AccountActions.tsx:32`): "Disconnect Gmail. Imports stop; your record stays; you stay signed in."
- "preflight", "landing page" (`OnboardingFlow.tsx:241-243, 274-277`): "Reading your tournament links".
- "legacy rows re-encrypt on next access" (`app/page.tsx:284`): "encrypted at rest (AES-256-GCM)".
- **Why:** UX-42; §8.

**COPY-5 [P3] The sample page has no Footer or privacy line, and its "Build my CV" sends the visitor back to `/`.** `app/sample/page.tsx:63-67, 244-248`.
- **Fix:** reuse the landing page's `BuildCvButton` form; add `<Footer />` and the trust row (§10).

**COPY-6 [P3] Dates are locale-dependent and "Last updated: 2026" gives no date.** `toLocaleDateString()` at `settings/account/page.tsx:90`, `settings/reports/page.tsx:94` and `admin/page.tsx:159, 225`; `privacy/page.tsx:24`.
- **Fix:** one `formatDate` (`en-GB`, `d MMM yyyy`) and a real date.

---

## Rendered checks

Run on 2026-10-27 with `npm run a11y` against `next dev` and the `seed:dev` database: 13 routes × 2 widths × 2 themes = 52 page loads, all HTTP 200. axe used the WCAG 2.2 A/AA tags plus `best-practice`. Re-run it with the commands in the header of `scripts/a11y-smoke.mjs`.

| Route | axe (rule: nodes; same in both themes unless noted) | Page scrolls sideways at 390? | Targets < 24 px (390 / 1280) |
|---|---|---|---|
| `/` (signed out) | `scrollable-region-focusable`: 1 at 390 | no | 0 / 0 |
| `/sample` | `scrollable-region-focusable`: 3 at 390 | no | 0 / 0 |
| `/privacy` | `color-contrast`: **46 in dark only** (COPY-1) | no | 0 / 0 |
| `/u/maya-rao` | none (but see PUB-1: only 2 of 8 columns visible at 390) | no | 0 / 0 |
| `/cv` | `empty-table-header`: 2 at 1280 (CV-15) | no | 14 / 2 (CV-1) |
| `/cv/stats` | `empty-table-header`: 9 (STAT-16); `scrollable-region-focusable`: 19 at 390, 2 at 1280 (STATE-3) | **yes, 770 px** (STAT-24) | 7 / 7 (16 px filter checkboxes) |
| `/cv/motions` | none | no | 0 / 0 |
| `/dashboard` | none | no | 1 / 1 (the visually hidden file input; not a real target) |
| `/dashboard?filter=all` | none | no | 15 / 44 (DASH-4) |
| `/settings/profile`, `/settings/sharing` | none | no | 0 / 0 |
| `/settings/account` | `definition-list`: 1 (SET-15) | no | 0 / 0 |
| `/admin` | none | no | 0 / 0 |

Measured directly (a scripted Playwright probe, not part of the smoke script):
- **Histogram:** 12 of 12 bars are 0 px tall at both widths (STAT-1).
- **Trend chart:** the first axis label renders in an 8 px box at 390 px against 24 px at 1280 (STAT-4).
- **`/cv/stats` overflow:** traced to the Info slides and Framing grid items (STAT-24).
- **`/cv` speaking ledger at 1280 px:** 1,369 px in a 1,238 px box (CV-2).

From the screenshots:
- `/u/<slug>` at 390 px shows Tournament and Year only (PUB-1). At 1280 px "Final (Champion)" touches the panel edge (PUB-2).
- A signed-out visitor on `/privacy` sees Record / Statistics / Imports / Settings (NAV-6).
- Dashboard mobile cards cut tournament names ("World Universities Debating C…", DASH-11).
- The public CV's "Career speaker a…" tile label is truncated at 390 px (STAT-11).
- Titles confirm SET-12: all three settings pages are "Settings · debate cv". `/cv` is "My CV" (NAV-9).

What axe did **not** catch, and why the manual findings matter:
- **Nested link-buttons (NAV-4):** axe's `nested-interactive` does not look at a `<button>` inside an `<a>`. The smoke script now counts them itself (`nested` column).
- **SVG chart text contrast (STAT-2):** contrast set through `fillOpacity` was not flagged.
- **The 1.25:1 field borders (FORM-5):** axe does not check non-text contrast.
- **Toasts and focus management (DASH-2, FORM-1, SET-3):** these need an interaction, and the smoke script only loads pages.
- **The 20 px row buttons (DASH-4):** they pass axe's `target-size` under its spacing exception.

This matches Deque's own figure: automated rules find a little over half of real issues.

Not rendered: the onboarding flow (the seed user has already claimed identities, so `/onboarding` redirects), `/cv/tags` and `/cv/verify` (admin tools, read from code), and any interaction (toasts, dialogs, form errors). The rate-limit toast (DASH-1) was traced through code: `postJson` → `scanErrorMessage` → `toast.show({ kind: 'error', title: 'Scan failed' })`. It was not triggered live, because the seed user has no Gmail token.

---

## Proposed implementation split (P0 and P1)

Six tasks, by file ownership, so they can run in parallel from `main`. Each task owns its files outright. The one shared seam: **T1 owns `components/ui/*`, `app/layout.tsx`, `app/(app)/layout.tsx` and `app/globals.css`**, and also the 12 `<Link><Button>` lines (NAV-4) wherever they sit, because the fix needs T1's new `buttonClasses` export. The other tasks leave those lines alone. They are 3-line edits that git merges cleanly beside other changes in the same file. Tasks T2 to T6 consume `TableScroll`, `EmptyState` and `Toast` unchanged; T1's changes to those are backwards-compatible (new optional props only).

| Task | Owns (files) | Findings (P0/P1) | Notes |
|---|---|---|---|
| **T1 Shell, primitives and feedback** | `app/layout.tsx`, `app/(app)/layout.tsx`, `app/error.tsx`, `app/(app)/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, `components/ui/{Toast,Button,DataTable,EmptyState,Skeleton}.tsx`, `components/{NotificationBell,UserMenu,Footer,PageJumpNav}.tsx`, `app/globals.css`, `tailwind.config.ts`, plus the NAV-4 lines | NAV-1, NAV-2, NAV-3, NAV-4, DASH-2, FORM-5 (token half), STATE-1, STATE-3 | Ship first if possible; T2 depends on the new Toast `kind: 'info'` persistence rules only at the copy level |
| **T2 Imports and ingest status** | `app/(app)/dashboard/**`, `components/{DashboardActions,IngestProgressTracker,AutoScanOnVisit,RetryFailedButton,ReingestButton,UnmatchedRowExpand,ParticipantSearch,CvNeedsAttentionBanners}.tsx`, `lib/ingest/scanErrorMessage.ts` (+ test), `lib/utils/api.ts`, new `lib/ingest/userMessage.ts` (+ test) | DASH-1, DASH-3, DASH-5, DASH-6, DASH-7 | The rate-limit fix: `postJson` returns `retryAfterSec`; a neutral notice with a countdown |
| **T3 Record (`/cv`)** | `app/(app)/cv/page.tsx`, `app/(app)/cv/loading.tsx`, `components/{CvShareButton,CvDownloadButton,CvRowReportButton,CvHighlights,CvSubNav}.tsx` | CV-1, CV-2, CV-3, FORM-12 (report dialog) | Extract `TournamentCard` here for T6 to reuse: T6 can start with a copy and swap to the import once T3 merges |
| **T4 Statistics, charts and motions** | `components/stats/**`, `components/ui/{TrendChart,BarList,StatTile}.tsx`, `components/StatsSplitTable.tsx`, `app/(app)/cv/stats/**`, `app/(app)/cv/motions/**`, `app/(app)/cv/{verify,tags}/loading.tsx` | STAT-1, STAT-2, STAT-3, STAT-4, STAT-5, STAT-6, STAT-7, STAT-8, STAT-9, STAT-24, STATE-2 | The three P0 chart fixes are small; STAT-4 (responsive SVG) is the largest item. The STAT-19 copy line in `lib/cv/speakerStats.ts` is P3 and not in this task |
| **T5 Onboarding and settings forms** | `components/{OnboardingFlow,AccountActions,SharingManager,IdentityManager,ReconnectGmailButton,SettingsSideNav}.tsx`, `app/(app)/onboarding/**`, `app/(app)/settings/**` | SET-1, SET-2, SET-3, SET-4, SET-5, SET-6, FORM-1, FORM-2, FORM-3, FORM-4, FORM-5 (field half), COPY-4 (settings and onboarding strings) | Pure form work; follows GOV.UK error-message and UX-15 to UX-17 |
| **T6 Public surfaces, legal pages and admin** | `app/u/[slug]/**`, `app/page.tsx`, `app/sample/**`, `components/landing/**`, `app/(app)/privacy/**`, `app/(app)/terms/**`, `app/opengraph-image.tsx` (+ new `app/u/[slug]/opengraph-image.tsx`), `app/(app)/admin/**`, `components/{AdminTagProposals,AdminActions,AdminTagPreprocess,AdminClassifyMotionsButton,TagProposalControls,VerifyMineOnlyToggle}.tsx`, `app/(app)/cv/{verify,tags}/page.tsx` | PUB-1, COPY-1, COPY-2, COPY-3, COPY-4 (landing string), ADM-1 | PUB-1's card layout exists on the July branch (`49241cb`, `app/u/[slug]/page.tsx`) to port |

---

## Status of the July 2026 audit (`origin/claude/ui-ux-issues-audit-62ja8z`)

| July finding | Status on `main` | Here |
|---|---|---|
| Histogram drew no bars | Still present | STAT-1 |
| Public CV hid its Result column | Mostly fixed (format abbreviated); fits at 1280 with seed data, no margin left | PUB-2 |
| Public CV had no mobile layout | Still present | PUB-1 |
| Theme toggle on `/u` was dead | Still present | PUB-3 |
| `/cv` header showed the best average, not the career one | Not rechecked: logic lives in `lib/cv/headerMetrics.ts` (out of scope for a UI audit) | n/a |
| "31 points more often" (meant pp) | Still present | STAT-19 |
| `/cv/verify` defaulted to everyone | Still present | ADM-7 |
| Splits "thin" below 4 vs 6 | Partly fixed (StatsViews yes, engine splits no) | STAT-6 |
| "Tournaments in flight" in the steady state | Still present | DASH-14 |
| Browser-blue checkboxes | Fixed in `StatsFilterBar`, present in 3 others | FORM-8 |
| Two "vs you" columns | Still present | STAT-5 |
| No scroll affordance on wide tables | Still present | STATE-3 |
| Settings tab wraps at 390 | Still present | SET-13 |
| `StatTile` label truncated to `title` | Still present | STAT-11 |
| Mobile card titles 23 px tall | Still present (measured 23 px, 14 links at 390) | CV-1 |
| Owner's name repeated under every row | Still present on desktop (`app/(app)/cv/page.tsx:525`) | covered by CV-1's card fix only; desktop is P3 polish, not listed |
| `/cv` ledger ~80 px too wide at 1280 | Worse: 131 px over (1,369 in 1,238) | CV-2 |
| `AutoScanOnVisit` 400s with no token | Still present | DASH-13 |
