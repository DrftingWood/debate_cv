# Code standards review checklist: TS 5.7 / Next.js 15 / React 19 / Prisma 6

Researched 2026-10-26. Every criterion reads "a good codebase does X; check by Y". Sources carry their year or version. **[secondary]** means only blog or press coverage was found; **[repo choice]** means a recommendation with no external standard behind it.

## 0. Version currency (check before anything else)

Several of this stack's versions have been overtaken.
- **Next.js 15** was released on 21 Oct 2024 and is in Maintenance LTS. The policy says each major stays in Maintenance LTS "for two years following the initial release", so support ends around 21 Oct 2026. That date is inferred from the policy; the page does not print it. Next.js 16 (21 Oct 2025) is Active LTS. https://nextjs.org/support-policy (read 2026-10).
- **TypeScript**: 6.0 shipped on 23 Mar 2026 and makes `strict` the default. 7.0 is the native Go compiler, GA 8 Jul 2026. [secondary] https://visualstudiomagazine.com/articles/2026/03/23/typescript-6-0-ships-as-final-javascript-based-release-clears-path-for-go-native-7-0.aspx ; https://visualstudiomagazine.com/articles/2026/07/08/typescript-7-arrives-to-rock-vs-code-with-go-powered-speed.aspx
- **Prisma 7** is out (Rust-free `prisma-client`, `output` is required, env vars are no longer auto-loaded). The docs banner calls Prisma 8 a release candidate. https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7 (2026)
- **Zod 4** is stable. https://zod.dev/v4 (2025)
- **Security floors**: CVE-2025-29927 (middleware auth bypass) is fixed in Next 15.2.3. https://nvd.nist.gov/vuln/detail/cve-2025-29927 (2025). CVE-2025-55182 (RSC "Flight" RCE, exploited in the wild from Dec 2025) is fixed in Next 15.0.5/15.1.9/15.2.6/15.3.6/15.4.8/15.5.7 and in React 19.0.1/19.1.2/19.2.1. [secondary, confirm against the official advisories] https://kudelskisecurity.com/research/update-critical-security-vulnerability-in-react-server-components-cve-2025-55182 ; https://www.microsoft.com/en-us/security/blog/?p=144502

- [ ] **V1** A good codebase runs a framework major that is still supported and is at or above every known CVE fix line. Check by comparing `next` and `react` in the lockfile with the floors above, and by planning the Next 16 migration now.
- [ ] **V2** A good codebase pins its toolchain versions on purpose. Check by confirming that `typescript`, `prisma` and `zod` versions are deliberate, with upgrade notes in an ADR.

---

## 1. Readability and naming

- [ ] **R1** Names fully say what a thing is or does without being unreadably long. Check in review: Google asks whether each name "fully communicates" its purpose. https://google.github.io/eng-practices/review/reviewer/looking-for.html (2019–2025, repo archived Nov 2025, site still live)
- [ ] **R2** Casing follows one convention: UpperCamelCase for types and components, lowerCamelCase for values, CONSTANT_CASE for module constants, and acronyms written as words (`loadHttpUrl`). Check with `@typescript-eslint/naming-convention`. Google TS Style Guide https://google.github.io/styleguide/tsguide.html (wording seen only via mirrors [secondary])
- [ ] **R3** There are no ambiguous abbreviations. One-letter names appear only in scopes of 10 lines or fewer. Check by grepping for 1–2 letter identifiers outside lambdas. (Google TS style guide, as above)
- [ ] **R4** Code a reader cannot understand quickly gets simplified, not explained away. Check by asking the reviewer whether they understood every line, and asking for a clarification or a rewrite if not. https://google.github.io/eng-practices/review/reviewer/looking-for.html
- [ ] **R5** Formatting is automated and never argued about in review. Check that Prettier (or Biome) runs in CI with `--check`. [repo choice]

## 2. Function and module size, cohesion, coupling

**The debate.** Martin (Clean Code) and Ousterhout (A Philosophy of Software Design) held a written debate from Sept 2024 to Feb 2025. https://github.com/johnousterhout/aposd-vs-clean-code
- Martin "strongly recommend[s] very short functions" and would "rather err on the side of decomposition". His test: extract when the piece can take a meaningful name, and inline it again if that proves too granular.
- Ousterhout prefers *deep* modules, where a simple interface hides a lot of implementation. He warns that over-decomposition yields shallow, "entangled" methods: if a reader has to flip between methods to understand one of them, combine them.
- Both agree that over-decomposition is possible and that the first edition of Clean Code gave too little guidance on it.
- **Recommendation for this repo:** use Ousterhout's test as the main criterion and line counts only as smoke alarms. The live risk here is a 2,000-line orchestrator, which fails *both* camps' tests. Split it by seams that give deep interfaces (fetch → parse → normalise → persist → enqueue), not into dozens of 5-line helpers.

**Cognitive complexity.** SonarSource's metric (white paper v1.7, 29 Aug 2023) adds one point for each break in linear flow and more for nesting. It ignores readable shorthand such as `?.` and `??`, and it does not penalise extracting a method. https://www.sonarsource.com/docs/CognitiveComplexity.pdf
- The rule S3776 defaults to 15. SonarSource staff say 10 was "noisy", and that the number is empirical tuning, "not a scientific formula". https://community.sonarsource.com/t/s3776-reason-for-the-current-default-value-of-15/127103 (2024)
- Evidence: a meta-analysis of about 24k evaluations found the metric correlates with comprehension time and with subjective understandability. Results for correctness were mixed, and the right threshold "remains open". Muñoz Barón, Wyrich & Wagner, ESEM 2020: https://arxiv.org/abs/2007.12520

Criteria:
- [ ] **S1** Each module has a narrow, well-named interface hiding substantial logic (it is "deep"). Check that its exported surface is clearly smaller than its implementation, and that a caller can use it without reading its body.
- [ ] **S2** No function has cognitive complexity above 15. Check with SonarQube or SonarLint (S3776), or an equivalent lint rule. Treat it as a warning to review, not an automatic block.
- [ ] **S3** No function has cyclomatic complexity above 20. Check with the ESLint `complexity` rule, whose default is 20. https://eslint.org/docs/latest/rules/complexity (ESLint 10.x docs, 2026)
- [ ] **S4** Nesting is at most 4 levels and there are at most 3 positional parameters (use an options object beyond that). Check with `max-depth` (default 4) and `max-params` (default 3). https://eslint.org/docs/latest/rules/max-depth ; https://eslint.org/docs/latest/rules/max-params
- [ ] **S5** No file runs into the thousands of lines. Check with `max-lines`: the default is 300, and ESLint notes that recommendations "usually range from 100 to 500" and files "should not be in the thousands". https://eslint.org/docs/latest/rules/max-lines
- [ ] **S6** A change to one feature touches few unrelated modules (low coupling). Check by mining git co-change, for example "files changed together in >50% of commits" [repo choice], and by looking for import cycles with `madge --circular` or `eslint-plugin-import/no-cycle`.
- [ ] **S7** There is no speculative generality. Check by asking whether the code solves "the problem they know needs to be solved now". https://google.github.io/eng-practices/review/reviewer/looking-for.html

## 3. Comments and documentation

- [ ] **C1** Comments explain *why* (intent, constraints, non-obvious choices), not *what*. Check by asking of each comment whether it would survive a rename or refactor. If code needs a comment to say what it does, simplify the code; regexes and complex algorithms are the exception. https://google.github.io/eng-practices/review/reviewer/looking-for.html
- [ ] **C2** Every exported function or module has an interface comment covering its contract: preconditions, side effects, errors thrown or returned, and units. Check that each `export` in `lib/` has TSDoc. This follows Ousterhout's position. https://github.com/johnousterhout/aposd-vs-clean-code
- [ ] **C3** No comment contradicts the code, and stale comments are deleted. Check by reviewing comments in every diff. Martin treats every comment as "potential misinformation". (same source)
- [ ] **C4** Long narrative comments, such as the history of a bug or the reasoning behind a design, are moved out of the code into ADRs or commit messages, leaving a one-line pointer. Check for any comment block longer than about 15 lines [repo choice].
- [ ] **C5** Significant decisions are recorded as ADRs (Title, Status, Context, Decision, Consequences, including negative consequences). Check that `docs/adr/NNNN-*.md` exists and covers the queue design, the scraping strategy and the caching model. Nygard 2011: https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions ; status values: https://faq.arc42.org/questions/C-9-3/
- [ ] **C6** Scraper parsers document which page variant or date each selector targets. Check that each cheerio parser names its fixture file in a comment. [repo choice]

## 4. TypeScript specifics

`strict` covers `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `strictBuiltinIteratorReturn`, `noImplicitThis`, `useUnknownInCatchVariables` and `alwaysStrict`. It does **not** include `noUncheckedIndexedAccess` or `exactOptionalPropertyTypes`. https://www.typescriptlang.org/tsconfig (read 2026-10)

- [ ] **T1** tsconfig adds `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch` and `noPropertyAccessFromIndexSignature`. Check `tsconfig.json`. These are high value for scraping code, where `rows[i]` and `$('td')[3]` really can be undefined. https://www.typescriptlang.org/tsconfig#noUncheckedIndexedAccess
- [ ] **T2** Lint uses typescript-eslint `strictTypeChecked` plus `stylisticTypeChecked` with `parserOptions.projectService: true`. Check `eslint.config.mjs`. The docs say to start from `recommended-type-checked` and move to `strict-type-checked` when comfortable. They also say `strict` configs are *not* covered by semver stability, so pin the version. https://typescript-eslint.io/users/configs ; https://typescript-eslint.io/getting-started/typed-linting (2026)
- [ ] **T3** There is no `any`, no `as` assertion on external data, and no non-null `!`. Check by counting `any`, ` as ` and `!.` in the code (`rg`), and by turning on `no-explicit-any`, `no-unsafe-*` and `no-non-null-assertion`, which are part of strict-type-checked. Data from outside enters only through zod `parse`, never `as T`.
- [ ] **T4** Every promise is awaited or explicitly voided. Check with `@typescript-eslint/no-floating-promises`, which matters most in the ingest queue. https://typescript-eslint.io/rules/no-floating-promises
- [ ] **T5** State and result variants are discriminated unions (`{ status: 'ok', data } | { status: 'error', error }`), not bags of optional fields. Switches over them are exhaustive. Check with `@typescript-eslint/switch-exhaustiveness-check` https://typescript-eslint.io/rules/switch-exhaustiveness-check plus an `assertNever(x: never)` default.
- [ ] **T6** IDs that must not be mixed up (tournamentId, playerId, roundId) use branded types. Check that the zod schemas use `.brand<'TournamentId'>()` (https://zod.dev/api, Zod 4) and that functions take the branded type.
- [ ] **T7** Config objects and lookup tables use `satisfies`, keeping both literal types and validation. Check that `const x: Record<...> = {...}` is not used where it would widen the types. (TS 4.9+ feature; https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html)
- [ ] **T8** Every `// @ts-expect-error` or `eslint-disable` carries a reason, and `@ts-ignore` is never used. Check with `@typescript-eslint/ban-ts-comment` (in recommended) and `eslint-comments/require-description`.

## 5. React 19 and Next.js 15 conventions

- [ ] **N1** Server Components are the default and `'use client'` sits on small interactive leaves. Check by listing `'use client'` files: a directive marks "the module and its transitive dependencies as client code", so a layout or page-level directive is a red flag. https://react.dev/reference/rsc/use-client (React 19 docs, 2026)
- [ ] **N2** Props crossing into client components are serializable and minimal: DTOs, not Prisma rows. Check client component prop types, then confirm data-access modules `import 'server-only'` so a client import fails the build. https://nextjs.org/docs/15/app/guides/data-security
- [ ] **N3** Caching is explicit. In Next 15, `fetch`, `GET` route handlers and the client router cache are **uncached by default**. Check that statistics pages declare `revalidate`, use `unstable_cache`/`'use cache'` with tags, and call `revalidateTag` after ingest. https://nextjs.org/blog/next-15 (Oct 2024) ; https://nextjs.org/docs/app/guides/caching-without-cache-components (2026-08)
- [ ] **N4** Prisma reads used several times in one render are deduplicated with React `cache()`. Check data-access helpers. (same caching doc)
- [ ] **N5** Each route segment with data has `loading.tsx` or a `<Suspense>` boundary and an `error.tsx` (a Client Component), and there is a `global-error.tsx` with its own `<html>`/`<body>`. Check the `app/` tree. https://nextjs.org/docs/15/app/getting-started/error-handling
- [ ] **N6** Route handlers are thin: parse the input with zod, call a service, map the result to an HTTP status. Check that no `route.ts` holds business logic or more than about 40 lines [repo choice].
- [ ] **N7** Middleware is never the only authorisation layer; authorisation is repeated in the data-access layer. Check every admin route and server action. (CVE-2025-29927 showed middleware can be bypassed.) https://cheatsheetseries.owasp.org/cheatsheets/Nextjs_Security_Cheat_Sheet.html
- [ ] **N8** There are no `useEffect` fetches for data a Server Component could load. Check client components for `useEffect` combined with `fetch`. https://react.dev/learn/you-might-not-need-an-effect

## 6. Error handling

Next.js docs (v15): model *expected* errors as return values (for example with `useActionState`) and let *unexpected* errors reach error boundaries. https://nextjs.org/docs/15/app/getting-started/error-handling. OWASP Top 10 2025 has a new category, **A10 Mishandling of Exceptional Conditions**. https://owasp.org/Top10/2025/0x00_2025-Introduction/

- [ ] **E1** Expected failures return typed results; exceptions are reserved for bugs and infrastructure faults. Expected failures here include a 404 tournament page, a changed page layout, or a validation failure. Check that parsers return `Result`/discriminated unions and that `throw` in the domain code is rare.
- [ ] **E2** No error is swallowed. Check by grepping for `catch {` and `catch (e) {}`, `.catch(() => {})` and `catch` blocks that only `console.log`: each one must rethrow, return an error value, or log with context *and* count a metric.
- [ ] **E3** Errors keep their cause. Check that rethrows use `new Error(msg, { cause })` and that `catch (e: unknown)` narrows before use (`useUnknownInCatchVariables`, part of strict).
- [ ] **E4** The ingest queue has explicit retry, backoff and dead-letter rules, and a job that fails part-way leaves no half-written data. Check that multi-row writes run in `prisma.$transaction` and that failed jobs are visible. [repo choice, consistent with OWASP A10]
- [ ] **E5** Logs are structured (JSON with job id, URL, tournament id) and contain no secrets or PII. Check the logger calls and `instrumentation.ts` (`onRequestError`). https://nextjs.org/docs/app/guides/instrumentation ; OWASP A09 Logging & Alerting Failures (2025)
- [ ] **E6** Users never see stack traces. Check that error responses from route handlers are generic and that details go to logs only.

## 7. Boundaries and architecture

- [ ] **A1** The core is pure and IO sits in a shell: parsers (HTML string → typed data) and statistics (data → numbers) import neither Prisma nor `fetch`. Check with an ESLint `no-restricted-imports` zone, or dependency-cruiser rules, that forbid `@prisma/client` and `next/*` inside `lib/parse/**` and `lib/stats/**`. [repo choice; follows Ousterhout's information hiding]
- [ ] **A2** Dependencies point inward: `app/` → services → domain, never the reverse. Check with dependency-cruiser and fail CI on violations.
- [ ] **A3** All database access goes through one data-access layer that also enforces authorisation and returns DTOs. Check that only `lib/data/**` imports `prisma`. The Next.js guide recommends a DAL for new projects and says not to mix approaches. https://nextjs.org/docs/15/app/guides/data-security
- [ ] **A4** There are no god modules: no file is both orchestration and implementation. Check the ~2,000-line orchestrator: it should *call* stage modules with deep interfaces, and the plan to split it should be recorded in an ADR.
- [ ] **A5** Feature code is co-located: feature folders such as `features/ingest`, `features/stats` and `features/tournaments`, with a small shared kernel, rather than repo-wide `utils/` dumping grounds. Check that `utils/` or `helpers/` has fewer than about 10 files [repo choice].

## 8. Testing

**Pyramid or trophy.** Kent C. Dodds' "Testing Trophy" weights static analysis plus *integration* tests most heavily for JS apps ("Write tests. Not too many. Mostly integration."). https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications. The classic pyramid weights unit tests most. https://martinfowler.com/articles/practical-test-pyramid.html (2018). **For this repo:** pure parse and statistics modules suit dense unit tests (pyramid-like), while API routes and the ingest pipeline get integration tests against a real Postgres (trophy-like).

- [ ] **Q1** Tests check behaviour, not implementation: one test per behaviour, not one per method, and no mocking of the module under test. Check that tests survive an internal refactor. Google TotT "Test Behaviors, Not Methods" (2014): https://testing.googleblog.com/2015/02/the-first-annual-testing-on-toilet.html
- [ ] **Q2** Every parser has saved real HTML fixtures, including old layouts and broken pages, plus a snapshot or explicit expected output. Check that `__fixtures__/*.html` exist with the date captured, and that no test hits the network.
- [ ] **Q3** Tests are deterministic: no wall clock, randomness or network. Check for `vi.useFakeTimers()`, seeded data, and run the suite with `--sequence.shuffle` twice in CI.
- [ ] **Q4** Every PR that changes logic includes new or updated tests. Check the diff. "A CL that adds or changes logic should be accompanied by new or updated tests." https://google.github.io/eng-practices/review/developer/small-cls.html
- [ ] **Q5** Tests fail when the code is broken. Check by mutation testing the pure modules with StrykerJS (`@stryker-mutator/vitest-runner`, `incremental: true` in CI). https://stryker-mutator.io/docs/stryker-js/incremental/ ; Google: verify tests "actually fail when the code is broken". https://google.github.io/eng-practices/review/reviewer/looking-for.html
- [ ] **Q6** Coverage is a signal, not a target. Check uncovered lines in changed files; do not require 100%. Fowler (2012): coverage is "useful for finding untested parts" but "of little use as a numeric statement"; thoughtful testing tends to land in the upper 80s or 90s. https://martinfowler.com/bliki/TestCoverage.html
- [ ] **Q7** Test code meets the same readability bar: no logic or loops in assertions. Check in review. https://google.github.io/eng-practices/review/reviewer/looking-for.html

## 9. Security coding

Standards in force: **OWASP Top 10 2025** (A01 Broken Access Control, which now absorbs SSRF; A02 Misconfiguration; A03 Software Supply Chain Failures; A05 Injection; A10 Exceptional Conditions) https://owasp.org/Top10/2025/0x00_2025-Introduction/ and **OWASP ASVS 5.0.0** (May 2025, 17 chapters) https://owasp.org/www-project-application-security-verification-standard/

- [ ] **X1** All raw SQL uses tagged-template `$queryRaw`/`$executeRaw` or `Prisma.sql`. `$queryRawUnsafe` appears only with allow-listed identifiers. Check with `rg 'Unsafe\('` and confirm no string concatenation into raw queries. https://www.prisma.io/docs/orm/v6/prisma-client/using-raw-sql/raw-queries
- [ ] **X2** The scraper can fetch only intended hosts. Check that user-supplied tournament URLs pass a host allowlist, have redirects disabled or re-validated on every hop, have their resolved IPs checked against private, loopback, link-local and metadata ranges at connect time (DNS rebinding), and that egress is restricted. https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html (2026)
- [ ] **X3** Every route handler and server action validates input with zod and checks authorisation itself. Check each `route.ts` and `'use server'` file; server actions are public endpoints. https://nextjs.org/docs/15/app/guides/data-security
- [ ] **X4** No secret is in the repo or the client bundle. Check that only `NEXT_PUBLIC_*` values are non-secret, run gitleaks or GitHub secret scanning, and validate env at startup with a zod schema. (Next.js data-security guide, as above)
- [ ] **X5** Scraped HTML is never rendered raw. Check for `dangerouslySetInnerHTML`; if present, it must go through a sanitiser. Veracode (2025) found LLM code failed XSS defences in 86% of relevant cases. https://www.veracode.com/press-release/ai-generated-code-poses-major-security-risks-in-nearly-half-of-all-development-tasks-veracode-research-reveals/
- [ ] **X6** Admin and ingest endpoints are rate-limited and authenticated. Check middleware, the DAL and the hosting firewall config. (ASVS 5.0, as above)

## 10. API and data validation

- [ ] **D1** zod parses every boundary: request body, query and params, scraped output, env, queue payloads and third-party JSON. Check that no `JSON.parse(...) as T` remains (`rg 'as [A-Z]'` near parse calls).
- [ ] **D2** Each shape has a single source of truth: types derive from schemas (`z.infer<typeof Schema>`) or from Prisma's generated types, and are never hand-duplicated. Check for interfaces that mirror a zod schema or Prisma model field for field. https://zod.dev (Zod 4, 2025)
- [ ] **D3** API responses go through output DTO schemas, not raw Prisma objects. Check that route handlers `return Response.json(ResponseSchema.parse(dto))` or use typed mappers. (Next.js data security, DTO guidance)
- [ ] **D4** Validation errors return 400/422 with a stable error shape; any other error returns 500 with a generic body. Check for one shared `toHttpError` helper.
- [ ] **D5** Schema evolution is safe: Prisma migrations are committed, reviewed and expand-then-contract for live data. Check that `prisma/migrations` and the migration PRs are separate from feature PRs. [repo choice]

## 11. Accessibility (WCAG 2.2, W3C Recommendation 5 Oct 2023)

https://www.w3.org/TR/WCAG22/ ; what is new: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/

- [ ] **W1** Statistics tables are real `<table>` elements with `<th scope>` and `<caption>`, not div grids. Check the table components (SC 1.3.1).
- [ ] **W2** Charts have text alternatives or an adjacent data table, and colour is never the only cue. Check chart components (SC 1.1.1, 1.4.1).
- [ ] **W3** Text contrast is at least 4.5:1 and UI component contrast at least 3:1. Check the Tailwind palette with axe or Lighthouse in CI (SC 1.4.3, 1.4.11).
- [ ] **W4** Everything is keyboard operable, and focus is visible and not hidden behind sticky headers. Check by tabbing through key pages (SC 2.1.1, **2.4.11 Focus Not Obscured (Minimum)**, new in 2.2).
- [ ] **W5** Pointer targets are at least 24×24 CSS px or adequately spaced. Check pagination, filter chips and icon buttons (**SC 2.5.8 Target Size (Minimum)**, new in 2.2).
- [ ] **W6** Automated a11y checks run in CI (axe through Playwright or `vitest-axe`) and fail on serious or critical issues. [repo choice; automation finds only a subset of WCAG failures]

## 12. Performance basics

- [ ] **P1** No N+1 queries: no Prisma call inside a loop over Prisma results. Check by grepping for `await prisma` inside `for`/`map`. Use `include`/`select`, `findMany({ where: { id: { in } } })`, or `relationLoadStrategy: 'join'`. https://www.prisma.io/docs/orm/prisma-client/queries/advanced/query-optimization-performance
- [ ] **P2** Queries `select` only the columns they need and use indexes for every filter on statistics pages. Check `EXPLAIN` output for the slowest queries and `@@index` entries in the schema.
- [ ] **P3** Bundle size is measured on each release. Check the bundle analyzer output: heavy libraries (charting, date handling) are client-only where needed and lazy-loaded with `next/dynamic`. https://nextjs.org/docs/15/app/guides/package-bundling
- [ ] **P4** Statistics pages are cached and revalidated, not recomputed on every request. Check the route segment config or the `unstable_cache` tags (see N3).
- [ ] **P5** Ingest work is bounded: concurrency limits and politeness delays for scraping, batched writes (`createMany`). Check the queue config. [repo choice]
- [ ] **P6** Core Web Vitals on key pages are monitored. Check Vercel Speed Insights or a Lighthouse CI budget. [repo choice]

## 13. Dependency and supply-chain hygiene

The context: OWASP 2025 places A03 Software Supply Chain Failures third. The Shai-Hulud npm worm compromised 500+ packages in Sept 2025, and CISA advised reviewing lockfiles, pinning to known-good versions and rotating credentials. https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem

- [ ] **L1** The lockfile is committed and CI uses a frozen install (`npm ci`, or `pnpm install --frozen-lockfile`). Check the CI script.
- [ ] **L2** New versions wait before install. Check for a release-age gate: pnpm `minimumReleaseAge` (10.16+, defaults to 1 day in pnpm 11) or npm `min-release-age` (11.10+). https://pnpm.io/10.x/settings ; [secondary for the npm setting] https://jfrog.com/help/r/artifactory-recently-published-npm-packages-may-be-blocked-for-24-hours-new-client-enforcements
- [ ] **L3** Updates are automated and reviewed: Dependabot or Renovate is enabled and `npm audit --audit-level=high` (or OSV-Scanner) runs in CI. Check the repo settings and workflow.
- [ ] **L4** Install scripts are not run by default for new dependencies. Check that pnpm `onlyBuiltDependencies` (or an equivalent allowlist) is configured. [repo choice]
- [ ] **L5** Every new dependency is justified: it exists, is maintained, and is the real package name (see AI1). Check the PR description for any added dependency.
- [ ] **L6** GitHub Actions are pinned to commit SHAs with least-privilege `permissions:`. Check `.github/workflows`. [repo choice; OpenSSF Scorecard checks this, https://scorecard.dev]

## 14. Code review and change hygiene

- [ ] **H1** PRs are small: about 100 changed lines is "usually reasonable" and 1,000 is "usually too large". Spread across many files counts against a change. Check the PR diff stats. https://google.github.io/eng-practices/review/developer/small-cls.html
- [ ] **H2** Refactors land in separate PRs from behaviour changes. Check that a PR titled `refactor:` changes no tests' expected values. (same source)
- [ ] **H3** Approval means the change "definitely improves the overall code health… even if [it] isn't perfect", and nits are labelled `Nit:`. Check review comments. https://google.github.io/eng-practices/review/reviewer/standard.html
- [ ] **H4** Commits follow Conventional Commits 1.0.0 (`feat:`→minor, `fix:`→patch, `!`/`BREAKING CHANGE:`→major). Check with commitlint in a hook or CI. https://www.conventionalcommits.org/en/v1.0.0/
- [ ] **H5** CI blocks merges on `tsc --noEmit`, `eslint` (typed), `vitest run`, `next build` and the audit. Check branch protection required checks. [repo choice]
- [ ] **H6** A solo developer still gets a second review: a self-review checklist plus an AI or bot reviewer, and the author reads the full diff before merging. Check for a PR template with checkboxes. [repo choice]

## 15. Working with AI-generated code

The evidence (2024–2026):
- GitClear 2025 (211M changed lines, 2020–24): duplicated 5+ line blocks rose about 8× in 2024, and moved or refactored lines fell from about 25% to under 10%. [secondary] https://devclass.com/2025/02/20/ai-is-eroding-code-quality-states-new-in-depth-report/
- CodeRabbit (Dec 2025, 470 PRs; vendor study): AI-co-authored PRs had about 1.7× more issues, 1.75× more logic errors and 1.57× more security findings, and readability problems increased more than 3×. https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report
- Veracode (Jul 2025, 100+ LLMs): about 45% of tasks produced OWASP-Top-10 flaws. (see X5)
- Package hallucination (USENIX Security 2025): at least 5.2% of packages from commercial models and 21.7% from open-source models were hallucinated, and the fake names repeat, which enables "slopsquatting". https://www.usenix.org/conference/usenixsecurity25/presentation/spracklen
- DORA 2025: AI adoption correlates with higher throughput *and* higher instability; "AI amplifies existing conditions". [secondary] https://www.infoq.com/news/2025/09/dora-state-of-ai-in-dev-2025
- METR RCT (2025, 16 experienced developers): AI use made tasks about 19% slower, while the developers believed it made them about 20% faster. Small sample, early-2025 tools. [secondary] https://www.theregister.com/2025/07/11/ai_code_tools_slow_down/
- OpenSSF guide to security-focused instructions for AI assistants (Aug 2025). https://best.openssf.org/Security-Focused-Guide-for-AI-Code-Assistant-Instructions

Criteria:
- [ ] **AI1** Every import or API the AI introduced exists at the installed version. Check that `tsc` passes, that new packages are confirmed on npm (age, downloads, repository), and that framework APIs match the docs *for the pinned version* (Next 15 vs 16 differ, for example `reset` vs `retry` in `error.tsx`).
- [ ] **AI2** AI changes do not duplicate existing helpers. Check by searching the codebase for an existing function before accepting a new one, and run jscpd or a duplication check in CI.
- [ ] **AI3** AI-written comments are not over-narrated: no comments restating the code, no "Step 1:/Now we…" commentary, no changelog-in-comments. Check every new comment against C1/C4.
- [ ] **AI4** AI output gets the same full review as human code, with *every line* understood by the merger. Check that the PR records which parts were generated. https://google.github.io/eng-practices/review/reviewer/looking-for.html
- [ ] **AI5** AI-written tests are checked for tautologies: asserting mocks, snapshotting whatever is output, deleting failing assertions. Check by running mutation testing (Q5) on AI-touched modules.
- [ ] **AI6** Repo instruction files (CLAUDE.md and similar) state the security rules (zod at boundaries, `$queryRaw` only, the SSRF policy) concisely. Check that the file exists and is short. (OpenSSF 2025, as above)
- [ ] **AI7** AI-assisted PRs stay small (H1) and are rebased on main. Check for large AI-generated diffs; split them before review.

---

## Where sources disagree

| Topic | Position A | Position B | Recommendation here |
|---|---|---|---|
| Function length | Martin: very short functions, err toward decomposition | Ousterhout: deep modules; merge entangled shallow methods | Ousterhout's interface test is primary; line limits are only warnings (§2). Both condemn a 2,000-line god module. |
| Comments | Martin: distrusts comments, prefers long names | Ousterhout: comments "crucially important", especially interface comments | Interface comments on exports plus why-comments inline; move narratives to ADRs (§3). |
| TDD | Martin: three laws of TDD | Ousterhout: pro unit tests, anti TDD | Not mandated. Require tests in the same PR (Google), test-first for parsers from fixtures. |
| Cognitive complexity | Muñoz Barón et al. 2020: validated for comprehension time and ratings | A 2023 study (Lavazza & Morasca, reported in search results, not read in full) finds it no better than older metrics; Sonar admits 15 is empirical | Use as a review prompt, not a hard gate. |
| Test shape | Pyramid (Fowler/Vocke 2018) | Trophy (Dodds) | Pyramid for pure modules, trophy for routes and pipeline (§8). |
| AI productivity | DORA 2025: throughput up | METR 2025: 19% slower; GitClear and CodeRabbit: quality down | Use AI, but put the gates on review, duplication and tests (§15). |
| PR size | Google: ~100 lines reasonable | Secondary blogs cite 200–400 | Use Google's primary figure; 400 is the hard ceiling. |

## Recommended thresholds for this repo

| Metric | Warn | Error / block | Source and rationale |
|---|---|---|---|
| File length (`max-lines`, skip blank lines and comments) | 400 | 800 for new files; the existing orchestrator gets a dated split ADR | ESLint default 300; "100–500 typical, not thousands" https://eslint.org/docs/latest/rules/max-lines. Raised slightly because deep modules are preferred (Ousterhout). |
| Function length (`max-lines-per-function`) | 60 | none (review) | ESLint default 50 https://eslint.org/docs/latest/rules/max-lines-per-function. Not a hard block, per the Martin/Ousterhout agreement that splitting can over-decompose. |
| Cyclomatic complexity (`complexity`) | 15 | 20 | ESLint default 20 https://eslint.org/docs/latest/rules/complexity. Sonar found 10 "noisy". |
| Cognitive complexity (S3776 or equivalent) | 15 | 25 [repo choice] | Sonar default 15 https://community.sonarsource.com/t/s3776-reason-for-the-current-default-value-of-15/127103 ; white paper v1.7 (2023) |
| Parameters (`max-params`) | 3 | 4 (use an options object beyond that) | ESLint default 3 https://eslint.org/docs/latest/rules/max-params |
| Nesting depth (`max-depth`) | 3 | 4 | ESLint default 4 https://eslint.org/docs/latest/rules/max-depth |
| PR size (changed lines, excluding fixtures and lockfile) | 200 | 400 (split) | Google: ~100 reasonable, 1,000 too large https://google.github.io/eng-practices/review/developer/small-cls.html |
| Tests per change | Every logic change has a test | Block on missing tests for `lib/parse`, `lib/stats`, `lib/ingest` | Google small-CLs page (above) |
| Line coverage | Report on changed files; expect the high 80s on pure modules | Never a hard global % gate | Fowler 2012 https://martinfowler.com/bliki/TestCoverage.html |
| Mutation score (pure modules) | Track the trend | Fail if it drops below the current baseline [repo choice] | StrykerJS https://stryker-mutator.io/docs/stryker-js/incremental/ (no external standard threshold found) |
| `any` / `as` / `!` / unexplained `eslint-disable` | 0 new | 0 new (ratchet existing ones down) | typescript-eslint strict-type-checked https://typescript-eslint.io/users/configs |
| Parser fixtures | ≥1 real HTML fixture per page variant | Block parser changes without one | [repo choice] |
