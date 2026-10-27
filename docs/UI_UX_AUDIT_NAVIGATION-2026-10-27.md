# UI/UX audit: navigation, tabs, buttons and wayfinding (2026-10-27)

This audit measures every route against rules **UX-44 to UX-87** (navigation, tabs and segmented controls, buttons and actions, wayfinding). Those rules and their sources are kept outside the repo, in the owner's research folder (`reports/ui-ux/UI_UX_STANDARDS (87 rules, navigation research) 2026-10-27.md`); `docs/UI_UX_STANDARDS.md` in the repo carries only UX-1 to UX-43. Each finding below states the rule it breaks in words, so it reads without the research file. Where older rules overlap (UX-4, UX-8, UX-11, UX-17, UX-24, UX-43), they were rechecked too. It is a companion to `docs/UI_UX_AUDIT-2026-10-27.md`; that audit's IDs (NAV-, DASH-, SET- and so on) are cited where a finding overlaps. Findings here use the prefix **NV-**.

It is a docs-only change. No application code was changed.

## Headline

The shell is in better shape than the standard's own examples suggest. Many fixes from the first audit have landed:
- `<main>` is a sibling of the header.
- The menus are disclosures.
- No `<Link><Button>` nesting remains.
- Row actions are no longer hover-only.
- Filters on Imports, Statistics and Verify live in the URL.

The real gaps are in **wayfinding and action state**, not in the nav markup:

1. **No focus management on route change (NV-1, P1).** Nothing in the app moves focus when the path changes, including the onboarding hand-off to `/cv`.
2. **"You are here" breaks inside Record (NV-3).** On `/cv/motions`, `/cv/tags` and `/cv/verify` no header item is current. Record and Statistics appear in two navs that disagree (NV-4). The current-item cue is a faint tint plus a text-colour change.
3. **The `Button` primitive's pending state fails UX-70 and UX-71 everywhere (NV-5, NV-6).** It sets `disabled`, which drops focus, and many labels change to "…ing". There is no `aria-disabled` anywhere in the codebase (0 matches). Several disabled buttons give no reason.
4. **Titles, `h1`s and nav labels use different words on 12 routes (NV-7).** For example: nav "Settings → Profile", title "Profile settings", `h1` "What we know about you".
5. **The not-found paths (NV-2, NV-17).** A missing or unshared `/u/<slug>` returns HTTP 200 with **two `<main id="main">` elements** (seen in the browser). The 404 has no navigation, a generic title and only "Back to home".
6. **Signed-out shells disagree (NV-10, NV-11).** There are three different headers. The same word "Privacy" goes to two different places on the landing page. "Build my CV" means "sign in" on one page and "go to the landing page" on two others.

**Verdicts for the 44 new rules:** 10 PASS, 18 PARTIAL, 13 FAIL, 3 N/A.

**Findings:** 31 in total: 2 P1, 17 P2, 12 P3, 0 P0. Nothing here blocks a task outright; the P1s are a WCAG 2.4.3 focus-order failure on core paths and an invalid landmark structure on a public URL.

**Production and `origin/main` disagree in one place.** In the browser, production's `/cv` is titled "Record · debate cv". `app/(app)/cv/page.tsx:48` on `origin/main` (`453bbd3`) still says `title: 'My CV'`. Production is ahead of `main` or was deployed from another branch. Line references in this document are to `main`.

## How this was done

- **Code.** Read all navigation, header, footer, layout, page-header, dialog, popover, button and filter code under `app/` (not `app/api`) and `components/`. Line numbers are against `main` at `453bbd3` plus the standards commit `f93178b`.
- **Searches across the codebase:**
  - focus or scroll management on navigation: `FocusOnNavigate`, `scrollIntoView`, `scroll-padding`;
  - ARIA roles: `tablist`, `tab`, `menu`;
  - every `target="_blank"` (14);
  - every `disabled` (29) against `aria-disabled` (0);
  - every `window.confirm` and `window.prompt`;
  - every `redirect(` in a page.
- **Browser.** Production `https://debate-cv.vercel.app`, read-only:
  - Signed-out pages were fetched without credentials and their server HTML inspected: `/`, `/sample`, `/privacy`, `/terms`, `/this-does-not-exist` and `/u/nonexistent-slug-xyz`.
  - The browser already held a session for the owner's account, so `/` redirected to `/cv`. One `/cv` render at 1920 px was read for title, `h1`, landmarks and nav. No credentials were entered and no control was clicked.
  - **Not done:** the 390 px and 1280 px viewport checks. The browser window could not be resized (`innerWidth` stayed 1920), and the site's `X-Frame-Options: DENY` ruled out an iframe at a fixed width. Every mobile claim below is therefore **read from code**. Signed-in pages other than that one `/cv` render are code only.
- **Priorities** follow the first audit: P0 blocks a task or is a clear A/AA failure on a core path; P1 is significant; P2 moderate; P3 polish.
- **Owner tracks** reuse T1 to T6 from the first audit's "Proposed implementation split":
  - T1: shell and primitives
  - T2: Imports
  - T3: Record
  - T4: Statistics and motions
  - T5: onboarding and settings
  - T6: public pages, legal pages and admin

## Per-rule verdicts (UX-44 to UX-87)

| Rule | Verdict | Evidence (file:line) | Finding |
|---|---|---|---|
| UX-44 Primary nav visible, no hamburger | PASS | `app/(app)/layout.tsx:54-59` (desktop), `:84-89` (phone strip). Browser: no hamburger on any signed-out page | — |
| UX-45 ≤5 items, same order, conditional last | PASS | `app/(app)/layout.tsx:122-131`: Record · Statistics · Imports · Settings · Admin (Admin last). Browser: same on `/cv` | — |
| UX-46 Labels plain words, match `h1` | FAIL | Record → `h1` is the user's name; Statistics → "Your record, measured"; Settings → "What we know about you" | NV-7 |
| UX-47 "You are here" in each level, two cues | FAIL | `components/NavLink.tsx:29-31, 40`; `components/CvSubNav.tsx:45-47` | NV-3, NV-15 |
| UX-48 One level per destination; section nav under the `h1` | FAIL | `app/(app)/layout.tsx:124-127` and `components/CvSubNav.tsx:6-14` both carry Record and Statistics; `app/(app)/cv/page.tsx:183-197` puts the stat tiles between the `h1` and `CvSubNav` | NV-4 |
| UX-49 Links in a labelled `nav`, no menu or tablist roles | PASS | No `role="menu|tablist|tab"` in the codebase; `CvSubNav.tsx:32`, `SettingsSideNav.tsx:17` labelled | — |
| UX-50 One skip link, first, lands on `main` | PARTIAL | `app/layout.tsx:112`. Browser: first focusable on every signed-out page. Broken on `/u/<missing>` (two `#main`) | NV-2 |
| UX-51 Landmarks top-level, uniquely named | PARTIAL | Two `main`s on `/u/<missing>`; landing `<nav>` unlabelled (`app/page.tsx:90`) | NV-2, NV-28 |
| UX-52 No breadcrumbs; back links only where needed | PASS | "← Summary" (`dashboard/page.tsx:260-265`) and "← Admin" (`admin/tags/page.tsx:45`) go to fixed, stateless parents | — |
| UX-53 Utilities top right, fixed order | PARTIAL | Theme · Bell · Account in order (`app/(app)/layout.tsx:60-72`). Signed out, the theme toggle exists on `/privacy` and `/terms` but not on `/` or `/sample` | NV-11 |
| UX-54 Signed-out shell offers only open pages; public CV has no chrome | PARTIAL | Public CV: PASS (`app/u/[slug]/layout.tsx`). Signed-out "Build my CV" goes to `/`, not sign-in (`app/(app)/layout.tsx:118`). During onboarding, 3 of 4 nav items bounce back | NV-10, NV-15 |
| UX-55 Scrolling strip shows continuation, current in view | PARTIAL | Header and `CvSubNav` have a mask fade; nothing scrolls the current item into view (0 `scrollIntoView`); Settings strip (`SettingsSideNav.tsx:18`) and jump nav (`PageJumpNav.tsx:71`) have no cue | NV-18 |
| UX-56 Tabs only in-page; route changes are links | PASS | `CvSubNav`, `SettingsSideNav`, filter chips are all `Link`s | — |
| UX-57 Tabs only for parallel content | PASS | `/cv/stats` is one page with `PageJumpNav` | — |
| UX-58 Segmented control = radio group or `aria-pressed` | PASS | `components/stats/CrossTabsSection.tsx:162-170`, `StatsFilterBar.tsx:103`, `VerifyMineOnlyToggle.tsx:41`, `AdminTagProposals.tsx:196-205` | — |
| UX-59 APG tabs keyboard model | N/A | No real tabs exist | — |
| UX-60 Selected view in the URL | PARTIAL | Stats filters (`FilterableStats.tsx:77-87`), Verify `?t=` / `?mine=`, Imports `?filter=` are in the URL; the cross-tab grid and metric are not (`CrossTabsSection.tsx:192-193`) | NV-22 |
| UX-61 Tabs above panel, most used first | N/A | No tabs | — |
| UX-62 Tab labels short, no disabled tabs | N/A | No tabs | — |
| UX-63 >3 segments on phone scroll or `<select>`, never wrap | PARTIAL | `CrossTabsSection.tsx:162` and `StatsFilterBar.tsx:214` use `flex-wrap` with long labels ("Pairing × motion type") | NV-23 |
| UX-64 Links go, buttons do | PARTIAL | Nesting fixed (0 in the browser). Downloads are buttons that set `window.location` (`AccountActions.tsx:118`, `CvDownloadButton.tsx:190`) | NV-29 |
| UX-65 One primary per view | PARTIAL | Per-hit primaries in `ParticipantSearch.tsx:201-212`; per-row "Approve" in `AdminTagProposals.tsx:304-313`; two on `/cv` when disconnected and empty (`cv/page.tsx:144, 211`) | NV-16 |
| UX-66 Verb + object labels | PARTIAL | "Send" (`CvRowReportButton.tsx:277`), ".json" (`CvDownloadButton.tsx:193`), "Clear" (`DashboardActions.tsx:370`) | NV-19 |
| UX-67 Button order: forms primary-first, dialogs trailing, stacked on phone | PARTIAL | Report dialog Cancel → Send right-aligned (PASS, `CvRowReportButton.tsx:266-277`) but never stacks; onboarding and identity primaries sit right (`OnboardingFlow.tsx:401`, `IdentityManager.tsx:240`) | NV-20 |
| UX-68 Page actions in the page header, ≤3 | PASS | `/cv` Share · Download (`cv/page.tsx:177-180`); Imports (`dashboard/page.tsx:162-166`); Verify toggle (`cv/verify/page.tsx:157-159`) | (NV-31 edge case) |
| UX-69 Danger style on the final step only; irreversible ones confirmed | FAIL | Admin "Clear all data" and "Full wipe" are `secondary` behind `window.confirm` / `window.prompt` (`AdminActions.tsx:26-35, 83-93`); "Delete my data" trigger is `danger` (`AccountActions.tsx:138-149`) | NV-9, NV-30 |
| UX-70 Pending keeps label, `aria-disabled`, keeps focus | FAIL | `components/ui/Button.tsx:110` sets `disabled={disabled \|\| loading}`; labels change at `OnboardingFlow.tsx:292, 415`, `IdentityManager.tsx:255`, `ParticipantSearch.tsx:211`, `DashboardActions.tsx:62-65` | NV-5 |
| UX-71 Avoid `disabled`; say why | FAIL | 0 `aria-disabled`; reasonless `disabled` at `DashboardActions.tsx:468`, `IdentityManager.tsx:251`; reason only in `title` at `DashboardActions.tsx:73-74` | NV-6 |
| UX-72 Icon-only buttons named, with a tooltip | PARTIAL | All named. Tooltip only via `title` on theme and report; none on the bell, account menu or back-to-top | NV-21 |
| UX-73 Row actions visible, named for the row | PARTIAL | Hover-only fixed (`TournamentCard.tsx:9`). Imports row actions "Ingest", "Clear", "Lock" carry no row name (`DashboardActions.tsx:287-337, 348-370, 516-551`) | NV-13 |
| UX-74 Sticky bars never hide focus | FAIL | `md:sticky` header (`app/(app)/layout.tsx:46`) with no `scroll-padding-top` anywhere in `app/globals.css` | NV-14 |
| UX-75 ≤3 buttons per group | PARTIAL | Imports header becomes four controls while ingesting (`dashboard/page.tsx:162-166` + Stop at `DashboardActions.tsx:178-189`) | NV-31 |
| UX-76 Title, `h1` and nav label agree | FAIL | 12 routes disagree (table in NV-7). Browser: 404 has the generic site title; `/u/<missing>` title "CV not found" over `h1` "Page not found" | NV-7, NV-2 |
| UX-77 Focus to the top of the new page on route change | FAIL | No focus handling on navigation anywhere; `OnboardingFlow.tsx:242` `router.push('/cv')` | NV-1 |
| UX-78 New page at top, Back restores, anchors clear header | PARTIAL | Jump-nav targets use `scroll-mt` (PASS); no `scroll-padding-top`; filter chips scroll to the top on every click (`dashboard/page.tsx:458`, no `scroll={false}`) | NV-14, NV-24 |
| UX-79 Shareable views have URLs | PARTIAL | As UX-60; admin tag filter in `useState` (`AdminTagProposals.tsx:78`) | NV-22 |
| UX-80 Filters above table, active state, clear, count | PASS | Imports chips with counts and "x of y · filter" (`dashboard/page.tsx:255-299`); Stats "Clear filters" (`StatsFilterBar.tsx:154`) | — |
| UX-81 Paginate, never silently truncate | FAIL | `dashboard/page.tsx:80, 87` `take: 200`, and the tile counts are computed from the capped rows | NV-12 |
| UX-82 Visible scoped search | PASS | `ParticipantSearch.tsx:137-152` has a visible label and a scoped placeholder | — |
| UX-83 Steps shown, current marked, Back available | PARTIAL | `OnboardingSteps.tsx:37-41, 62` (`aria-current="step"`). No Back between steps | NV-15 |
| UX-84 Error, empty and 404 screens offer a way forward | FAIL | `app/not-found.tsx:20` "Back to home" only, no chrome; `app/global-error.tsx` only "Try again"; Imports no-data empty state has no action (`dashboard/page.tsx:232-236`) | NV-17, NV-26 |
| UX-85 Link text names its destination; same text, same place | FAIL | Landing "Privacy" → `#privacy` (`app/page.tsx:97`) while footer "Privacy" → `/privacy`; "Build my CV" means two things; Verify repeats "Show what the parser read" and "Source" per card | NV-10, NV-27 |
| UX-86 External links same tab unless comparing; new tab marked | FAIL | Unmarked `_blank`: footer GitHub on every page (`Footer.tsx:33-40`), privacy (`privacy/page.tsx:85, 124`), terms (`terms/page.tsx:41`), Imports URLs (`dashboard/page.tsx:337-344, 393-400`), Verify "Source" (`cv/verify/page.tsx:198-204`) | NV-8 |
| UX-87 Help and legal links in the same place on every shell | PARTIAL | `Footer` is shared by landing, sample and the app shell (browser: same order on four pages). The public CV and the 404 have no Privacy or Terms links | NV-25 |

## Ranked findings

### P1

**NV-1 [P1] Focus is never moved on a client-side route change.** All `(app)` routes, worst on `/onboarding` → `/cv` and on every header and `CvSubNav` link.
- **Evidence:**
  - Nothing in `app/` or `components/` listens to `usePathname()` to move focus: no `FocusOnNavigate`, no `h1` with `tabIndex={-1}` outside onboarding.
  - `components/OnboardingFlow.tsx:242` calls `router.push('/cv')` after focusing a "Loading your Record…" heading that then unmounts. Focus is left on `<body>` or on a removed node.
  - Next.js announces the title but does not move focus (UX-77).
- **Breaks:** UX-77; SC 2.4.3.
- **Fix:** a small client `FocusOnNavigate` in `app/(app)/layout.tsx`:
  - On a `usePathname()` change, skip the first render, then focus `main h1` (give page `h1`s `tabIndex={-1}`, or have the component set it) with `preventScroll`. Fall back to `#main`.
  - Ignore query-only changes so filters keep focus (UX-60).
- **Effort:** S. **Track:** T1.

**NV-2 [P1] A missing or unshared public CV renders two `<main id="main">` elements and answers HTTP 200.** Route: `/u/<slug>`.
- **Evidence:**
  - `app/u/[slug]/page.tsx:76` calls `notFound()`.
  - The root `app/not-found.tsx:9` brings its own `<main id="main">`, and it renders inside `app/u/[slug]/layout.tsx:25`, which already wraps children in `<main id="main">`.
  - Browser, `/u/nonexistent-slug-xyz`: HTTP 200, two `main` landmarks, title "CV not found · debate cv" over `h1` "Page not found". The page has "Back to home" and "Build your own →", both to `/`.
- **Breaks:** UX-51, UX-50 (duplicate skip target), UX-76, UX-84. A 200 for a missing page is also an SEO and caching problem, although the route is `noindex`.
- **Fix:**
  - Add `app/u/[slug]/not-found.tsx` that renders content only (no `<main>`): `h1` "This CV is not available", one sentence that does not say whether the slug exists, and one link "Build your own debate CV" to `/`.
  - Check that the status is 404 once a segment-level `not-found` exists. If streaming still yields 200, move the lookup into `generateMetadata` as well (it already queries) so `notFound()` fires before the shell streams.
- **Effort:** S. **Track:** T6.

### P2

**NV-3 [P2] On `/cv/motions`, `/cv/tags` and `/cv/verify` no header item is current, and the current-item cue is colour only.**
- **Evidence:**
  - `components/NavLink.tsx:29-31`: Record is `exact` (`app/(app)/layout.tsx:124`) and Statistics matches only `/cv/stats*`. On these three routes only `CvSubNav` marks a current item.
  - Cues: `NavLink.tsx:40` is `bg-surface-2 text-ink` against `text-ink-soft`, a light tint plus a text-colour shift with the same weight. `CvSubNav.tsx:45-47` is `bg-card shadow-xs`. Both are close to invisible in greyscale.
  - The settings nav (`SettingsSideNav.tsx:28-30`) is stronger but also colour only.
  - Browser: confirmed on production `/cv` that Record is the header's current item. `/cv/motions` could not be opened.
- **Breaks:** UX-47, UX-4.
- **Fix:**
  - Give `NavLink` a `match` prop: Record matches `/cv` and `/cv/*` except `/cv/stats*`, so `/cv/motions` lights Record. `/cv/tags` and `/cv/verify` should light Admin (see NV-4).
  - Add a second, non-colour cue to all three navs, for example `font-semibold` plus a 2 px inset bottom border on the current item.
- **Effort:** S. **Track:** T1 (`NavLink`), T3 (`CvSubNav`), T5 (`SettingsSideNav`).

**NV-4 [P2] Record and Statistics live in two nav levels, and the operator tools are split across two places.**
- **Evidence:**
  - Header: Record, Statistics (`app/(app)/layout.tsx:124-127`). `CvSubNav`: Record, Statistics, Motions, Tags, Verify (`components/CvSubNav.tsx:6-14`).
  - `/cv/tags` and `/cv/verify` are admin-only tools (`cv/tags/page.tsx:22`, `cv/verify/page.tsx:33`) shown in the CV section, while the header has a separate Admin item whose pages (`/admin`, `/admin/tags`) do not link to them.
  - On `/cv` the sub-nav sits under the stat tiles, not directly under the `h1` (`cv/page.tsx:183-197`).
- **Breaks:** UX-48.
- **Fix:**
  - Keep `CvSubNav` (it is the better phone control) and make the header agree with it (NV-3), which the rule allows ("unless both mark it current together").
  - Move Tags and Verify out of `CvSubNav` into the Admin page as links: `/admin` should list "Tag proposals", "Motion tags (/cv/tags)" and "Verify parser output".
  - Move `<CvSubNav>` above the `StatRow` on `/cv`.
- **Standard check:** removing Statistics from the header to satisfy the letter of UX-48 would make Statistics two taps away on phones. Reconciling the "current" marking is the cheaper and better fix.
- **Effort:** M. **Track:** T3 + T6.

**NV-5 [P2] The `Button` pending state drops focus, and several labels change while pending.**
- **Evidence:**
  - `components/ui/Button.tsx:110`: `disabled={disabled || loading}`. Every `loading` button (Scan, Ingest, Save, Confirm, Claim, Send, Delete) becomes `disabled`, and focus falls to `<body>` mid-action.
  - Labels are swapped while pending: "Scanning Gmail…" (`OnboardingFlow.tsx:292`, `DashboardActions.tsx:62-65`), "Confirming…" (`OnboardingFlow.tsx:415`), "Saving…" (`IdentityManager.tsx:255`), "Claiming…" (`ParticipantSearch.tsx:211`).
- **Breaks:** UX-70.
- **Fix:**
  - In `Button`, when `loading`: render `aria-disabled="true"`, keep `disabled` off, swallow `onClick` (and form submit through `onClickCapture`), keep the children, and add the spinner.
  - Move progress text such as "Scanning Gmail…" into a nearby `role="status"`, not the label.
  - Add one Vitest case for the `loading` contract. The rule says "test where it exists", and this is the shared primitive.
- **Effort:** M (the primitive is S; the call sites that rewrite labels are S each). **Track:** T1, then call sites in T2 and T5.

**NV-6 [P2] Disabled controls without a stated reason, and no `aria-disabled` anywhere.**
- **Evidence:**
  - `ReingestSelectedButton` is disabled at 0 selected (`DashboardActions.tsx:468`) with no visible reason. Its own `onClick` (`:471-479`) already handles 0 with a message, so the `disabled` is redundant.
  - `IdentityManager.tsx:251` disables "Save changes" while nothing changed, with no text.
  - The Scan button's disconnected reason is only in `title` (`DashboardActions.tsx:73-74`). The page's reconnect notice explains it, but not next to the button.
  - `CvDownloadButton.tsx:265-279` explains its reason (FORM-7 fix), but the button stays `disabled`, so a keyboard user never reaches it to hear the description.
- **Breaks:** UX-71, UX-16; related to FORM-7.
- **Fix:**
  - Drop `disabled` from Re-ingest selected and Save, and let the click explain ("Select at least one URL", "Nothing to save").
  - Switch the remaining ones to `aria-disabled` with visible adjacent text (after NV-5, the `Button` primitive supports this).
- **Effort:** S. **Track:** T2, T5, T3.

**NV-7 [P2] The title, `h1` and nav label use different words on 12 routes.**

| Route | Nav label | `<title>` | `h1` |
|---|---|---|---|
| `/cv` | Record | "My CV" (`cv/page.tsx:48`; production already shows "Record") | user's name |
| `/cv/stats` | Statistics | Statistics | "Your record, measured" |
| `/cv/motions` | Motions | Motions | "Every motion on your record" |
| `/cv/verify` | Verify | "Extracted Data Verification" (`:18`) | "Check what we parsed" |
| `/dashboard` | Imports | Imports | "Imports" or "Importing N tournaments" |
| `/settings/profile` | Profile | "Profile settings" | "What we know about you" |
| `/settings/sharing` | Public sharing | "Public sharing settings" | "Your public link" |
| `/settings/reports` | Reports | "Report history" | "Open and resolved reports" |
| `/settings/account` | Account | "Account settings" | "Connections and data" |
| `/admin` | Admin | Admin | "Operator tools" |
| `/onboarding` | — | "Set up your CV" | "Find yourself on the rosters" |
| 404 | — | site default (browser) | "Page not found" |

- **Breaks:** UX-76, UX-46.
- **Fix:**
  - Titles to "Profile · Settings", "Sharing · Settings", and so on (most specific first); `/cv` to "Record"; `/cv/verify` to "Verify"; the 404 to "Page not found".
  - For `h1`s, use the nav word as the `h1` and move the slogan to the lede, **or** amend UX-76 (below).
- **Standard check:** the Statistics, Motions and Imports pages already carry the nav word as a `.data-label` eyebrow directly above the slogan `h1`. For a screen-reader user that eyebrow is not a heading, so the rule's intent is not met. But demanding the `h1` read "Statistics" is stricter than SC 2.4.6 requires. A reasonable amendment: "the `h1` starts with, or the title equals, the nav label".
  - `/cv`'s `h1` being the debater's name is right for a CV, and production already prefixes it with a visually hidden "Debate record of". That should count as a pass.
  - The settings slogans ("What we know about you") are the weakest; change those.
- **Effort:** S. **Track:** T5 (settings, onboarding), T3 (`/cv`), T6 (verify, admin), T1 (404).

**NV-8 [P2] New-tab links with no warning, including the footer link on every page.**
- **Evidence:**
  - `components/Footer.tsx:33-40` GitHub; seen in the browser on `/`, `/sample`, `/privacy` and `/terms`.
  - `app/(app)/privacy/page.tsx:85` (Google permissions) and `:124` (issue tracker); `app/(app)/terms/page.tsx:41`. The browser confirmed all three are unmarked.
  - `app/(app)/dashboard/page.tsx:337-344, 393-400`: the URL links have an `aria-hidden` icon and no text cue.
  - `app/(app)/cv/verify/page.tsx:198-204` "Source".
  - Marked correctly: `TournamentCard.tsx:31-43`, the public CV, `CvShareButton`, `SharingManager`.
- **Breaks:** UX-86, UX-43.
- **Fix:**
  - Footer, privacy and terms: drop `target="_blank"`. None of these is a comparison task.
  - Imports and Verify: keep the new tab (the user is cross-checking a tab page) and add `<span className="sr-only"> (opens in new tab)</span>`.
  - Better still, reuse `TournamentLink` from `TournamentCard.tsx`.
- **Effort:** S. **Track:** T1 (Footer), T6 (privacy, terms, verify), T2 (Imports).

**NV-9 [P2] Admin's irreversible actions are styled as ordinary secondary buttons behind browser dialogs, and "Re-ingest all" has no confirmation.**
- **Evidence:**
  - `components/AdminActions.tsx:26-35`: "Clear all data" is `variant="secondary"` with `window.confirm`.
  - `:83-93`: "Full wipe" is `secondary` with `window.prompt('Type FULL WIPE')`. The typed confirmation is right, but the native prompt cannot name the consequence in-page, and the danger cue is only the section tint.
  - `:131-133`: "Re-ingest all URLs" is the page's one `primary`. It queues every URL for every user with no confirmation, and it sits directly under the wipe.
- **Breaks:** UX-69, UX-17, UX-65 (the primary falls on the costliest routine action).
- **Fix:**
  - Use the account page's inline-confirm pattern (`AccountActions.tsx` `DeleteConfirmForm`): the trigger is `outline`, the final button is `danger` and names the consequence ("Wipe all users' claims"), with typed confirmation for Full wipe and focus starting on Cancel.
  - Make "Re-ingest all" `secondary` with a one-step confirm that states the count.
- **Standard check:** this is an operator page used by one person, so P2, not P1.
- **Effort:** M. **Track:** T6.

**NV-10 [P2] The same link text goes to different places in the signed-out flow.**
- **Evidence:**
  - Landing header "Privacy" → `#privacy` (`app/page.tsx:97`), while the footer on the same page and the app shell's "Privacy" → `/privacy`.
  - "Build my debate CV" on landing starts Google sign-in (`app/page.tsx:38-56`). "Build my CV" and "Build my debate CV" on `/sample` (`app/sample/page.tsx:68, 247`) and "Build my CV" in the signed-out app shell (`app/(app)/layout.tsx:118`) all go to `/` instead. A visitor who decided on the sample page has to find the button again on the landing page.
  - Browser: confirmed all of the above on production.
- **Breaks:** UX-85, UX-54.
- **Fix:**
  - Rename the landing anchor "How we use your data" or point it at `/privacy`.
  - Make every "Build my CV" the same sign-in `<form>` (extract `BuildCvButton` to `components/landing/`), so one label means one action.
- **Effort:** S. **Track:** T6.

**NV-11 [P2] Three signed-out headers.**
- **Evidence:** browser and code.

  | Page | Header |
  |---|---|
  | `/` | Sample CV · Statistics · Privacy · Sign in (`app/page.tsx:90-99`) |
  | `/sample` | logo and one primary "Build my CV" (`app/sample/page.tsx:64-71`) |
  | `/privacy`, `/terms` | Sample CV · Privacy · Build my CV plus the theme toggle (`app/(app)/layout.tsx:112-120, 61`) |

- **Breaks:**
  - UX-45 and SC 3.2.3: the same set of signed-out pages repeats navigation in a different order and composition.
  - UX-53: the theme toggle appears on two of the four pages.
- **Fix:** one `PublicHeader` used by `/`, `/sample`, `/privacy` and `/terms`: Sample CV · Privacy · Sign in, with the theme toggle in the same slot on all four. Landing in-page anchors can stay below `sm` as body links.
- **Effort:** M. **Track:** T6 + T1.

**NV-12 [P2] Imports silently caps at 200 URLs, and its counts are wrong past that.**
- **Evidence:** `app/(app)/dashboard/page.tsx:80, 87` (`take: 200` on URLs and jobs). `counts` (`:121-130`) and the "Private URLs" tile come from the capped rows, so a heavy user (a judge on a circuit for years) sees "200" and loses older rows with no notice.
- **Breaks:** UX-81, UX-35 (an aggregate that misstates its sample).
- **Fix:**
  - Compute the counts with `groupBy`/`count` on the full set.
  - Paginate the browsing table with `?page=` (25 or 50 per page, `aria-current="page"` on the current page), or add "Show 200 more" with a visible "Showing 200 of 812".
- **Effort:** M. **Track:** T2.

**NV-13 [P2] Imports row actions have no row in their names and are 24 px on touch.**
- **Evidence:**
  - `components/DashboardActions.tsx:287-337` (Ingest / Re-ingest), `:348-370` (Clear), `:516-551` (Lock / Unlock), used at `dashboard/page.tsx:489-506`.
  - `variant="link"` skips the size scale (`Button.tsx:81`), so these get `min-h-6` (24 px) and none of the `coarse:min-h-[44px]`.
  - The accessible names are "Ingest", "Clear" and "Lock", identical in every row.
- **Breaks:** UX-73, UX-11, UX-8. It extends DASH-4, which measured them at 20 px. They are 24 px now, but still not 44 on touch.
- **Fix:**
  - Pass `aria-label={`Ingest ${tournamentName ?? host}`}` (and the same for the others).
  - Use `variant="ghost" size="sm"` so the touch scale applies, or give the `link` variant `coarse:min-h-[44px]`.
- **Effort:** S. **Track:** T2.

**NV-14 [P2] The sticky desktop header can cover focused controls; there is no `scroll-padding-top`.**
- **Evidence:**
  - `app/(app)/layout.tsx:46` is `md:sticky md:top-0`, about 60 px. `app/globals.css` has no `scroll-padding`.
  - Tabbing backwards up a long `/cv` ledger or `/cv/stats` puts small 24-32 px controls under the header. The settings side nav is also sticky (`settings/layout.tsx:26`, `md:top-20`).
  - `PageJumpNav` targets use `scroll-mt` (fine for anchors only).
- **Breaks:** UX-74 (SC 2.4.11), UX-78.
- **Fix:** `@media (min-width: 768px) { html { scroll-padding-top: 4.5rem } }` in `globals.css`.
- **Effort:** S. **Track:** T1. Needs a browser to confirm.

**NV-15 [P2] Onboarding has no Back step, and the header leads first-run users into redirect loops.**
- **Evidence:**
  - `components/OnboardingFlow.tsx`: the pick step offers no way back to scan (for example to rescan after connecting the right inbox), and the preflight step can only go forward ("Skip to picking names", `:342`). Step state is client-only; resume works through the server-derived `initialPhase` (`onboarding/page.tsx:104-105`), which is good.
  - During onboarding the full signed-in nav is shown, but Record, Statistics and Imports each `redirect('/onboarding')` while nothing is claimed (`cv/page.tsx:74`, `cv/stats/page.tsx:45`, `dashboard/page.tsx:64`). Three of four nav items bounce back, and none is marked current.
- **Breaks:** UX-83, UX-47, UX-54 (spirit: a link that redirects is a dead end).
- **Fix:**
  - Add a "Back: scan again" ghost button on the pick step that calls `goTo('scan')`.
  - While `claimedCount === 0`, render the header with only Settings plus a current "Setup" item, or let `/dashboard` render for unclaimed users. Imports is a legitimate place to retry failed links during setup, and the onboarding copy already links there (`OnboardingFlow.tsx:379`), which is itself a redirect loop today.
- **Effort:** M. **Track:** T5 (+ T1 for the header).

**NV-16 [P2] More than one filled primary in a view.**
- **Evidence:**
  - `components/ParticipantSearch.tsx:201-212` makes every search hit's "This is me" a primary. Its names do not say which hit, and every hit shows "Claiming…" while one claims.
  - `/cv` when Gmail is disconnected **and** the record is empty shows "Reconnect from imports" and "Open imports" (`cv/page.tsx:144, 211`): two primaries, both to `/dashboard`.
  - `AdminTagProposals.tsx:304-313` has a primary "Approve" on every row.
- **Breaks:** UX-65, UX-11.
- **Fix:**
  - Hits: `variant="outline"` with `aria-label={`This is me: ${hit.name}, ${hit.tournament}`}`, and track the in-flight id rather than one boolean.
  - `/cv`: drop the empty state's action when the disconnect notice is showing.
  - Admin: `outline` per row; keep "Approve all" as the one primary.
- **Standard check:** for the admin queue, per-row primaries are a defensible operator convention; P3 there.
- **Effort:** S. **Track:** T2, T3, T6.

**NV-17 [P2] The 404 has no navigation and only "Back to home"; the global error has no way out.**
- **Evidence:**
  - `app/not-found.tsx:9-23`. Browser on `/this-does-not-exist`: no header, nav or footer, the site's default title, one link to `/`. A signed-in user who follows a stale link is sent to `/`, which redirects to `/cv` (`app/page.tsx:12`), so they get there, but the page never says so.
  - `app/global-error.tsx:56-67`: only "Try again".
- **Breaks:** UX-84, UX-76, UX-87.
- **Fix:**
  - Export `metadata = { title: 'Page not found' }`. Render the `Footer`. Offer "Open your record" (signed in) or "See a sample CV" (signed out), using `auth()` in the server component.
  - Add a plain `<a href="/">` to `global-error`.
- **Effort:** S. **Track:** T1.

**NV-18 [P2] Phone nav strips do not keep the current item in view, and two strips give no overflow cue.**
- **Evidence:**
  - The header strip (`app/(app)/layout.tsx:84-89`) and `CvSubNav` (`components/CvSubNav.tsx:35`) have the mask fade, but nothing scrolls the current item into view (0 `scrollIntoView` in the codebase). An admin on `/admin` at 320 px, or on `/cv/verify` (the fifth `CvSubNav` item), lands with the current item behind the fade.
  - `SettingsSideNav.tsx:18` and `PageJumpNav.tsx:71` overflow below `md`/`lg` with no mask and no arrow. The stats jump nav also does not follow the active section horizontally.
- **Breaks:** UX-55.
- **Fix:** one tiny client hook `useScrollCurrentIntoView(navRef)` that, on mount, runs `navRef.current.querySelector('[aria-current]')?.scrollIntoView({ inline: 'center', block: 'nearest' })`. Use the same mask class on the settings and jump-nav strips.
- **Effort:** S. **Track:** T1, T3, T4, T5. Needs a browser at 320 px.

**NV-26 [P2] Empty states without a direct action on Imports and Verify.**
- **Evidence:**
  - `dashboard/page.tsx:232-236` (no data) says "Click Scan Gmail" but has no button; the Scan button is in the masthead.
  - `:314-318` ("No failed URLs") says "Pick another filter chip" instead of linking "Show all URLs".
  - `cv/verify/page.tsx:164-169` "No ingested tournaments found yet." has no link.
- **Breaks:** UX-24, UX-84, UX-80 ("nothing matches" with a way back).
- **Fix:** add `action` props: `<ScanButton/>` (or "Upload a CSV" when disconnected), "Show all URLs" → `?filter=all`, and "Open imports".
- **Effort:** S. **Track:** T2, T6.

### P3

**NV-19 [P3] Button labels without an object.**
- **Evidence:**
  - "Send" in the report dialog (`CvRowReportButton.tsx:277`); the title is "Report a problem with X", so "Send report".
  - ".json" (`CvDownloadButton.tsx:193`) → "Download JSON Resume".
  - "Clear" per Imports row (`DashboardActions.tsx:370`) → "Reset import".
  - "Delete my data" opens a confirm whose final button says "Permanently delete my account" (`AccountActions.tsx:149, 293`); use one noun.
- **Breaks:** UX-66.
- **Effort:** S. **Track:** T3, T2, T5.

**NV-20 [P3] Dialog buttons never stack on phones, and in-page forms put the primary on the right.**
- **Evidence:**
  - `CvRowReportButton.tsx:266` (`flex justify-end`) keeps Cancel and Send side by side at 320 px.
  - `OnboardingFlow.tsx:401` and `IdentityManager.tsx:240` push the primary to the right with `justify-between`. The inline confirms in `AccountActions.tsx` put it on the left, so the app has both orders.
- **Breaks:** UX-67.
- **Fix:** dialog footer `flex flex-col-reverse gap-2 sm:flex-row sm:justify-end`; in-page forms primary-left.
- **Effort:** S. **Track:** T3, T5.

**NV-21 [P3] Icon-only utilities have no visible tooltip.**
- **Evidence:** `NotificationBell` and `UserMenu` (`aria-label="Account menu"`) have none, and neither does `PageJumpNav`'s back-to-top (`:100-122`). `ThemeToggle` relies on `title` (hover only, not focus).
- **Breaks:** UX-72.
- **Standard check:** a bell and an avatar are among the most recognised icons; this is polish. One `Tooltip` primitive (hover and focus) in `components/ui/` would serve all four.
- **Effort:** S. **Track:** T1.

**NV-22 [P3] Two views are not in the URL.**
- **Evidence:** the cross-tab grid and metric (`components/stats/CrossTabsSection.tsx:192-193`) and the admin tag-proposal status filter (`AdminTagProposals.tsx:78`) are `useState`, so reload and Back lose them.
- **Breaks:** UX-60, UX-79.
- **Fix:** `?grid=seat-type&metric=win` through the same `replaceState` helper `FilterableStats` uses; `?status=` on `/admin/tags`.
- **Effort:** S. **Track:** T4, T6.

**NV-23 [P3] Segmented controls wrap to two rows on a phone.**
- **Evidence:** `CrossTabsSection.tsx:162` (`inline-flex flex-wrap`) with labels like "Pairing × motion type" and "Speaker avg vs you"; the pairing and seat groups in `StatsFilterBar.tsx:214, 235`.
- **Breaks:** UX-63.
- **Fix:** below `sm`, a labelled `<select>` for the grid and metric choice; keep the segments at `sm` and up.
- **Effort:** S. **Track:** T4. Needs a browser at 320/390 px.

**NV-24 [P3] Filter chips jump to the top of the page.**
- **Evidence:** `dashboard/page.tsx:458`; `FilterTile` at `:653`. Neither passes `scroll={false}`, so each chip click re-scrolls past the tiles. `VerifyMineOnlyToggle.tsx:29` uses `router.replace` with default scrolling too.
- **Breaks:** UX-78.
- **Fix:** `scroll={false}` on the chips (not on the tiles, which open the table below) and `router.replace(url, { scroll: false })`.
- **Effort:** S. **Track:** T2, T6.

**NV-25 [P3] The public CV and the 404 lack the Privacy and Terms links that every other shell has.**
- **Evidence:** `app/u/[slug]/layout.tsx:26-36` (only "Build your own →"); `app/not-found.tsx` (no footer). There is no contact or "report a problem" link in `Footer.tsx` at all.
- **Breaks:** UX-87.
- **Standard check:** UX-87 cites SC 3.2.6 as a P1 when the order differs. SC 3.2.6 covers **help** mechanisms (contact details, self-help), not privacy or terms links. The app's only help channel is the per-row report button and the issue link on `/privacy`, so this is not an A failure. P3, and the standard's severity line should say "P1 if a *help* link moves".
- **Fix:** add Privacy · Terms to the public CV footer after "Build your own"; render `Footer` in the 404 (NV-17).
- **Effort:** S. **Track:** T6.

**NV-27 [P3] Repeated link text on `/cv/verify`.**
- **Evidence:** each card has "Show what the parser read" (`cv/verify/page.tsx:234-241`) and "Source" (`:198-204`), with different destinations and the same text. ADM-11 flagged the new tab only.
- **Breaks:** UX-85, UX-11.
- **Fix:** `aria-label` or sr-only text with the tournament name.
- **Effort:** S. **Track:** T6.

**NV-28 [P3] Landmark labels.**
- **Evidence:** the landing `<nav>` has no label (`app/page.tsx:90`); browser rotor shows "?" beside "Site links". On `/privacy` and `/terms` the browser found an empty second `<header>` inside `main` (from the page's own header markup).
- **Breaks:** UX-51.
- **Fix:** `aria-label="Sections"`; check `privacy/page.tsx:14` for an emptied `header`.
- **Effort:** S. **Track:** T6.

**NV-29 [P3] Downloads are buttons that navigate.**
- **Evidence:** `AccountActions.tsx:111-121` ("Download my data (JSON)", `window.location.href`) and `CvDownloadButton.tsx:184-193` (`window.location.assign`).
- **Breaks:** UX-64.
- **Fix:** `<a href="/api/account/export" download className={buttonClasses({ variant: 'secondary' })}>` (the export is a GET).
- **Standard check:** the data export uses the user's choices from the popover, so that one is fine as a button.
- **Effort:** S. **Track:** T5, T3.

**NV-30 [P3] Danger style on a trigger, and an undo-less reset.**
- **Evidence:**
  - "Delete my data" (`AccountActions.tsx:138-149`) is `danger` before the confirmation step; UX-69 reserves the style for the final button.
  - The Imports row "Clear" (Trash icon, `DashboardActions.tsx:348-370`) resets a failed import with no confirmation and no Undo. It is recoverable by re-ingesting, so no confirmation is right, but the trash icon overstates it.
- **Breaks:** UX-69.
- **Fix:** trigger `outline` with destructive text colour; rename "Clear" to "Reset" with `RotateCcw`.
- **Effort:** S. **Track:** T5, T2.

**NV-31 [P3] The Imports header grows to four controls while ingesting.**
- **Evidence:** "Ingest all", "Stop", "Upload CSV" and "Scan Gmail" (`dashboard/page.tsx:162-166`, `DashboardActions.tsx:178-189`).
- **Breaks:** UX-75.
- **Fix:** put "Stop" inside `IngestProgressTracker` (it is about the running job, not the page), or hide Upload CSV while ingesting.
- **Effort:** S. **Track:** T2.

## Where the standard itself may be too strict or too lenient

These notes come from reading the rules against this app (desktop-first, data-dense, opened on phones between rounds). No new sources were fetched for them.

- **UX-48 (one nav level per destination).** For this app, Statistics in both the header and `CvSubNav` is useful on a phone, where the header strip scrolls away. The real defect is the two navs disagreeing about "current" (NV-3). Suggest rewording: "may repeat if both mark it current".
- **UX-76 (`h1` matches nav).** Allow "title equals nav label; `h1` starts with it or is the record owner's name". As written, the CV page's correct `h1` (the debater's name) fails.
- **UX-87 severity.** SC 3.2.6 applies to help mechanisms only. Privacy and Terms placement is good practice, not an A failure (NV-25).
- **UX-65 for operator queues.** Per-row primary "Approve" in a review queue is common and arguably clearer than outline buttons. Exempt admin-only review tables, or keep it P3.
- **UX-70 (`aria-disabled` while loading).** It is right, but it is a behaviour change in a shared primitive: every form that relied on `disabled` to block a second submit needs the click guard to move into `Button`. Treat it as one task with a test, not a sweep of call sites.
- **UX-74 is too lenient about the phone case.** The header is not sticky below `md`, but `PageJumpNav`'s back-to-top button and the settings aside are fixed or sticky. The rule's wording ("do not pin bars on read-only pages") should also cover floating buttons over the last table row on a 320 px screen.
- **UX-81.** "Over about 50 rows paginates" would force pagination on a season record that users want whole. The rule already exempts that. Imports (NV-12) is the case that matters, and it is a correctness bug as much as a pagination one.

## Proposed split

| Track | Findings |
|---|---|
| T1 Shell and primitives | NV-1, NV-5 (primitive), NV-14, NV-17, NV-21, the `NavLink` half of NV-3, the hook for NV-18, the `Footer` part of NV-8, and NV-11 with T6 |
| T2 Imports | NV-6 (Re-ingest selected), NV-12, NV-13, NV-24, NV-26 (Imports), NV-31, NV-30 ("Clear"), and the ParticipantSearch half of NV-16 |
| T3 Record | NV-4 (`CvSubNav` contents and placement), NV-16 (`/cv` double primary), NV-19 (report dialog), NV-20 (dialog stacking), NV-29 (JSON Resume) |
| T4 Statistics | NV-22 (cross-tabs URL), NV-23, the jump-nav part of NV-18 |
| T5 Onboarding and settings | NV-7 (settings and onboarding titles and `h1`s), NV-15, NV-6 (Save), NV-30 (delete trigger), the settings strip in NV-18 |
| T6 Public, legal, admin | NV-2, NV-9, NV-10, NV-11, NV-25, NV-27, NV-28, NV-8 (privacy, terms, verify), NV-22 (admin filter), NV-4 (admin links) |

Do first: NV-1, NV-2, NV-5 and NV-3. They are small and remove the two P1s and the most widespread P2s.

## Needs a browser or a login to verify

- **The 390 px and 320 px rendering of every strip** (header, `CvSubNav`, settings, jump nav):
  - whether the current item is visible on arrival (NV-18);
  - whether segments wrap (NV-23);
  - whether the signed-out landing nav fits at 320 (`app/page.tsx:90-99`).

  The browser window could not be resized in this session.
- **Focus after route change (NV-1):** press Tab after clicking "Statistics" in the header, and after onboarding's `router.push('/cv')`.
- **Sticky-header focus obscuring (NV-14):** Shift+Tab up `/cv` and `/cv/stats` at 1280 px.
- **Every signed-in route except one `/cv` render:**
  - which header item is lit on `/cv/motions`, `/cv/tags` and `/cv/verify` (NV-3);
  - real titles on settings and verify (NV-7), which may differ in production as `/cv` did;
  - the Imports header while ingesting (NV-31);
  - `/admin` button styles (NV-9).
- **Pending-state focus loss (NV-5):** click "Save changes" or "Scan Gmail" with a keyboard and check `document.activeElement`.
- **The HTTP status of `/u/<missing>` after a segment-level `not-found.tsx` is added (NV-2):** streaming may still return 200.
- **Onboarding (NV-15):** needs an account with no claimed identities; the seed user has claims, so `/onboarding` shows the "already set up" branch.
- **Imports past 200 URLs (NV-12):** needs a seeded user with more than 200 discovered URLs.
- **Why production's `/cv` title ("Record") differs from `main` ("My CV")**: check which commit is deployed before fixing NV-7 against `main`.
