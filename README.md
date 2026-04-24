# debate cv

Gmail → Tabbycat scrape → Postgres → personal debate CV. Deploys to Vercel.

You sign in with Google. The app reads your Gmail (read-only), pulls Tabbycat private URLs
(`*.calicotab.com` / `*.herokuapp.com`), scrapes each tournament's public tabs
(team / speaker / round results / break / participants), and compiles a debate CV you can view at `/cv`.

## Stack

- **Next.js 15** (App Router, TypeScript) + **Tailwind**
- **Auth.js v5** with Google OAuth (`openid email profile gmail.readonly`)
- **Prisma** against Postgres
- **googleapis** SDK for Gmail
- **cheerio** for HTML parsing
- **Vercel Cron** to drain the ingest queue every 2 minutes

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
2. Before the first deploy, open **Storage** → **Create Database** → **Postgres** (or attach an existing Vercel Postgres / Neon). Vercel auto-injects `DATABASE_URL` and `DIRECT_URL`.
3. Under **Settings → Environment Variables**, add:
   - `AUTH_GOOGLE_ID` – from GCP step 1.
   - `AUTH_GOOGLE_SECRET` – from GCP step 1.
   - `AUTH_SECRET` – generate with `openssl rand -base64 32`.
   - `CRON_SECRET` – any long random string (optional; the cron also accepts Vercel's signed `x-vercel-cron: 1` header).
4. Click **Deploy**. The build command runs `prisma generate && next build`. The DB is migrated automatically on the first request via `prisma migrate deploy`; you can also run it once manually from the Vercel CLI:
   ```sh
   vercel env pull .env.production.local
   pnpm prisma migrate deploy
   ```

### 3. Use it

1. Visit your Vercel URL, click **Sign in with Google**, grant Gmail read access.
2. On the dashboard, click **Scan Gmail**. Private URLs appear as rows with status `pending`.
3. Wait ~2 minutes for the cron to drain the queue (or click **Ingest now** on any row).
4. Open **My CV** (`/cv`).

## Local development

```sh
# 1. Install
pnpm install

# 2. Environment
cp .env.example .env
# Fill in AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, AUTH_SECRET, DATABASE_URL (+ DIRECT_URL), CRON_SECRET.
# Any Postgres works — local Docker, Neon branch DB, Supabase project.

# 3. Migrate
pnpm prisma migrate dev

# 4. Run
pnpm dev   # http://localhost:3000
```

### Tests

```sh
pnpm test        # vitest (parser + fingerprint + Gmail extract tests)
pnpm typecheck   # tsc --noEmit
pnpm build       # next build
```

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
