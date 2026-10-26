# Code standards baseline (2026-10-27)

Q1 phase 1 from `docs/OPUS_TASKS.md`. Sources: `docs/CODE_STANDARDS_REVIEW-2026-10-26.md`, the thresholds table in `docs/CODE_STANDARDS-CHECKLIST-2026-10-26.md`, and the counts in `docs/CODE_METRICS-2026-10-26.md`.

This records where the code stands so that later phases can show the numbers falling. Nothing here blocks a build.

## What changed

- `tsconfig.json`: `noFallthroughCasesInSwitch` and `noImplicitOverride` are on. One fix was needed: `override` on the `name` field of a test-only `Error` subclass in `tests/queueDrain.test.ts`. Runtime behaviour is unchanged. There were no switch fallthrough errors.
- `eslint.config.mjs`: five size and complexity rules, all set to `warn`. `npm run lint` still exits 0.
- `scripts/check-ratchet.mjs` (`npm run ratchet`): counts escape hatches and fails if a count goes above the numbers below. It is not part of `build`.

## Lint thresholds

These come from the "Warn" column of the checklist's thresholds table.

| Rule | Setting |
|---|---|
| `max-lines` | 400, skip blank lines and comments |
| `max-lines-per-function` | 60, skip blank lines and comments |
| `complexity` (cyclomatic) | 15 |
| `max-params` | 3 |
| `max-depth` | 3 |

The checklist's cognitive-complexity row (Sonar S3776) has no core ESLint rule, so it is not wired here.

## Warning baseline

Measured with `npx eslint .` on `origin/main` at `257d13d` plus this change. Totals cover every file ESLint lints, including `tests/` and `scripts/`.

| Rule | Warnings | Files | app | components | lib | scripts | tests |
|---|---:|---:|---:|---:|---:|---:|---:|
| `max-lines-per-function` | 177 | 127 | 38 | 36 | 26 | 2 | 75 |
| `complexity` | 71 | 46 | 18 | 5 | 37 | 6 | 5 |
| `max-depth` | 60 | 22 | 5 | 0 | 18 | 18 | 19 |
| `max-params` | 19 | 12 | 1 | 0 | 14 | 0 | 4 |
| `max-lines` | 18 | 18 | 3 | 3 | 6 | 3 | 3 |
| **Total (new rules)** | **345** | | | | | | |

There was also 1 warning before this change, `@typescript-eslint/no-unused-vars` in `scripts/test-scrape.mjs`. It is left alone.

The worst offenders, which Q1 phase 3 is about:

- `max-lines`: `lib/calicotab/ingest.ts` (1,565 counted lines), `lib/cv/buildCvData.ts` (913), `lib/cv/speakerStats.ts` (857), `lib/calicotab/parseTabs.ts` (820), `components/stats/StatsSections.tsx` (714).
- `max-lines-per-function`: `buildCvData` (760 lines), `CvVerifyPage` (472), `computeSpeakerStats` (395), `Dashboard` (363).
- `complexity`: `buildCvData` (179), `main` in `scripts/seed-from-corpus.mjs` (137), `fetchRestFromApi` in `lib/calicotab/tabbycatApiRounds.ts` (80), `computeSpeakerStats` (73), two functions in `ingest.ts` (45, 44).
- `max-params`: `writeIngestTransaction` and `writeJudgeParticipantRole` (5 each).
- `max-depth`: `lib/calicotab/parseTabs.ts:929` (5 deep). The 6-deep cases are in a live corpus test.

To re-measure, run `npx eslint . -f json -o lint.json` and count `messages[].ruleId`. These counts should only go down. Promote a rule to `error` once its count reaches zero, or near zero with an agreed exemption.

## The ratchet

The rule is that no PR adds a new:

1. `any`, written as `: any`, `as any`, `<any>`, `any[]` or as a generic argument;
2. `as unknown as` double cast;
3. postfix non-null assertion `!`;
4. `eslint-disable` comment without a reason. ESLint's own syntax gives the reason: `// eslint-disable-next-line rule -- why`.

If a new one is really needed, say why in the PR body and raise the baseline in the same PR. When a count falls, lower the baseline in the same PR, so the numbers only ever tighten.

### Counts at baseline

The script scans `app/`, `lib/`, `components/`, `middleware.ts` and `instrumentation.ts`. It skips tests and scripts, as the metrics doc did.

| Pattern | Count | Notes |
|---|---:|---|
| `any` | 0 | Matches the metrics doc |
| `as unknown as` | 7 | `ingest.ts` x3, `db.ts` x1, `lib/tags/classify*.ts` x3, matching the metrics doc |
| non-null `!` | 75 | Higher than the metrics doc's "~35" because this pattern also catches `x!}` (JSX) and `x!,` (arguments). Spot-checked: the hits are real assertions. Spread across `lib/cv/speakerStats.ts`, `parseNav.ts`, `judgingLens.ts`, `crossTabs.ts`, `app/u/[slug]/page.tsx` and others |
| unexplained `eslint-disable` | 4 | `app/u/[slug]/page.tsx`, `components/OnboardingFlow.tsx` x2, `components/UserMenu.tsx` |

`npm run ratchet -- --verbose` lists every hit by file and line.

The scan works on text, not types. It strips comments and one-line string literals first, so English prose such as "any row" does not count. It is deterministic, which means any rise comes from new code. It does not replace the type-aware `strict-type-checked` set, which arrives in phase 3.

## Report-only baseline (Q1 phase 1b)

Measured 2026-10-27 on `origin/main` at `c3da602` (after #167 to #174 merged) plus the phase 1b PR, with the pinned tool versions in `docs/CI_PLAN-2026-10-27.md`. These checks run in the `report (non-blocking)` job of `.github/workflows/ci.yml` and never fail a build. The job summary prints the same table, so a PR that raises a number shows it. How each one graduates to blocking is in the CI plan.

| Check | Count | Notes |
|---|---:|---|
| knip: unused files | 0 | after adding `scripts/*.mjs` and the Sentry configs as entries |
| knip: unused exports | 31 | in 21 files; e.g. `CardHeader`, `CardFooter`, `CardTitle`, `CardDescription` in `components/ui/Card.tsx`, `consumeRateLimit` in `lib/rateLimit.ts` |
| knip: unused exported types | 45 | in 14 files, mostly result types in `lib/cv/speakerStats.ts` and `lib/cv/judgingLens.ts` that are exported but used only in their own file |
| knip: unused dependencies (prod + dev) | 0 | |
| knip: unlisted dependencies | 1 | `scripts/find-identity-affected-tournaments.mjs` imports `vite`, which is only installed as a dependency of Vitest |
| jscpd: duplicated lines | 1,132 of 41,496 (2.73%) | 96 clones of 5+ lines and 50+ tokens in `app/`, `lib/`, `components/`, `scripts/`; tests excluded |
| dependency-cruiser: `no-circular` | 5 | 2 value cycles, both through `lib/db.ts → lib/queueDrain.ts → lib/queue.ts`; 3 contain one type-only edge (`cheerioToVue`/`parseTabs`, `breakMargin`/`buildCvData`, `teamPlacement`/`buildCvData`) |
| dependency-cruiser: `no-prisma-outside-lib` | 6 | all value imports of enums (`IngestJobStatus`, `Prisma`) in `app/api/**/route.ts`; type-only imports are not counted |
| dependency-cruiser: `lib-not-to-app-or-components` | 0 | |
| Prettier: files that differ | 294 | of about 413 in scope; the repo was not reformatted |
| npm audit (dev included): critical / high / moderate / low | 7 / 14 / 23 / 1 | identical on `main`'s lockfile, so the new devDependencies add none. The critical ones include `next`, `next-auth` / `@auth/core`, `@sentry/nextjs` and `vitest`; they need an upgrade PR of their own |
| gitleaks: findings in history | 0 | 3 reviewed false positives (doc prose) are listed in `.gitleaksignore` |

### Changes to the blocking checks in phase 1b

- `tsconfig.json`: `noUnusedLocals` and `noUnusedParameters` are on. They produced **0** errors when enabled, so no code changed.
- `eslint.config.mjs`: `no-restricted-syntax` as an **error** against `new PrismaClient(...)` outside `lib/db.ts` and `scripts/` (0 hits).
- The ratchet's `nonNull` baseline moved from 75 to **76**. `main` was already at 76 before this PR: #167 removed two `!` from `lib/cv/buildCvData.ts` and #168 added three in `lib/identity/affectedTournaments.ts`, both landing before CI ran the ratchet. Raised so `verify` is green on `main`; those three are the first to remove.
- Lint warnings are now **360** (186 `max-lines-per-function`, 72 `complexity`, 60 `max-depth`, 21 `max-lines`, 20 `max-params`, 1 `no-unused-vars`), up from 346 at phase 1. The rise came with the code merged in #167 to #174; this PR adds no warnings.
