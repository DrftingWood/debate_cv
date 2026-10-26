# debate_cv code-health snapshot (2026-10-26)

Repo: `C:\Users\achar\Documents\6. Projects\2. Debate CV\debate_cv`. Read-only measurement: nothing was built, installed or run against a DB. The counts come from `find | wc -l` and `grep -rEo` (Git Bash). Values marked *approx* are estimates.

## 1. Lines of code by area

| Area | Files counted | Lines | Notes |
|---|---|---|---|
| app | 85 (.ts 47, .tsx 38) | 9,619 | plus 1 .css (not counted) |
| lib | 79 (.ts) | 18,161 | |
| components | 56 (.tsx) | 9,140 | |
| tests | 144 .ts (142 `*.test.ts` + 2 setup helpers) | 20,618 (TS only) | 21,268 incl. 1 .py + 3 .sql; 2 .json fixtures not counted |
| scripts | 5 .mjs + 1 .py + 1 .sql | 2,045 | .mjs only = 1,758; 6 .txt URL lists (810 lines) not counted |
| prisma | schema.prisma + 36 migration .sql | 1,574 | schema 637, migrations 937 |
| root config .ts | 9 | 460 | middleware, next.config, tailwind.config, sentry x3, etc. |

- Total TypeScript files (.ts/.tsx, excluding node_modules, .next and next-env.d.ts): **372**.
- App + lib + components TS source: **36,920 lines**.

## 2. The 25 largest source files (excluding tests and migrations)

| # | File | Lines |
|---|---|---|
| 1 | lib/calicotab/ingest.ts | 2,331 |
| 2 | lib/calicotab/parseTabs.ts | 1,291 |
| 3 | lib/cv/buildCvData.ts | 1,264 |
| 4 | lib/cv/speakerStats.ts | 1,182 |
| 5 | components/stats/StatsSections.tsx | 797 |
| 6 | app/(app)/cv/page.tsx | 769 |
| 7 | lib/calicotab/parseNav.ts | 764 |
| 8 | scripts/seed-dev-data.mjs | 622 |
| 9 | lib/calicotab/fetch.ts | 615 |
| 10 | app/(app)/dashboard/page.tsx | 609 |
| 11 | lib/calicotab/tabbycatApiRounds.ts | 599 |
| 12 | scripts/seed-from-corpus.mjs | 570 |
| 13 | app/(app)/cv/verify/page.tsx | 561 |
| 14 | lib/calicotab/tabbycatApi.ts | 557 |
| 15 | scripts/test-scrape.mjs | 484 |
| 16 | components/DashboardActions.tsx | 471 |
| 17 | components/OnboardingFlow.tsx | 444 |
| 18 | lib/cv/judgingLens.ts | 410 |
| 19 | app/page.tsx | 401 |
| 20 | components/stats/StatsViews.tsx | 399 |
| 21 | components/stats/CareerViews.tsx | 352 |
| 22 | lib/calicotab/parseMotions.ts | 338 |
| 23 | app/u/[slug]/page.tsx | 335 |
| 24 | lib/calicotab/stageLexicon.ts | 319 |
| 25 | lib/cv/exportFields.ts | 316 |

## 3. Longest functions in the 10 largest source files (approximate)

**Method (approx):** an awk pass took each top-level `function`/`const x = (...) =>` declaration and measured its span as the distance to the next top-level declaration. I checked the largest spans by hand against the closing `}` at column 0. Spans can include trailing comments and nested helpers. Lengths are in lines.

| File | Function (start line, ~length) |
|---|---|
| lib/calicotab/ingest.ts | writeIngestTransaction (1229, ~450); fetchAndParseTabs (790, ~278); finalizePostTransaction (1680, ~125); checkCacheFreshness (671, ~111); loadLandingAndFingerprint (569, ~102) |
| lib/calicotab/parseTabs.ts | roundResultsFromVue (831, ~145); speakerTabFromVue (693, ~125); participantsFromVue (1133, ~89); parseParticipantsList (1222, ~57); diagnoseVueData (150, ~56) |
| lib/cv/buildCvData.ts | buildCvData (326, **939**; it is the only top-level function after line 326 and runs to EOF at 1264) |
| lib/cv/speakerStats.ts | computeSpeakerStats (491, ~450); deriveQuirks (1047, ~136); buildBins (950, ~35); toSplits (415, ~27); creditAgg (392, ~23) |
| components/stats/StatsSections.tsx | FieldStanding (246, ~163); Splits (579, ~101); HeadlineStats (24, ~97); RoundDynamicsSection (409, ~88); ResultsSection (497, ~82) |
| app/(app)/cv/page.tsx | CvPage (50, ~208); SpeakingTable (446, ~199); RoundLedger (324, ~122); JudgingTable (645, ~115); ReportCell (292, ~32) |
| lib/calicotab/parseNav.ts | extractNavigation (94, ~122); extractRegistration (216, ~100); extractSpeakerRoundsFromVue (658, ~83); extractAdjudicatorRoundsFromVue (444, ~62); detectWonFromCellHtml (569, ~53) |
| scripts/seed-dev-data.mjs | main (242, ~373); wipe (226, ~16); nextMotion (100, ~6); normal (58, ~5); rand (53, ~5) |
| lib/calicotab/fetch.ts | fetchHtmlWithProvenance (352, ~81); throttledFetch (193, ~81); storeSourceDocument (433, ~48); fetchWithRetry (274, ~37); withApiSnapshots (481, ~35) |
| app/(app)/dashboard/page.tsx | Dashboard (47, ~401); FilterTile (564, ~46); RowActions (477, ~44); FilterChip (449, ~28); TournamentMetrics (521, ~27) |

## 4. TypeScript compiler flags (tsconfig.json)

| Flag | Status |
|---|---|
| strict | **true** |
| noUncheckedIndexedAccess | absent |
| exactOptionalPropertyTypes | absent |
| noImplicitOverride | absent |
| noFallthroughCasesInSwitch | absent |
| noImplicitReturns | absent |
| noUnusedLocals / noUnusedParameters | absent |
| noPropertyAccessFromIndexSignature | absent |
| useUnknownInCatchVariables | implied by strict |
| allowJs | false |
| skipLibCheck | true |
| isolatedModules | true |
| target / module / moduleResolution | ES2022 / esnext / bundler |
| include | `**/*.ts`, `**/*.tsx` (so tests and config files are type-checked as well) |

## 5. ESLint configuration (eslint.config.mjs, flat config via FlatCompat)

| Item | Value |
|---|---|
| Rule sets | `next/core-web-vitals`, `next/typescript` (through `compat.extends`) |
| Turned off | `react/no-unescaped-entities` (the comment says Phase 3 rewrites this copy) |
| Downgraded to warn | `@typescript-eslint/no-unused-vars` (warn, `^_` ignored for args and vars) |
| Ignores | `.next/**`, `node_modules/**`, `prisma/migrations/**`, `next-env.d.ts` |
| Type-aware linting | **Off**: no `parserOptions.project`/`projectService`, and no `recommended-type-checked` set |

## 6. Pattern counts in app, lib, components and scripts (.ts/.tsx/.mjs; tests excluded)

| Pattern | app | lib | components | scripts | Total | Note |
|---|---|---|---|---|---|---|
| `: any` | 0 | 0 | 0 | 0 | **0** | the raw grep found 4 hits, all in English comments ("any Person", "any row") |
| `<any>` | 0 | 0 | 0 | 0 | 0 | |
| `as any` | 0 | 0 | 0 | 0 | 0 | |
| `as unknown as` | 0 | 7 | 0 | 0 | 7 | ingest.ts x3 (Decimal to undefined), db.ts x1 (globalThis), tags/classify*.ts x3 (z.enum tuples) |
| `@ts-ignore` | 0 | 0 | 0 | 0 | 0 | |
| `@ts-expect-error` | 0 | 0 | 0 | 0 | 0 | |
| `eslint-disable` lines | 1 | 0 | 3 | 0 | 4 | top rules (tie): `react-hooks/exhaustive-deps` x2 (OnboardingFlow.tsx), `@next/next/no-img-element` x2 |
| non-null `!.` | 1 | 7 | 2 | 0 | 10 | approx |
| non-null `!)` | 1 | 10 | 0 | 0 | 11 | approx |
| non-null, broader (`!.` `!)` `![` `!,` `!;` etc.) | | | | | ~35 | approx; app, lib and components only. Concentrated in parseNav.ts, crossTabs.ts, judgingLens.ts, u/[slug]/page.tsx |
| `TODO` | 0 | 0 | 0 | 0 | 0 | |
| `FIXME` | 0 | 0 | 0 | 0 | 0 | |
| `console.log/info/warn/error(` | 10 | 18 | 0 | 69 | 97 | lib: auth.ts 6, ingest.ts 6, gmail/client.ts 2; app: 1 each in 10 files |
| `$queryRaw` (tagged) | 1 | 5 | 0 | 0 | 6 | |
| `$queryRawUnsafe` | 3 | 0 | 0 | 0 | 3 | all in app/api/admin/schema-probe/route.ts |
| `$executeRaw` | 1 | 7 | 0 | 0 | 8 | queue.ts 2, provenance.ts 3, ingest.ts 2, admin/migrations/clear-orphans 1 |
| `$executeRawUnsafe` | 0 | 0 | 0 | 0 | 0 | |

## 7. Tests

| Metric | Value |
|---|---|
| Test files (`*.test.ts`) | **142** (117 in tests/, 25 in tests/api/). 20 of the 142 are `__*.live.test.ts` (2,157 lines), gated by `describe.skipIf`/`runIf` (21 such guards) |
| Other test-tree files | 2 setup .ts, 1 Python test, 3 SQL (tests/corpusdb), 2 JSON fixtures |
| Test cases, start-of-line `it(`/`test(` plus variants | **1,273** (23 of them in live files) |
| Raw token counts | `test(` 825, `it(` 433, `test.each` 33, `it.each` 5 (a `.each` expands to more cases at runtime) |
| `describe(` blocks | 333 |
| Test lines / source lines | 20,618 / 36,920 TS source = **0.56** (0.53 if the 1,758 script .mjs lines are added) |

**lib modules with no test file of matching name** (22 of 79). Heuristic: no file in tests/ or tests/api whose dot-separated name contains the module basename. Some modules may be covered indirectly through other tests. Two names are near-misses: fetchSession has `calicotab.fetchSessionSlot.test.ts`, and prelimRoundCount has `calicotab.pickPrelimRoundCount.test.ts`.

| Module | Lines |
|---|---|
| lib/cv/buildCvData.ts | 1,264 |
| lib/calicotab/fetchSession.ts | 203 |
| lib/tags/classifyMotions.ts | 157 |
| lib/rateLimit.ts | 156 |
| lib/gmail/run.ts | 133 |
| lib/auth.ts | 121 |
| lib/tags/classifyTournaments.ts | 112 |
| lib/cv/headerMetrics.ts | 95 |
| lib/cv/teamRanks.ts | 74 |
| lib/calicotab/prelimRoundCount.ts | 63 |
| lib/sharing/slug.ts | 62 |
| lib/calicotab/version.ts | 59 |
| lib/cvErrorReports/categories.ts | 58 |
| lib/utils/cn.ts | 55 |
| lib/privacy/suppression.ts | 39 |
| lib/cv/speakerSignals.ts | 38 |
| lib/auth/reconnectGmail.ts | 29 |
| lib/tags/todo.ts | 27 |
| lib/cv/roleClassification.ts | 20 |
| lib/utils/csv.ts | 19 |
| lib/utils/site.ts | 19 |
| lib/auth/signOutAction.ts | 18 |

## 8. API routes

There are 45 `route.ts` files. 15 of them read `req.json()`, and 14 of those 15 import zod. The one that does not is admin/migrations/clear-orphans, which checks types by hand against an allowlist. 14 routes import zod in total.

| Route (lines) | Input | Zod? |
|---|---|---|
| app/api/admin/tags/classify/route.ts (186) | POST JSON body | **Yes**: `Body.safeParse(await req.json())` |
| app/api/cron/process-queue/route.ts (179) | GET/POST, `?respond` query param + secret header | No (no body; one query flag compared to a literal) |
| app/api/sharing/route.ts (169) | GET none; POST JSON body | **Yes**: `Body.safeParse` |
| app/api/ingest/gmail/route.ts (167) | POST, no request input read | No (nothing to validate) |
| app/api/tournaments/[id]/participants/route.ts (164) | path `id`, `?q` query | No: manual `BigInt(id)` try/catch and a minimum-length check on `q` |

## 9. Duplication hotspots (helpers with the same name defined in several files; found by grepping declarations)

| Helper | Files defining it |
|---|---|
| `signed` (6) | lib/cv/crossTabs.ts, components/stats/{BreakViews, CrossTabsSection, StatsViews, TopicTypeSection}.tsx, components/StatsSplitTable.tsx |
| `pct` (6) | lib/cv/speakerStats.ts, components/stats/{CareerViews, JudgingViews, StatsViews}.tsx, components/StatsSplitTable.tsx, components/ui/BarList.tsx |
| `mean` (5) | lib/cv/{buildCvData, roundSplits, speakerStats, statsFacts, teammateStats}.ts |
| `plural` (4) | components/stats/{BreakViews, CareerViews, JudgingViews, StatsViews}.tsx |
| `cleanText` (4) | lib/calicotab/{cheerioToVue, parseMotions, parseTabs}.ts, scripts/test-scrape.mjs |
| `cellText` (4) | lib/calicotab/{parseMotions, parseNav, parseTabs}.ts, scripts/test-scrape.mjs |
| `numericAvg` (2) | lib/cv/exportFields.ts, lib/cv/speakerStats.ts |
| `reachedFinal` (2) | lib/cv/milestones.ts, lib/cv/speakerStats.ts |
| `initials` (2) | app/u/[slug]/page.tsx, components/UserMenu.tsx |
| `isCloudflareChallenge`, `parseTeamTab`, `parseSpeakerTab`, `parseRoundResults`, `parseBreakPage`, `vueCol` | lib/calicotab/{fetch,parseTabs}.ts, re-implemented in scripts/test-scrape.mjs |
| Route preamble | 29 routes call `await auth()` and 30 return an inline `{ error: 'unauthorized' }` 401; 17 routes reference an admin check |

## 10. Dependencies (package.json)

| Metric | Value |
|---|---|
| dependencies | **17** |
| devDependencies | **13** |
| Caret on a pre-release version | **None**. `next-auth` is the only pre-release and it is pinned exactly at `5.0.0-beta.25` |
| Caret on 0.x versions (caret allows only patch-level moves here) | `@anthropic-ai/sdk ^0.104.1`, `@tailwindcss/typography ^0.5.19` |
| Lockfile | package-lock.json (npm) |

## 11. Client components

| Metric | Value |
|---|---|
| components/*.tsx with `'use client'` | **34 / 56** (61%) |
| app/*.tsx with `'use client'` | 3 / 38 (error.tsx, (app)/error.tsx, global-error.tsx) |

Five largest client components:

| File | Lines |
|---|---|
| components/DashboardActions.tsx | 471 |
| components/OnboardingFlow.tsx | 444 |
| components/AdminTagProposals.tsx | 302 |
| components/CvDownloadButton.tsx | 279 |
| components/stats/StatsFilterBar.tsx | 253 |
