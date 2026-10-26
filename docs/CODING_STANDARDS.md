# Coding standards

Written 2026-10-27 (Q1 phase 1b). Derived from `docs/CODE_STANDARDS_REVIEW-2026-10-26.md`, the cited criteria in `docs/CODE_STANDARDS-CHECKLIST-2026-10-26.md` (IDs such as **S5** or **X1** below point there), the duplication list in `docs/CODE_METRICS-2026-10-26.md` §9 and the conventions already in `CLAUDE.md`. How each check runs, and which ones block, is in `docs/CI_PLAN-2026-10-27.md`.

Forty rules. Each has a reason, an example from this repository and an enforcement. A rule with neither a mechanical check nor a named review question was cut; the cut list is at the end. These rules apply to **new and changed code**. They are not a licence to rewrite working code for style (`CLAUDE.md`, "Out of scope").

**Enforcement key.** `lint` = ESLint in `npm run lint` (an `error` blocks, a `warn` is counted). `type` = `npm run typecheck`. `test` = Vitest in `npm test`. `ratchet` = `npm run ratchet` (blocks any rise). `CI` = a step in `.github/workflows/ci.yml`, marked *blocking* or *report*. `Q` = a question the reviewer asks; the PR template carries the most important ones.

## Summary

| ID | Rule | Enforcement |
|---|---|---|
| ST-1 | New files stay under 400 counted lines; none over 800 | lint `max-lines` (warn) + Q |
| ST-2 | Functions: ≤60 lines, complexity ≤15, ≤3 params, nesting ≤3 | lint (warn) |
| ST-3 | Split along real seams into deep modules, not into many shallow helpers | Q |
| ST-4 | No import cycles | CI report: dependency-cruiser `no-circular` |
| ST-5 | `lib/` never imports from `app/` or `components/` | CI report: dependency-cruiser `lib-not-to-app-or-components` |
| ST-6 | No new `any`, `as unknown as`, non-null `!` or unexplained `eslint-disable` | ratchet (CI blocking) |
| TE-1 | zod parses every boundary; a bad request gets 400 with `{ error: 'bad_request', details }` | Q + test (`tests/api`) |
| TE-2 | The compiler flags stay on | type (CI blocking) |
| TE-3 | No swallowed errors | Q |
| DB-1 | Only `lib/db.ts` constructs `PrismaClient` | lint `no-restricted-syntax` (error) + CI report: dependency-cruiser `no-prisma-outside-lib` |
| DB-2 | Raw SQL only as tagged templates or `Prisma.sql`; `*Unsafe` only with constant SQL | Q |
| DB-3 | A raw `UPDATE` sets `"updatedAt" = NOW()` itself | Q + test (queue suites) |
| DB-4 | The ingest advisory lock is the first statement of its transaction; lock order does not change without the deadlock tests | test (`calicotab.deadlock`, `calicotab.advisoryLock`) + Q |
| DB-5 | Multi-row writes run in one `$transaction`; migrations are append-only | Q |
| SE-1 | No secret, token, connection string or private tournament URL in logs, chat, PR text, fixtures or snapshots | CI report: gitleaks + Q |
| SE-2 | Gmail tokens are stored only through `lib/crypto.ts` | test (`crypto`, `gmail` suites) + Q |
| SE-3 | Every route handler checks auth itself | test (`tests/api`) + Q |
| SE-4 | Secrets come from env only; only `NEXT_PUBLIC_*` reaches the client; CI reads no repo secrets | CI report: gitleaks + Q |
| SE-5 | `dangerouslySetInnerHTML` only for our own constant strings, never scraped text | Q |
| TQ-1 | A logic change ships with its test in the same PR | Q + CI blocking (`npm test`) |
| TQ-2 | Characterization tests land before a refactor, and the refactor PR does not change their expected values | Q |
| TQ-3 | Tests are deterministic; network tests are `__*.live.test.ts` and skip without their env | Q |
| NC-1 | Comments say why, in the existing narrative voice; none restate the code | Q |
| NC-2 | New and changed files follow `.prettierrc` | CI report: `prettier --check` |
| PF-1 | No Prisma call inside a loop over rows | Q |
| PF-2 | Server Components by default; `'use client'` only on small interactive leaves | Q |
| AX-1 | Tabular data uses real tables with `<th scope>` (`components/ui/DataTable`) | lint (`jsx-a11y` rules from `next/core-web-vitals`) + Q |
| AX-2 | Colour is never the only cue; colour on a number means up or down | Q (`DESIGN_INSTRUCTIONS.md` §6, §13) |
| AX-3 | Everything works from the keyboard with visible focus; targets at least 24×24 px | Q |
| DP-1 | npm only, lockfile committed, CI installs with `npm ci` | CI blocking (`npm ci` fails on drift) |
| DP-2 | A new dependency is justified in the PR and pinned; tool versions at least two weeks old | Q + CI report: knip (unused / unlisted deps) |
| DP-3 | High and critical advisories are tracked and fixed in their own upgrade PR | CI report: `npm audit` |
| DP-4 | Workflows: actions pinned to a commit SHA, `permissions` least-privilege | Q + actionlint (local) |
| GP-1 | Small PRs, one concern; refactors separate from behaviour changes | Q (PR template) |
| GP-2 | Commits and PR bodies carry the attribution lines the session gives | Q (PR template) |
| AI-1 | Search for an existing helper before adding one | CI report: jscpd + Q |
| AI-2 | Never bump `PARSER_VERSION` casually | Q |
| AI-3 | Run typecheck, lint, test, ratchet and `next build` before opening a PR, and say which you could not run | CI blocking (`verify` job) |
| AI-4 | No merge without the owner's say and a green `verify` | branch protection (owner setting) + Q |
| AI-5 | Check versions and APIs against the current docs for the pinned version, and cite them | Q |

## 1. Structure and size limits

**ST-1. New files stay under 400 counted lines; none goes over 800.** *Why:* a reader cannot hold a 1,500-line file in their head, and the checklist's S5 puts the usual range at 100 to 500. *Good:* `lib/queue.ts` keeps one concern (claim, release, sweep) in a file you can read in one sitting. *Bad:* `lib/calicotab/ingest.ts`, 1,565 counted lines, mixing fetch, normalise, persist and enqueue. *Enforced by:* `max-lines` (warn at 400). *Q:* "Is any new file over 800 lines? If so, where is its split note?"

**ST-2. Functions: at most 60 lines, cyclomatic complexity 15, 3 positional parameters, 3 levels of nesting.** *Why:* these are the warn thresholds in the checklist (S2 to S4); past them, review stops catching bugs. *Good:* `claimOnePending(params: { userId?, excludeHosts? } = {})` in `lib/queue.ts` takes an options object rather than a fourth parameter. *Bad:* `writeIngestTransaction` in `ingest.ts` takes 5 positional parameters; `buildCvData` is one 760-line function. *Enforced by:* `max-lines-per-function`, `complexity`, `max-params`, `max-depth`, all `warn`; the counts are in `docs/CODE_STANDARDS_BASELINE-2026-10-27.md` and should only fall.

**ST-3. Split along real seams into deep modules, not into many shallow helpers.** *Why:* both sides of the Martin/Ousterhout debate (checklist §2) condemn the 2,000-line module and also the opposite failure, where a reader flips between ten 5-line functions to follow one idea. *Good:* the seams named for `ingest.ts` in the review: fetch, parse, normalise, persist, enqueue, each with a small interface. *Bad:* carving `buildCvData` into `step1`/`step2` helpers that share all their state. *Q:* "Can a caller use each new module without reading its body?"

**ST-4. No import cycles.** *Why:* a cycle makes both modules' initialisation order matter and neither can be tested or split alone (S6). *Bad (today):* `lib/db.ts → lib/queueDrain.ts → lib/queue.ts → lib/db.ts`, because `db.ts` imports `DRAIN_CONCURRENCY` to size the pool. *Good:* a constant both sides need lives in a third module that imports neither. *Enforced by:* dependency-cruiser `no-circular`, report-only (5 today, 2 of them value cycles).

**ST-5. `lib/` never imports from `app/` or `components/`.** *Why:* `lib/` is the inner layer (A2); a reverse import drags React or route code into the scraper and the queue. *Good:* `components/stats/*` import from `lib/cv/*`, never the other way. *Enforced by:* dependency-cruiser `lib-not-to-app-or-components`, report-only, 0 today: the first candidate to make blocking.

**ST-6. No new `any`, `as unknown as`, non-null `!` or `eslint-disable` without a reason.** *Why:* each one switches the type checker off at the point where it would help (T3, T8). *Bad:* `components/OnboardingFlow.tsx:116`, `// eslint-disable-next-line react-hooks/exhaustive-deps` with no reason; `speakerScoreTotal: sp.totalScore as unknown as undefined` in `ingest.ts`. *Good:* the same directive with ESLint's own reason syntax, `// eslint-disable-next-line react-hooks/exhaustive-deps -- <why>`. *Enforced by:* `npm run ratchet`, blocking in CI. Raising a baseline needs a reason in the PR body.

## 2. Types and errors

**TE-1. zod parses every boundary, and a bad request gets 400 with one shape.** *Why:* data from outside (request bodies, query strings, third-party and LLM JSON) is untyped until parsed; `as T` only tells the compiler to stop checking (D1, D4, X3). *Good:* `app/api/ingest/lock/route.ts`: `Body.safeParse(await req.json().catch(() => ({})))`, then `{ error: 'bad_request', details: parse.error.flatten() }` with status 400. *Bad:* `const body = (await req.json()) as { url: string }`. *Enforced by:* the route tests in `tests/api` assert the 400; *Q:* "Does any new input reach logic without a zod parse?"

**TE-2. The compiler flags stay on.** *Why:* `strict`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `noUnusedLocals` and `noUnusedParameters` each cost nothing today (0 errors when enabled) and catch real mistakes (T1). *Good:* an unused parameter is named `_req`. *Bad:* removing a flag to make a PR compile. *Enforced by:* `npm run typecheck`, blocking.

**TE-3. No swallowed errors.** *Why:* OWASP Top 10 2025 A10 (mishandled exceptional conditions); a silent `catch` turns a failed ingest into a missing tournament with no trace (E2). *Good:* `poolSizedUrl` in `lib/db.ts` catches an unparseable URL and returns it unchanged, with a comment saying why that is safe; `lib/gmail/client.ts` logs `{ userId, message }` before carrying on. *Bad:* `.catch(() => {})` with no comment. *Q:* "Does every new `catch` rethrow, return an error value, or log with context and say why continuing is safe?"

## 3. Data access and Prisma

**DB-1. Only `lib/db.ts` constructs `PrismaClient`.** *Why:* each client opens its own pool; on Vercel a second one per warm lambda doubles connections against Neon's limit, and `db.ts` also sizes the pool to the drain concurrency. *Good:* `import { prisma } from '@/lib/db'`. *Bad:* `new PrismaClient()` in a route. *Enforced by:* ESLint `no-restricted-syntax` (error, blocking; `lib/db.ts` and the standalone `scripts/` are exempt). dependency-cruiser `no-prisma-outside-lib` also reports value imports of `@prisma/client` from `app/` and `components/` (6 today, all enum imports such as `IngestJobStatus`).

**DB-2. Raw SQL only as tagged templates or `Prisma.sql`.** *Why:* the tagged form parameterises every value; string concatenation is SQL injection (X1). *Good:* `claimOnePending` builds its optional filters with `Prisma.sql` and `Prisma.join`. *Acceptable:* `app/api/admin/schema-probe/route.ts` uses `$queryRawUnsafe` with constant SQL and a `$1` parameter. *Bad:* `` $queryRawUnsafe(`... WHERE "userId" = '${id}'`) ``. *Q:* "Does any new raw query build SQL text from a variable?"

**DB-3. A raw `UPDATE` sets `"updatedAt" = NOW()` itself.** *Why:* Prisma's `@updatedAt` fires only on client operations, so raw SQL leaves the column stale and the sweeps that read it misbehave (`CLAUDE.md`, Known gaps). *Good:* `lib/queue.ts`: `SET "status" = 'running', ..., "updatedAt" = NOW()`. *Bad:* the same statement without it. *Enforced by:* the queue tests; *Q:* "Does every new raw UPDATE on a model with `@updatedAt` set it?"

**DB-4. The ingest advisory lock is the first statement of its transaction, and lock order does not change without the deadlock tests.** *Why:* two ingests of one tournament otherwise interleave deletes and writes; taking locks in a different order can deadlock. *Good:* `writeIngestTransaction` opens with `` tx.$executeRaw`SELECT pg_advisory_xact_lock(${fingerprintLockKey(...)})` ``, transaction-scoped so a crash never leaves it held. *Bad:* an upsert before the lock. *Enforced by:* `tests/calicotab.deadlock.test.ts` and `tests/calicotab.advisoryLock.test.ts` in `npm test`; *Q:* "Did this touch lock order, and did you run both suites?"

**DB-5. Multi-row writes run in one `$transaction`; migrations are append-only.** *Why:* a job that fails part-way must leave no half-written tournament (E4), and an edited migration diverges from what production already applied (D5). *Good:* all of a tournament's writes happen inside `prisma.$transaction(async (tx) => ...)`. *Bad:* editing a file under `prisma/migrations/` after it merged. *Q:* "Can this write fail half-way? Is any existing migration edited?"

## 4. Security and secrets

**SE-1. No secret, token, connection string or private tournament URL in logs, chat, PR text, fixtures or snapshots.** *Why:* logs and chat transcripts are kept and shared; a private Tabbycat URL is one participant's credential (OWASP A09; ASVS 5.0 logging chapter). *Good:* `lib/gmail/client.ts` logs `{ userId, message }`, never the token; `ingest.ts` stores only `publicTournamentUrl(normalized)`. *Bad:* `console.log('refreshing', token)`, or pasting a `.env` value into an agent chat. *Enforced by:* gitleaks over the whole history (CI report, 0 findings today); *Q:* "Does any new log line, fixture or snapshot carry a credential or private URL?"

**SE-2. Gmail tokens are stored only through `lib/crypto.ts`.** *Why:* AES-256-GCM at rest with a versioned format (`v1:iv:tag:cipher`) so the key can rotate. *Good:* `encryptValue` on write and `decryptValue(token.accessToken, token.encryptionVersion)` on read in `lib/gmail/client.ts`. *Bad:* writing `refreshToken` straight from the OAuth callback. *Enforced by:* the crypto and gmail suites; *Q:* "Does any new code write a token column without `encryptValue`?"

**SE-3. Every route handler checks auth itself.** *Why:* middleware can be bypassed (CVE-2025-29927; N7); server routes are public endpoints. *Good:* `app/api/ingest/lock/route.ts` starts with `const session = await auth()` and returns 401; admin routes call `requireAdmin()` from `lib/admin.ts`. *Bad:* a route that trusts `middleware.ts` to have checked. *Enforced by:* the 401 cases in `tests/api`; *Q:* "Does the new route check the session or admin role before doing anything?"

**SE-4. Secrets come from env only; only `NEXT_PUBLIC_*` reaches the client; CI reads no repository secrets.** *Why:* anything in the repo or the client bundle is public (X4). *Good:* `getEncryptionKey()` reads `TOKEN_ENCRYPTION_KEY` and fails loudly on a bad length; `ci.yml` builds with no app environment at all. *Bad:* a key in `next.config.ts`, or `secrets.*` in a pull-request workflow. *Enforced by:* gitleaks (CI report); *Q:* "Does a new value need to be secret, and is it `NEXT_PUBLIC_`?"

**SE-5. `dangerouslySetInnerHTML` only for our own constant strings.** *Why:* scraped tab pages are untrusted HTML (X5). *Good:* the one use, `app/layout.tsx`, injects `themeInitScript`, a constant, with the CSP nonce. *Bad:* rendering a scraped motion or team name as HTML. *Q:* "Is anything scraped or user-entered rendered as HTML?"

## 5. Tests

**TQ-1. A logic change ships with its test in the same PR.** *Why:* "a CL that adds or changes logic should be accompanied by new or updated tests" (Google, Q4). Do not add tests to stable, covered components just to have one (`CLAUDE.md`, Out of scope). *Good:* the parser suites (`calicotab.parseTabs.*`) gain a fixture case with each parser change. *Bad:* a scoring change in `lib/cv/speakerStats.ts` with no test diff. *Enforced by:* `npm test` (blocking) runs them; *Q:* "Which test fails if this change is reverted?"

**TQ-2. Characterization tests land before a refactor, and the refactor PR does not change their expected values.** *Why:* they pin today's behaviour, so a split of `buildCvData` or `ingest.ts` is provably behaviour-neutral (H2). *Good:* `tests/cv.buildCvData.characterization.test.ts` and `tests/calicotab.ingest.characterization.test.ts` (Q1 phase 2) before phase 3 splits anything. *Bad:* updating a characterization snapshot inside the refactor PR. *Q:* "Does this refactor PR change any expected value?"

**TQ-3. Tests are deterministic.** *Why:* a flaky suite gets ignored (Q3). *Good:* network-touching suites are named `tests/__*.live.test.ts` and skip unless their env is set, so `npm test` never reaches the internet. *Bad:* a unit test that fetches a real tab page or depends on today's date. *Q:* "Does the new test touch the network, the clock or randomness?"

## 6. Naming and comments

**NC-1. Comments say why, in the existing narrative voice; none restate the code.** *Why:* the code says what; only a comment can carry the constraint, the incident or the trade-off (C1, AI3). *Good:* the doc comment on `poolSizedUrl` in `lib/db.ts` (why the pool is derived here, why it only ever raises the limit). *Bad:* `// increment attempts` above `"attempts" = "attempts" + 1`, or "Step 1: now we..." narration. *Q:* "Would each new comment survive a rename? Does any only repeat the line below it?"

**NC-2. New and changed files follow `.prettierrc`.** *Why:* formatting should never be argued in review (R5). The config was measured against the code (single quotes, semicolons, trailing commas, width 100: the width that changes fewest lines). The repo has not been reformatted and will not be wholesale. *Good:* run `npx prettier --write <the files you touched>`. *Bad:* `prettier --write .` in a feature PR. *Enforced by:* `prettier --check`, CI report (293 files differ today).

## 7. Performance

**PF-1. No Prisma call inside a loop over rows.** *Why:* N+1 queries are the usual cause of slow pages and long ingest transactions (P1). *Good:* `findMany({ where: { id: { in: ids } } })`, `createMany`, or `include`/`select`. *Bad:* `for (const r of rows) await prisma.person.findUnique(...)`. *Q:* "Is there an `await prisma` inside a `for` or `map`?"

**PF-2. Server Components by default; `'use client'` only on small interactive leaves.** *Why:* the directive pulls the module and everything it imports into the client bundle (N1). *Good:* `app/` pages are server components; only `error.tsx`-style files carry the directive. *Bad:* `'use client'` on a page or layout to use one hook. *Q:* "Does the new `'use client'` sit on the smallest component that needs it?"

## 8. Accessibility (WCAG 2.2 AA)

**AX-1. Tabular data uses real tables.** *Why:* screen readers navigate `<table>` with header cells; a div grid reads as a flat list (W1, SC 1.3.1). *Good:* `components/ui/DataTable.tsx` renders `<th scope="col">`. *Bad:* a flex-row "table". *Enforced by:* the `jsx-a11y` rules in `next/core-web-vitals`; *Q:* "Is new tabular data built on `DataTable`?"

**AX-2. Colour is never the only cue, and colour on a number means up or down.** *Why:* SC 1.4.1, and the owner's Ledger rule (`DESIGN_INSTRUCTIONS.md` §6). *Good:* `DeltaChip` in `components/ui/StatTile.tsx` pairs the `pos`/`neg` tone with a ▲/▼ glyph and the signed text ("+2.8"). *Bad:* a red number with no sign, or brand colour on a figure. *Q:* the §13 checklist: "Does every colour, label and component earn its place?"

**AX-3. Everything works from the keyboard, with visible focus, and pointer targets are at least 24×24 px.** *Why:* SC 2.1.1, 2.4.11 and 2.5.8 (the last two new in 2.2). *Good:* `components/ui/Button`. *Bad:* a clickable `<div>` icon. *Q:* "Can you reach and use the new control with Tab and Enter?"

## 9. Dependencies

**DP-1. npm only; the lockfile is committed; CI installs with `npm ci`.** *Why:* a second lockfile broke production deploys once (`CLAUDE.md`), and a frozen install is the only reproducible one (L1). *Bad:* committing `pnpm-lock.yaml`, or `npm install` in CI. *Enforced by:* `npm ci` in `ci.yml` fails when `package.json` and the lockfile disagree.

**DP-2. A new dependency is justified in the PR and pinned; tool versions are at least two weeks old.** *Why:* supply-chain attacks (OWASP A03, the 2025 npm worm) and hallucinated package names (AI1, L5). *Good:* this PR's tools are pinned exactly (`knip 6.41.0`, `jscpd 5.4.1`, `dependency-cruiser 17.4.3`, `prettier 3.9.10`) with their release dates in `docs/CI_PLAN-2026-10-27.md`. *Bad:* `npm i some-helper` for a one-liner. *Enforced by:* knip reports unused and unlisted dependencies (CI report); *Q:* "Does the new package exist, is it maintained, and is it needed?"

**DP-3. High and critical advisories are tracked and fixed in their own upgrade PR.** *Why:* L3; fixes such as a Next.js minor are behaviour changes and need their own test run. *Enforced by:* `npm audit`, CI report (7 critical, 14 high today, including `next`, `next-auth` and `@sentry/nextjs`).

**DP-4. Workflows pin actions to a commit SHA and set least-privilege `permissions`.** *Why:* a moved tag can change what runs with the repository token (L6). *Good:* `ci.yml`: `actions/checkout@3d3c42e…  # v7.0.1`, `permissions: contents: read`. *Bad:* `uses: actions/checkout@v4` with default permissions (`prisma-resolve.yml` today). *Enforced by:* actionlint (run locally); *Q:* "Is every new `uses:` a SHA, and is `permissions` set?"

## 10. Git and PR conventions

**GP-1. Small PRs with one concern; refactors separate from behaviour changes.** *Why:* about 100 changed lines is reasonable and 1,000 too large (H1); mixing a refactor with a fix hides the fix (H2). Lockfiles and fixtures do not count. *Q (template):* "Is this one concern? Under ~400 changed lines?"

**GP-2. Commits and PR bodies carry the attribution lines the session gives.** *Why:* the history should show which changes an AI agent wrote. *Good:* commits end with the `Co-Authored-By: Claude … <noreply@anthropic.com>` line from the session's instructions; PR bodies end with the `Generated with Claude Code` line. *Q (template):* "Attribution lines present?"

## 11. How AI agents must work here

**AI-1. Search for an existing helper before adding one.** *Why:* duplication is the measured failure of AI-written code (AI2). `CODE_METRICS-2026-10-26.md` §9 already lists `signed` defined 6 times, `pct` 6, `mean` 5, `plural` 4, `cleanText` and `cellText` 4. *Good:* `rg "function pct|const pct"` before writing one, and reuse `lib/utils/cn.ts`, `lib/admin.ts#requireAdmin`, `lib/rateLimit.ts#enforceRateLimit`. *Enforced by:* jscpd (CI report, 2.74% duplicated lines today); *Q:* "Did you search for an existing helper?"

**AI-2. Never bump `PARSER_VERSION` casually.** *Why:* it invalidates every cached parse for every user and forces a full re-scrape. *Good:* `lib/calicotab/version.ts` records each bump with a dated comment listing what cached parses got wrong. *Bad:* bumping it for a refactor that changes no parsed output. *Q:* "Does this change parsed output? If not, why is the version bumped?"

**AI-3. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run ratchet` and `npx next build` before opening a PR, and say in the PR which you could not run.** *Why:* CI runs the same five; a red PR wastes the owner's review. *Enforced by:* the `verify` job (blocking).

**AI-4. No merge without the owner's say and a green `verify`.** *Why:* the app has real users and deploys from `main`. Agents also leave alone files that another open PR is changing. *Enforced by:* branch protection on `main` (owner setting, see the CI plan); *Q:* "Has the owner approved the merge?"

**AI-5. Check versions and APIs against the current docs for the pinned version, and cite them.** *Why:* Next 15 and 16, Zod 3 and 4, Prisma 6 and 7 differ; an API remembered from another version compiles badly or not at all (AI1). *Good:* this file's sources list. *Q:* "Which doc page, for which version, did you check?"

## Considered and dropped (no mechanism or reviewer question yet)

From the checklist, these have no check wired here and were left out rather than written as wishes. Each can come back when its mechanism lands.

- Naming conventions (R2): no `@typescript-eslint/naming-convention` config. Phase 3 type-aware linting could add it.
- Type-aware strict linting (T2, T4, T5): `typescript-eslint` `strictTypeChecked` is planned for Q1 phase 3 in warning mode; its docs say the strict configs are not covered by semver, so it must be pinned exactly.
- `noUncheckedIndexedAccess` (T1): phase 3, last, highest churn.
- Branded ID types (T6), interface comments on every export (C2), ADRs (C5): no check exists.
- `import 'server-only'` on data modules (N2), explicit caching and `revalidate` (N3, P4): no check; worth a design note first.
- Mutation testing (Q5), coverage reporting (Q6): no tooling installed.
- Bundle size budget (P3), Core Web Vitals (P6), automated axe checks (W6): no tooling installed.
- Conventional Commits (H4): not the repo's convention and no commitlint.
- Release-age gate for installs (L2): npm 11.10's `min-release-age` is newer than the npm that CI's Node 20 ships; revisit with the Node upgrade.

## Sources (read 2026-10-27)

- typescript-eslint shared configs (`strictTypeChecked`, semver caveat): https://typescript-eslint.io/users/configs
- ESLint size rules: https://eslint.org/docs/latest/rules/max-lines (and `max-lines-per-function`, `complexity`, `max-params`, `max-depth`)
- Prettier options (defaults; `endOfLine: "auto"` keeps existing endings): https://prettier.io/docs/options
- OWASP ASVS 5.0.0 (30 May 2025): https://asvs.owasp.org/ ; OWASP Top 10 2025: https://owasp.org/Top10/2025/0x00_2025-Introduction/
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Google engineering practices (small CLs, tests with logic changes): https://google.github.io/eng-practices/review/developer/small-cls.html
- Tool docs for the checks themselves are cited in `docs/CI_PLAN-2026-10-27.md`.
