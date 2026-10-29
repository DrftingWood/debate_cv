# debate_cv

## Project

Personal debate CV builder. Signs the user in with Google, reads Gmail (read-only) for Tabbycat tournament URLs (`*.calicotab.com` / `*.herokuapp.com`), scrapes the public tabs pages (team / speaker / rounds / break / participants), normalizes and stores results in Postgres, and renders a personal CV at `/cv` (plus an optional public view at `/u/<slug>`).

## Current state

~90% functional. Real users, real data, deployed on Vercel. Treat as a live codebase — verify before changing shared behavior.

**Session status, pending operator steps, and next-agent priorities live in `docs/HANDOFF.md` — read it before starting work.**

**Tasks that need design judgement (B6, B8, B9 and the parked set) are listed in `docs/OPUS_TASKS.md` with a "done when" line each — read it before picking one up.**

**Coding rules (40, each with how it is enforced) are in `docs/CODING_STANDARDS.md`; what CI checks and how to run each check locally is in `docs/CI_PLAN-2026-10-27.md`.**

**UI/UX rules (43, WCAG 2.2 AA and cited sources, each with its enforcement) are in `docs/UI_UX_STANDARDS.md`; the ranked audit of every screen against them, with the proposed fix split, is `docs/UI_UX_AUDIT-2026-10-27.md`. `npm run a11y` is a report-only axe + Playwright smoke check (setup in the header of `scripts/a11y-smoke.mjs`).**

## Stack (from package.json)

- **Next.js 16** App Router (Turbopack; `proxy.ts` is the old middleware), React 19, TypeScript 6.0 (strict; stay on `~6.0` until typescript-eslint supports 7)
- **Auth.js / next-auth v5 beta** (`5.0.0-beta.32`, pinned exactly; one `@auth/core` 0.41.3 shared with `@auth/prisma-adapter` 2.11.3), Google OAuth (`openid email profile gmail.readonly`)
- **Prisma 7** against Postgres (Vercel Postgres / Neon) through the `pg` driver adapter: `POSTGRES_PRISMA_URL` (pooled) feeds `lib/db.ts`, which sizes the pool in code; `POSTGRES_URL_NON_POOLING` (direct) feeds `prisma.config.ts` for migrations. Prisma 7 does not load `.env` itself
- **Tailwind 4** (`@tailwindcss/postcss`; no JS config, the theme is the `@theme` block in `app/globals.css`) + `@tailwindcss/typography` via `@plugin`, custom HSL CSS-var design tokens
- **googleapis 144** for Gmail, **cheerio 1** for scraping
- **Sentry** (`@sentry/nextjs` 10) wired via `withSentryConfig` in `next.config.ts`, tunneled through `/monitoring`
- **Vitest 2** for tests (Node env)
- **zod 4** for validation, **clsx** + **tailwind-merge** for class composition, **lucide-react** for icons
- Node `>=20`. Package manager: **npm** (`package-lock.json` is the only committed lockfile; Vercel auto-detects npm from it). Previously a stale `pnpm-lock.yaml` was also committed, but it drifted and broke prod deploys — removed.

## Architecture

```
app/                          Next.js App Router (routes + API handlers)
  page.tsx                    Landing → redirects to /dashboard when signed in
  dashboard/                  Scan Gmail, ingest status, identity review
  cv/                         Personal record; sub-surfaces: stats/ (deep statistics),
                              motions/ (motion archive), tags/, verify/.
                              analytics/ is a permanent redirect → stats/
  u/                          Public CV at /u/<slug>
  settings/                   Disconnect, delete account, export JSON, sharing
  onboarding/                 First-run flow
  admin/                      Admin tools (gated via lib/admin.ts)
  privacy/, terms/            Static legal pages
  api/
    auth/[...nextauth]/       NextAuth v5 handler
    ingest/{gmail,url,drain,clear,lock,retry-failed,reingest-mine,errors-export}
    cron/process-queue        Daily Vercel Cron drain (vercel.json)
    persons/[id]/{claim,reject}
    account/{disconnect,delete,export}
    notifications/, sharing/, cv/, tournaments/, debug/, sentry-test/

lib/
  auth.ts                     NextAuth config
  db.ts                       Prisma client singleton (pg adapter, pool sizing)
  crypto.ts                   AES-256-GCM for Gmail token encryption
  queue.ts                    FOR UPDATE SKIP LOCKED job helpers
  admin.ts                    Admin allowlist
  gmail/                      client (OAuth + encrypt/decrypt), extract (URL regex + MIME walk), run (bounded concurrency)
  calicotab/                  fetch, parseNav, parseTabs, fingerprint, provenance, personMatch, primaryTeam, judgeStats, breakCategoryResolve, redactedSpeaker, ingest (orchestrator), version (PARSER_VERSION — bump to invalidate cached parses)
  cv/                         buildCvData (rows + motions + per-tournament field summary),
                              speakerStats (the deep statistics engine — pure, sample-size-
                              carrying; also owns the per-season trends), computeSpeakerAvg,
                              speakerSignals, teamRanks, exportFields
  notifications/write.ts      In-app feed writer (bell icon; no email/push by design)
  sharing/slug.ts             Public CV slug helpers
  cvErrorReports/categories.ts
  utils/                      api, cn (clsx+tw-merge), csv, site

components/
  ui/                         Primitives: Button, Card (+ SectionHeader), Badge, Toast, Skeleton,
                              Spinner, StatusPill, EmptyState, DataTable (Table/Th/Td/Tr/Nil),
                              StatTile (+ StatRow, DeltaChip), TrendChart (+ Sparkline),
                              BarList (+ Meter, Histogram)
  (flat)                      Feature components (DashboardActions, IdentityManager, CvHighlights, SharingManager, ...)

prisma/
  schema.prisma               Auth + queue + calicotab + provenance + notifications + sharing
  migrations/                 Tracked in git; `migrate-if-configured.mjs` runs on build when DB URL is set

src/calicotab_parser.py       Standalone Python parser (reference / experiment — JS path in lib/calicotab is canonical)

tests/                        Vitest, flat layout (`tests/*.test.ts` + `tests/api/*.test.ts`); shared helpers in tests/setup/
```

## Conventions in use

- **Path alias**: `@/*` → repo root (e.g. `@/lib/db`, `@/components/ui/Button`). Both tsconfig and vitest are configured.
- **Components**: flat in `components/`, no per-component folders, no colocated styles (Tailwind only). Primitive UI lives in `components/ui/`; feature components sit alongside.
- **Styling**: Tailwind with HSL CSS variables (the `@theme` block and the theme variables in `app/globals.css`). Use `cn()` from `lib/utils/cn.ts` for conditional classes. Custom font-size scale (`caption`/`body`/`h1`–`h4`/`figure-sm|md|lg`/`display`) and shadow/radius tokens — prefer these over raw values.
- **Design language ("Ledger", 2026-07)**: the UI is a bank statement, not an editorial page. Read `docs/DESIGN_INSTRUCTIONS.md` §6 before any visual change. In practice: surfaces are `panel` / `panel-inset` / `panel-raised`; tables use the `.ledger` mechanics with `.cell-num` for numeric columns; micro-labels are `.data-label` (neutral) or `.eyebrow` (accented); headline figures use `.figure`; directional values use `.val-pos` / `.val-neg`. Colour on a number always means up/down — never brand or mood. The `ink` / `paper` / `oxblood` Tailwind aliases are an abstract contract (foreground / background / accent) and survive rethemes; prefer the explicit `surface-*`, `pos`, `neg`, `break-gold`, `score-blue` tokens in new work.
- **Server-first**: App Router; API routes in `app/api/**/route.ts`. Heavy deps (`@prisma/client`, `googleapis`) declared in `serverExternalPackages`.
- **DB access**: always via the `lib/db.ts` singleton, never `new PrismaClient()`.
- **Secrets**: Gmail tokens encrypted at rest via `lib/crypto.ts` (AES-256-GCM, key from env). Don't log decrypted tokens.
- **Queue**: `lib/queue.ts` uses Postgres advisory locks + `FOR UPDATE SKIP LOCKED`. There's a deadlock test — preserve lock ordering when touching it.
- **Parser versioning**: bump `PARSER_VERSION` in `lib/calicotab/version.ts` to invalidate cached parses after changing parsing logic.
- **Validation**: `zod` at API boundaries.
- **Lint**: flat ESLint config using `eslint-config-next/core-web-vitals` + `/typescript` (native flat config; `react-hooks/set-state-in-effect` is an error, so a flagged effect needs a real fix or an explained `eslint-disable-next-line -- reason`). `no-unescaped-entities` is intentionally off, `no-unused-vars` warns and allows `_`-prefixed.
- **Comments**: existing code uses long, narrative comments explaining _why_ (see `next.config.ts`, `prisma/schema.prisma`). Match that voice when the rationale is non-obvious; don't add comments that only restate the code.
- **Error reporting**: Sentry is live in prod; client SDK tunnels through `/monitoring`. `instrumentation.ts` + `sentry.{client,server,edge}.config.ts` wire it up.

## Tests

Vitest. Suites already exist for most calicotab parsing (`parseNav`, `parseTabs.*`, `fingerprint`, `personMatch`, `primaryTeam`, `judgeStats`, `breakCategoryResolve`, `redactedSpeaker`, `advisoryLock`, `deadlock`, `outroundStageRank`), gmail extraction, crypto, queue, CV computation, notifications, and most `/api/ingest/*` + `/api/account/*` + `/api/sharing` + `/api/notifications` routes. `tests/setup/api-test-utils.ts` has the shared API harness.

There's one stray Python test (`tests/test_calicotab_parser.py`) for `src/calicotab_parser.py`; Vitest only picks up `tests/**/*.test.ts`, so it's not in the JS run.

When adding new parsing logic or queue/lock changes, add a vitest case alongside the existing pattern. Don't retroactively add tests for already-covered components — see "Out of scope" below.

## Scripts

- `npm run dev` — Next dev server
- `npm run build` — `prisma generate && scripts/migrate-if-configured.mjs && next build` (migrate is a no-op without a DB URL)
- `npm start` — Next prod server
- `npm run lint` — `eslint .`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — `vitest run`
- `npm run prisma:migrate` / `prisma:migrate:dev` / `prisma:generate`
- `npm run seed:dev` — wipe a LOCAL database and seed a realistic record (`scripts/seed-dev-data.mjs`)
- `scripts/test-scrape.mjs` — manual scrape dev helper

## Local development against real data

The display layer is a projection of scraped tournament data, so reading the
code is not enough to review it — three shipped defects in the 2026-07
rebuild were invisible until the pages were rendered against a database.

```bash
service postgresql start
su postgres -c "createdb debate_cv_dev"
# .env.local (gitignored): POSTGRES_PRISMA_URL + POSTGRES_URL_NON_POOLING
#   → postgres://postgres:<pw>@127.0.0.1:5432/debate_cv_dev
npx prisma migrate deploy
npm run seed:dev          # prints a session token
npm run dev
```

`seed:dev` refuses to run against a non-localhost URL (it deletes rows). It
prints an `authjs.session-token` value — set that cookie to browse as the
seeded user without going through Google. Note that **`next dev` is required**
for cookie auth locally: `next start` runs in production mode, where Auth.js
uses `__Secure-` prefixed cookies that a plain-http localhost will not send.

The dataset is deliberately awkward — a tournament with no prelim-round
count, one the user only judged at, an undated one, a partial draw, rounds
with two motions, a tab with no score totals. Each maps to a display branch.

## Deploy

Vercel. `vercel.json` declares one cron (`/api/cron/process-queue`, daily 03:00 — Hobby allows daily granularity only). `.github/workflows/drain-queue.yml` supplements it for free: a GitHub Actions schedule curls the same endpoint every 15 minutes (needs `APP_URL` + `CRON_SECRET` repo secrets; no-ops until set). GH schedules are best-effort and auto-suspend after 60 days of repo inactivity — the Vercel cron is the guaranteed backstop, and it owns the daily retention prune (gated to the 03:00 UTC hour inside the route). Migrations run only for production deployments: `scripts/migrate-if-configured.mjs` skips Vercel builds where `VERCEL_ENV` is not `production` (a preview once applied an unmerged migration to a real database); set `ALLOW_PREVIEW_MIGRATIONS=1` only for a preview with its own isolated database. Sentry source-map upload runs at build when `SENTRY_AUTH_TOKEN` is set (CI only — local builds silent).

Deployments are created only for `main` and `preview/*` branches (`git.deploymentEnabled` in `vercel.json`); agent and feature branches (`claude/**`, `feat/**`, `fix/**`, `worktree-agent-*`, etc.) create none, because Hobby caps deployments at ~100/day and exhausting it blocks production deploys. To get a preview, name the branch `preview/<name>`. GitHub Actions `verify` still runs on every PR; Vercel's own status check is simply absent on disabled branches (only `verify` is required to merge).

## Environment

See `.env.example` for the full list. Key buckets: Google OAuth, Postgres (pooled + direct), `TOKEN_ENCRYPTION_KEY`, Sentry DSN/auth, admin allowlist.

## Known gaps / TODO

- [x] ~~`SourceDocument` / `ParserRun` unbounded growth~~ — cron drain now ends with `pruneIngestArtifacts()` (lib/calicotab/provenance.ts): 90-day retention, keeping the newest snapshot per URL (the re-derivation archive) and each document's latest successful ParserRun (load-bearing for `isLatestParserRun` cache checks).
- [x] ~~Legacy `rank:N` writes on `EliminationResult.result`~~ — writes stopped (verified unread; /cv/verify's badge was cosmetic noise), historical rows nulled in migration 20260611160000.
- [x] ~~Missing `@updatedAt` on `IngestJob` / `DiscoveredUrl`~~ — added; the queue's raw-SQL paths set `"updatedAt" = NOW()` explicitly since Prisma's @updatedAt only fires on client operations — keep that in mind for any future raw UPDATE.
- [x] ~~Haiku classifier for motion tags~~ — `/admin/tags` "Suggest motion tags" button → `POST /api/admin/tags/classify` (claude-haiku-4-5, structured outputs constrained to the vocabulary); files PENDING proposals, approval stays in the loop. Needs `ANTHROPIC_API_KEY`.
- [ ] Speaker order within a round (1st vs 2nd speaker) needs per-ballot pages (`/results/round/N/speaker/<token>/`) — deliberately not scraped; revisit only on demand.
- [ ] Round-level field percentiles (how a single speech placed among all speakers that round) would need every participant's `SpeakerRoundScore`, not just their totals — ~800 speakers × 9 rounds per major. `buildCvData` deliberately fetches totals only; revisit only if someone asks for it.
- [x] ~~CSV/XLSX export carries neither motions nor field placement~~ — six columns appended to `lib/cv/exportFields.ts` (`field_placement`, `field_average`, `field_delta`, `motions`, `motion_types`, `motion_topics`). Accessors now take a second `ExportContext` argument because those are per-tournament facts on sibling `CvData` arrays, not row columns. `/api/cv/export` asks `exportNeedsFieldStats()` before deciding whether to pay for `buildCvData`'s field-summary query. The registry stays **append-only** — new fields go on the end.

## Out of scope for Superpowers

- **Do not retroactively TDD existing components or routes.** Tests already cover the load-bearing parsing, queue, crypto, and API surface; adding tests for a stable component just to "have a test" is noise.
- **Do not refactor working code for style.** The narrative-comment style and flat component layout are intentional — match them rather than restructuring.
- **Do not introduce a new state-management lib, UI kit, ORM, or test framework.** The existing stack (Server Components + Prisma + Vitest + Tailwind primitives in `components/ui/`) is the choice.
- **Do not bump `PARSER_VERSION` casually** — it invalidates cached parses across all users.
- **Do not change queue lock ordering** without re-running `tests/calicotab.deadlock.test.ts` and understanding why it exists.
- **Do not commit decrypted tokens to logs, fixtures, or test snapshots.**
- **After any `npm install` on Windows, restore the two nested `@emnapi/*@1.11.2` entries under `@oxc-resolver/binding-wasm32-wasi` in `package-lock.json` from `origin/main`**, or `npm ci` fails on Linux CI (see `docs/HANDOFF.md`).
- **Do not re-introduce `pnpm-lock.yaml`**. The repo is npm-only; Vercel auto-detects pnpm from the lockfile's presence and will then refuse to install against a mismatched lockfile. If you have a real reason to add pnpm support, it has to be a deliberate two-lockfile maintenance discipline, not an accidental drop-in.
