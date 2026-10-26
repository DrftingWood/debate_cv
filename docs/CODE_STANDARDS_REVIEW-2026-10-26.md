# Code standards review (2026-10-26)

Scope: how the repository compares with current clean-code and code-writing practice for its stack (TypeScript 5.9, Next.js 15.5, React 19.2, Prisma 6.19). The owner asked for the research now and the repository revisit soon.

Supporting files in this folder:
- `CODE_STANDARDS-CHECKLIST-2026-10-26.md`: 96 cited criteria in 15 areas, with a table of recommended thresholds.
- `CODE_METRICS-2026-10-26.md`: counted facts about the repository (sizes, flags, casts, tests).

## What was and was not verified

- The checklist and the metrics were each produced by an agent; neither ran the build or touched a database. Function lengths in the metrics are approximate; everything else is counted.
- **Checked by hand:** our installed versions (`next` 15.5.15, `react` 19.2.5, `typescript` 5.9.3, `@prisma/client` 6.19.3, `zod` 3.25.76) and the two security floors below.
- **Not verified, treat as leads:** the end-of-support date for Next.js 15 (inferred from the two-year policy, not printed on the page); that TypeScript 6 and 7 have shipped (press coverage only); and several statistics on AI-generated code (secondary sources, marked in the checklist).
- Some thresholds are the research's own choice and are tagged `[repo choice]` in the checklist. They are starting points, not standards.

## Version currency

| Item | Ours | Position |
| --- | --- | --- |
| CVE-2025-29927 (Next.js middleware bypass) | Next 15.5.15 | Fixed from 15.2.3. Covered. |
| CVE-2025-55182 (React Server Components remote code execution, CVSS 10) | React 19.2.5, Next 15.5.15 | Fixed in React 19.0.1 / 19.1.2 / 19.2.1 and Next 15.5.7 on our branch (React advisory, 3 Dec 2025). Covered. |
| Next.js 15 support | 15.5 | In maintenance LTS and, by the published two-year rule, ending about 21 Oct 2026. Plan the move to Next 16. Date is inferred. |
| TypeScript | 5.9.3 | Behind (6.x and 7.x reported). Not urgent. |
| Prisma | 6.19.3 | Prisma 7 is out with breaking changes (new generator, no automatic env loading). A planned migration, not a drive-by. |
| Zod | 3.25 | Zod 4 is stable. |
| next-auth | 5.0.0-beta.25 | Still a beta pin; the repo's own comments record beta quirks. |

## Where the repository stands against the thresholds

| Area | Finding (from the metrics) | Recommended threshold | Verdict |
| --- | --- | --- | --- |
| File length | `lib/calicotab/ingest.ts` 2,331 lines; `parseTabs.ts` 1,291; `buildCvData.ts` 1,264 | warn 400, block 800 for new files | Three files far over; ingest is the outlier. |
| Function length | `buildCvData` is one function of about 939 lines; `writeIngestTransaction` and `computeSpeakerStats` about 450 each | warn 60 | The largest single maintainability risk. |
| Escape hatches | 0 `any`, 0 `@ts-ignore`, 0 `TODO`/`FIXME`; 7 `as unknown as`; 4 `eslint-disable` | 0 new | A strength. Keep it with a ratchet. |
| Compiler strictness | `strict` only; `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch` all off | enable, in order of cost | Gap, cheap ones first. |
| Linting | `next/core-web-vitals` and `next/typescript` only; no type-aware rules; no size or complexity rules | add `max-lines`, `complexity`, `max-params`, `max-depth` as warnings; type-aware strict set | Gap. |
| Tests | 1,273 cases in 142 files, test to source lines 0.56; 22 of 79 lib modules without a matching test file, including `buildCvData`, `rateLimit`, `auth`, `fetchSession` | a test with every logic change; block missing tests in parse, stats and ingest | Good volume, uneven coverage. |
| Duplication, formatter, CI gates | not measured | duplication check; formatter `--check` in CI | Unknown; decide. |

The research is explicit that line counts are smoke alarms. For the 2,000-line orchestrator it recommends splitting along real seams (fetch, parse, normalise, persist, enqueue) into modules with small interfaces, not into dozens of five-line helpers, and it backs that with the published Martin/Ousterhout debate.

## Proposed order

**Phase 1: cheap and safe (one small PR each)**
1. Turn on `noFallthroughCasesInSwitch` and `noImplicitOverride` (low churn).
2. Add ESLint `max-lines`, `max-lines-per-function`, `complexity`, `max-params`, `max-depth` as warnings so a baseline appears without blocking anything.
3. Write down a ratchet rule: no new `any`, `as unknown as`, `!` or unexplained `eslint-disable`.

**Phase 2: tests before any refactor**
4. Add tests for `rateLimit`, `fetchSession` and the untested parts of `auth`.
5. Add characterization tests around `buildCvData` and the ingest transaction, so splitting them can be checked.

**Phase 3: structure (needs a short design note and your go-ahead each)**
6. Split `ingest.ts` and `buildCvData.ts` along the seams above, one extraction per PR, tests green throughout.
7. Add type-aware linting (the strict-type-checked set) in warning mode, then ratchet.
8. Consider `noUncheckedIndexedAccess` last: highest churn.

**Phase 4: platform upgrades (separate planned migrations)**
9. Next 16, then Zod 4, TypeScript 6/7, and Prisma 7, each with its own note and rollback. Prisma 7 is the heaviest.

## Decisions for the owner

- Whether to adopt a formatter check in CI (Prettier or Biome).
- Whether new files may exceed 800 lines (the research says block; existing giants get dated split notes).
- The order and timing of the platform upgrades, starting with Next 16.
