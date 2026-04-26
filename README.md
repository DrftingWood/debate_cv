# debate cv

Gmail → Tabbycat scrape → Postgres → personal debate CV. Deploys to Vercel.

You sign in with Google. The app reads your Gmail (read-only), pulls Tabbycat private URLs
(`*.calicotab.com` / `*.herokuapp.com`), scrapes each tournament's public tabs
(team / speaker / round results / break / participants), and compiles a debate CV you can view at `/cv`.

## Architecture at a glance

```
app/                               Next.js App Router — routes + API handlers
  page.tsx                         Landing (unauth) / redirect to /dashboard (auth)
  dashboard/                       Scan Gmail, ingest status, identity review
  cv/                              Personal CV with roster picker fallback
  settings/                        Disconnect, delete, export JSON
  privacy/, terms/                 Consent-screen-required legal pages
  api/
    auth/[...nextauth]/            NextAuth v5 handler
    ingest/gmail                   POST — discover URLs from Gmail, enqueue jobs
    ingest/url                     POST — ingest a single URL synchronously
    ingest/drain                   POST — user-scoped queue drainer (~50 s budget)
    cron/process-queue             GET/POST — daily cron safety net
    persons/[id]/claim | reject    POST/DELETE — identity review actions
    account/disconnect | delete | export  Privacy controls
lib/
  auth.ts                          NextAuth config (Google, Prisma adapter)
  db.ts                            Prisma client singleton
  crypto.ts                        AES-256-GCM for token encryption
  queue.ts                         FOR UPDATE SKIP LOCKED job helpers
  gmail/
    client.ts                      OAuth client factory + token encrypt/decrypt
    extract.ts                     PRIVATE_URL_RE regex, MIME walker, dedupe
    run.ts                         Bounded-concurrency Gmail list+get
  calicotab/
    fetch.ts                       Rate-limited fetch + SourceDocument provenance
    parseNav.ts                    Private-URL landing (nav + registration)
    parseTabs.ts                   team/speaker/round/break/participants
    fingerprint.ts                 Tournament fingerprint + name normalization
    provenance.ts                  ParserRun records + warnings
    version.ts                     PARSER_VERSION (bump to invalidate cache)
    ingest.ts                      Orchestrator: URL → full upsert in one tx
components/
  ui/*                             Button / Card / Badge / Toast / Skeleton / ...
  features                         DashboardActions, IdentityReview, ClaimPersonButton
prisma/
  schema.prisma                    Auth + queue + calicotab + provenance
  migrations/                      Four migrations tracked in git
vercel.json                        Daily cron
```

## Stack

- **Next.js 15** (App Router, TypeScript) + **Tailwind**
- **Auth.js v5** with Google OAuth (`openid email profile gmail.readonly`)
- **Prisma** against Postgres
- **googleapis** SDK for Gmail
- **cheerio** for HTML parsing
- **Vercel Cron** drains the ingest queue once per day (Hobby-tier compatible); manual scans drain inline

## Deploy to Vercel (the "just chill" path)

### 1. Google Cloud: create the OAuth client

1. [Create a GCP project](https://console.cloud.google.com/projectcreate).
2. Enable the **Gmail API** (APIs & Services → Library).
3. Configure the **OAuth consent screen** (External):
   - App name, support email, developer email.
   - Scopes: add `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `.../auth/gmail.readonly`.
   - App domain: your Vercel URL. Privacy Policy: `https://<your-domain>/privacy`. Terms: `https://<your-domain>/terms`.
   - Add yourself (and any friends) as **Test Users** so you can use the app before Google verifies it.
4. Create an **OAuth client ID** (Web application). Authorized redirect URIs:
   - `https://<your-vercel-domain>/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google` (for local dev)
5. Save the **Client ID** and **Client secret** for step 3.

### 2. Vercel: import the repo and attach Postgres

1. Log in to Vercel → **Add New → Project** → import `DrftingWood/debate_cv`.
2. Before the first deploy, open **Storage** → **Create Database** → **Postgres** (or attach an existing Vercel Postgres / Neon). Vercel auto-injects the full set of Postgres env vars including `POSTGRES_PRISMA_URL` (pooled, used at runtime) and `POSTGRES_URL_NON_POOLING` (direct, used by `prisma migrate deploy`) — no manual DB env vars to copy.
3. Under **Settings → Environment Variables**, add:
   - `AUTH_GOOGLE_ID` – from GCP step 1.
   - `AUTH_GOOGLE_SECRET` – from GCP step 1.
   - `AUTH_SECRET` – generate with `openssl rand -base64 32`.
   - `CRON_SECRET` – any long random string required for `/api/cron/process-queue`; Vercel sends it as a `Bearer` token to scheduled cron requests.
4. Click **Deploy**. The build command runs `prisma generate && next build`. The DB is migrated automatically on the first request via `prisma migrate deploy`; you can also run it once manually from the Vercel CLI:
   ```sh
   vercel env pull .env.production.local
   pnpm prisma migrate deploy
   ```

### 3. Use it

1. Visit your Vercel URL, click **Sign in with Google**, grant Gmail read access.
2. On the dashboard, click **Scan Gmail**. The same request auto-drains the queue, so rows go straight from `pending` to `done` (up to ~50 seconds of ingestion per click).
3. If anything's still `pending` after that, click **Process queued** to continue, or **Ingest now** on a single row.
4. Open **My CV** (`/cv`).

A daily cron at `0 3 * * *` also drains anything left in the queue as a safety net (Hobby-tier compatible; Pro users can tighten the schedule in `vercel.json`).

## Local development

```sh
# 1. Install
pnpm install

# 2. Environment
cp .env.example .env
# Fill in AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, AUTH_SECRET, POSTGRES_PRISMA_URL,
# POSTGRES_URL_NON_POOLING, CRON_SECRET. Any Postgres works — local Docker,
# Neon branch DB, Supabase project. For local dev you can set both URLs to the
# same connection string.

# 3. Migrate
pnpm prisma migrate dev

# 4. Run
pnpm dev   # http://localhost:3000
```

### Tests

```sh
pnpm test        # vitest (parser + fingerprint + Gmail extract + crypto + contracts)
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm build       # next build
```

### Token encryption at rest

Set `TOKEN_ENCRYPTION_KEY` in your Vercel env (`openssl rand -base64 32`). Access +
refresh tokens in the `GmailToken` table are stored as
`v1:<iv>:<tag>:<ciphertext>` under AES-256-GCM. Rows written before the key was
configured stay readable as plaintext and are marked `encryptionVersion = null`.

To rotate: generate a new key, set it alongside the old one, add a new `v2`
branch to `lib/crypto.ts`, and run a one-time re-encrypt script over the table.

### Reparse when parsers change

Every landing-page fetch records a `SourceDocument` row (url + content hash +
status) and a `ParserRun` row stamped with `PARSER_VERSION`
(`lib/calicotab/version.ts`). When you change parsers, bump `PARSER_VERSION`.
The ingest orchestrator checks the latest `ParserRun` against the current
version; if it's older, the 30-day freshness cache is bypassed for that URL and
a fresh parse is performed on the next scan.

## Where things live

```
app/                              Routes (UI + API)
  page.tsx                        Landing (unauth) / redirect to dashboard (auth)
  dashboard/page.tsx              Extracted URLs, job status, manual ingest
  cv/page.tsx                     Personal CV rendered from claimed Person rows
  privacy/, terms/                Required for Google OAuth consent
  api/auth/[...nextauth]/         NextAuth handler
  api/ingest/gmail/               POST: scan Gmail, enqueue URLs
  api/ingest/url/                 POST: ingest a single URL (sync)
  api/ingest/jobs/                GET: user's job list
  api/cv/                         GET: CV JSON
  api/cron/process-queue/         Vercel cron; drains up to 5 pending jobs
lib/
  auth.ts                         NextAuth v5 + Prisma adapter + Gmail token persist
  db.ts                           Prisma client singleton
  queue.ts                        FOR UPDATE SKIP LOCKED job claim
  gmail/
    extract.ts                    PRIVATE_URL_RE, MIME walker, dedupe
    run.ts                        Gmail list+get with bounded concurrency
    client.ts                     OAuth client from stored refresh token
  calicotab/
    fetch.ts                      Rate-limited HTTP with User-Agent
    parseNav.ts                   Private-URL landing page (nav + registration)
    parseTabs.ts                  team / speaker / round / break / participants
    fingerprint.ts                Tournament fingerprint, year extraction
    ingest.ts                     Orchestrator: URL → full upsert in one tx
prisma/
  schema.prisma                   Auth + ingest queue + Calicotab schema
  migrations/                     Prisma migrations
tests/                            Vitest
vercel.json                       Cron schedule */2 * * * *
```

## Security notes

- OAuth refresh tokens are stored in the DB unencrypted (MVP). Before opening the app to users outside your Test Users list, add encryption-at-rest (e.g. a KMS-backed wrapper around `GmailToken`).
- The Gmail scope is `gmail.readonly`. The app never writes to Gmail.
- No email bodies are stored — only the extracted URLs + their subject/date/message-id for provenance.

## Related docs

- [`GMAIL_OAUTH_WEBSITE_GUIDE.md`](./GMAIL_OAUTH_WEBSITE_GUIDE.md) — OAuth walkthrough
- [`docs/CALICOTAB_DATA_MODEL.md`](./docs/CALICOTAB_DATA_MODEL.md) — entities and extraction contract
- [`docs/CALICOTAB_TAB_STRUCTURE.md`](./docs/CALICOTAB_TAB_STRUCTURE.md) — Tabbycat URL conventions
- [`docs/INGESTION_WORKFLOW.md`](./docs/INGESTION_WORKFLOW.md) — pipeline pseudo-code
