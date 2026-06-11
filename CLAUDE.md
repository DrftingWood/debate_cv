# debate_cv

## Project

Personal debate CV builder. Signs the user in with Google, reads Gmail (read-only) for Tabbycat tournament URLs (`*.calicotab.com` / `*.herokuapp.com`), scrapes the public tabs pages (team / speaker / rounds / break / participants), normalizes and stores results in Postgres, and renders a personal CV at `/cv` (plus an optional public view at `/u/<slug>`).

## Current state

~90% functional. Real users, real data, deployed on Vercel. Treat as a live codebase — verify before changing shared behavior.

**Session status, pending operator steps, and next-agent priorities live in `docs/HANDOFF.md` — read it before starting work.**

## Stack (from package.json)

- **Next.js 15.1** App Router, React 19, TypeScript 5.7 (strict)
- **Auth.js / next-auth v5 beta** (`5.0.0-beta.25`) with `@auth/prisma-adapter`, Google OAuth (`openid email profile gmail.readonly`)
- **Prisma 6** against Postgres (Vercel Postgres / Neon — `POSTGRES_PRISMA_URL` pooled + `POSTGRES_URL_NON_POOLING` for migrations)
- **Tailwind 3.4** + `@tailwindcss/typography`, custom HSL CSS-var design tokens
- **googleapis 144** for Gmail, **cheerio 1** for scraping
- **Sentry** (`@sentry/nextjs` 10) wired via `withSentryConfig` in `next.config.ts`, tunneled through `/monitoring`
- **Vitest 2** for tests (Node env)
- **zod 3** for validation, **clsx** + **tailwind-merge** for class composition, **lucide-react** for icons
- Node `>=20`. Package manager: **npm** (`package-lock.json` is the only committed lockfile; Vercel auto-detects npm from it). Previously a stale `pnpm-lock.yaml` was also committed, but it drifted and broke prod deploys — removed.

## Architecture

```
app/                          Next.js App Router (routes + API handlers)
  page.tsx                    Landing → redirects to /dashboard when signed in
  dashboard/                  Scan Gmail, ingest status, identity review
  cv/                         Personal CV + roster picker fallback (verify/)
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
  db.ts                       Prisma client singleton
  crypto.ts                   AES-256-GCM for Gmail token encryption
  queue.ts                    FOR UPDATE SKIP LOCKED job helpers
  admin.ts                    Admin allowlist
  gmail/                      client (OAuth + encrypt/decrypt), extract (URL regex + MIME walk), run (bounded concurrency)
  calicotab/                  fetch, parseNav, parseTabs, fingerprint, provenance, personMatch, primaryTeam, judgeStats, breakCategoryResolve, redactedSpeaker, ingest (orchestrator), version (PARSER_VERSION — bump to invalidate cached parses)
  cv/                         buildCvData, computeSpeakerAvg, speakerSignals, teamRanks
  notifications/write.ts      In-app feed writer (bell icon; no email/push by design)
  sharing/slug.ts             Public CV slug helpers
  cvErrorReports/categories.ts
  utils/                      api, cn (clsx+tw-merge), csv, site

components/
  ui/                         Button, Card, Badge, Toast, Skeleton, Spinner, StatusPill, EmptyState
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
- **Styling**: Tailwind with HSL CSS variables (see `tailwind.config.ts` + `app/globals.css`). Use `cn()` from `lib/utils/cn.ts` for conditional classes. Custom font-size scale (`caption`/`body`/`h1`–`h3`/`display`) and shadow/radius tokens — prefer these over raw values.
- **Server-first**: App Router; API routes in `app/api/**/route.ts`. Heavy deps (`@prisma/client`, `googleapis`) declared in `serverExternalPackages`.
- **DB access**: always via the `lib/db.ts` singleton, never `new PrismaClient()`.
- **Secrets**: Gmail tokens encrypted at rest via `lib/crypto.ts` (AES-256-GCM, key from env). Don't log decrypted tokens.
- **Queue**: `lib/queue.ts` uses Postgres advisory locks + `FOR UPDATE SKIP LOCKED`. There's a deadlock test — preserve lock ordering when touching it.
- **Parser versioning**: bump `PARSER_VERSION` in `lib/calicotab/version.ts` to invalidate cached parses after changing parsing logic.
- **Validation**: `zod` at API boundaries.
- **Lint**: flat ESLint config extending `next/core-web-vitals` + `next/typescript`. `no-unescaped-entities` is intentionally off, `no-unused-vars` warns and allows `_`-prefixed.
- **Comments**: existing code uses long, narrative comments explaining *why* (see `next.config.ts`, `prisma/schema.prisma`). Match that voice when the rationale is non-obvious; don't add comments that only restate the code.
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
- `scripts/test-scrape.mjs` — manual scrape dev helper

## Deploy

Vercel. `vercel.json` declares one cron (`/api/cron/process-queue`, daily 03:00 — Hobby allows daily granularity only). `.github/workflows/drain-queue.yml` supplements it for free: a GitHub Actions schedule curls the same endpoint every 15 minutes (needs `APP_URL` + `CRON_SECRET` repo secrets; no-ops until set). GH schedules are best-effort and auto-suspend after 60 days of repo inactivity — the Vercel cron is the guaranteed backstop, and it owns the daily retention prune (gated to the 03:00 UTC hour inside the route). Sentry source-map upload runs at build when `SENTRY_AUTH_TOKEN` is set (CI only — local builds silent).

## Environment

See `.env.example` for the full list. Key buckets: Google OAuth, Postgres (pooled + direct), `TOKEN_ENCRYPTION_KEY`, Sentry DSN/auth, admin allowlist.

## Known gaps / TODO

- [x] ~~`SourceDocument` / `ParserRun` unbounded growth~~ — cron drain now ends with `pruneIngestArtifacts()` (lib/calicotab/provenance.ts): 90-day retention, keeping the newest snapshot per URL (the re-derivation archive) and each document's latest successful ParserRun (load-bearing for `isLatestParserRun` cache checks).
- [x] ~~Legacy `rank:N` writes on `EliminationResult.result`~~ — writes stopped (verified unread; /cv/verify's badge was cosmetic noise), historical rows nulled in migration 20260611160000.
- [x] ~~Missing `@updatedAt` on `IngestJob` / `DiscoveredUrl`~~ — added; the queue's raw-SQL paths set `"updatedAt" = NOW()` explicitly since Prisma's @updatedAt only fires on client operations — keep that in mind for any future raw UPDATE.
- [x] ~~Haiku classifier for motion tags~~ — `/admin/tags` "Suggest motion tags" button → `POST /api/admin/tags/classify` (claude-haiku-4-5, structured outputs constrained to the vocabulary); files PENDING proposals, approval stays in the loop. Needs `ANTHROPIC_API_KEY`.
- [ ] Speaker order within a round (1st vs 2nd speaker) needs per-ballot pages (`/results/round/N/speaker/<token>/`) — deliberately not scraped; revisit only on demand.

## Out of scope for Superpowers

- **Do not retroactively TDD existing components or routes.** Tests already cover the load-bearing parsing, queue, crypto, and API surface; adding tests for a stable component just to "have a test" is noise.
- **Do not refactor working code for style.** The narrative-comment style and flat component layout are intentional — match them rather than restructuring.
- **Do not introduce a new state-management lib, UI kit, ORM, or test framework.** The existing stack (Server Components + Prisma + Vitest + Tailwind primitives in `components/ui/`) is the choice.
- **Do not bump `PARSER_VERSION` casually** — it invalidates cached parses across all users.
- **Do not change queue lock ordering** without re-running `tests/calicotab.deadlock.test.ts` and understanding why it exists.
- **Do not commit decrypted tokens to logs, fixtures, or test snapshots.**
- **Do not re-introduce `pnpm-lock.yaml`**. The repo is npm-only; Vercel auto-detects pnpm from the lockfile's presence and will then refuse to install against a mismatched lockfile. If you have a real reason to add pnpm support, it has to be a deliberate two-lockfile maintenance discipline, not an accidental drop-in.
