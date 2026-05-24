# Session Handoff — debate_cv

**Date:** 2026-05-24
**Last commit on `main`:** `65d4915 fix(auth): resolve userId via fallbacks + log when Gmail token write skips`
**Production:** Vercel + Neon Postgres; both latest deploys (`2a6488b` and `65d4915`) are READY.

---

## Where things stand right now

### Open critical issue — Reconnect Gmail token write

The user disconnected their GmailToken row. Clicking **Reconnect Gmail** runs the Google OAuth flow, the user grants consent, but lands back on `/settings/account` with `Gmail not connected` — same as before the consent. The follow-up scan still returns `400 no_gmail_token`.

**What I shipped to diagnose:** `lib/auth.ts` now has:
- A `resolveUserId()` helper with three fallbacks (`user.id` → Account by `providerAccountId` → User by email).
- `console.warn` / `console.info` traces in both `events.signIn` and `events.linkAccount` so the next failure surfaces the exact short-circuit.

**What needs to happen next session:**
1. Ask the user to test the Reconnect Gmail flow on the live deploy (`65d4915`):
   - Disconnect Google on `/settings/account` (to start from clean state).
   - Click Reconnect Gmail. Complete the Google consent screen.
   - Land back on `/settings/account`. Note whether badge says "connected" or "not connected".
2. Pull Vercel runtime logs filtered to `auth.signIn` / `auth.linkAccount`:
   ```
   mcp__claude_ai_Vercel__get_runtime_logs
     projectId: prj_zFvbnnORfRVVayf5TBs2Lh1xZBDo
     teamId:    team_rwui4f7Nb7InhcNLs5v9BowM
     query:     "auth"
     since:     "30m"
   ```
3. Branch the next step on what the log shows:
   - **`persisting Gmail tokens` then a Prisma error** → fix the DB write path.
   - **`could not resolve userId`** → deeper issue with NextAuth event payload; consider abandoning server-action signIn entirely and switching `components/ReconnectGmailButton.tsx` to render a `<form action="/api/auth/signin/google" method="POST">` that goes through the standard NextAuth handler.
   - **`no access_token on account`** → Google's OAuth response is missing the token; check the provider config in `lib/auth.ts` and whether the disconnect flow is somehow disturbing the OAuth state.
   - **No `[auth.*]` lines at all** → events aren't firing on server-action signIn. Same fix as the "could not resolve userId" case: ditch the server action, use a form post to the standard NextAuth endpoint.

### Already-shipped backlog (all live on `65d4915`)

| Area | Status |
|---|---|
| Editorial redesign (Landing + /cv + /u/<slug>) | ✅ live |
| (app) route-group refactor | ✅ live |
| UI audit pass 1 (typography token sweep + favicons + copy) | ✅ live |
| UI audit pass 2 (a11y + visual nits + cv/verify palette + global-error) | ✅ live |
| Cloudflare throttle serialization | ✅ live |
| Abandoned IngestJob terminal status + backfill | ✅ live (migration applied via the GH Action prisma-resolve workflow) |
| Broad editorial coat — Dashboard / Settings / Onboarding / Admin / cv-verify / Privacy / Terms | ✅ live |
| Reconnect Gmail button (Settings + Dashboard banner) | ⚠️ UI present, but token-write side broken — see open issue above |

### Auth + token data model summary

- **NextAuth v5 beta, database session strategy** (`session: { strategy: 'database' }` in `lib/auth.ts`).
- Custom `GmailToken` table written by `persistTokensFromAccount` from `events.linkAccount` and `events.signIn` (see `lib/gmail/client.ts`).
- Disconnect (`POST /api/account/disconnect`) deletes both `GmailToken` row AND the `Account` row (`provider=google`). Leaves the `Session` row intact (user remains signed in).
- Reconnect server action: `lib/auth/reconnectGmail.ts` calls `signIn('google', { authorizationParams: { prompt: 'consent', access_type: 'offline' } })`.
- Provider already has `prompt: 'consent'` + `access_type: 'offline'` in its `authorization.params` at `lib/auth.ts:13-20`, plus `events.signIn` always tries to write tokens. So there's redundancy in the consent forcing; only one is needed.

---

## Open follow-ups (non-urgent)

1. **Two orphan migrations in production DB** (`20260428100000_person_disambiguation`, `20260512000000_multi_gmail_tokens`) exist in `_prisma_migrations` but not in the local repo. They're applied to prod but the code doesn't reference them. `prisma migrate status` exits 1 because of this drift but `prisma migrate deploy` is unaffected. Investigation: are these abandoned features with permanent schema state, or rolled-back migrations whose log rows should be removed?

2. **17 dead-Heroku failed ingests** — should now be marked `abandoned` post-backfill (the migration converted `failed` rows with `lastError LIKE '%HTTP 404%'` to `abandoned`). User can verify by visiting `/dashboard` — the "Failed" tile count should have dropped by ~17.

3. **6 Cloudflare-blocked ingests** — were 4 rate-limit-ish + 2 blanket-blocked. The Cloudflare throttle fix (`b21b244`) made the throttle serial per-host with 2500ms intervals. Once the user retries them via `/api/ingest/retry-failed`, the 4 rate-limit-ish cases should clear; the 2 blanket-blocked (`iitmpd`, `sbsdebate`) may still need manual recovery or self-hosted FlareSolverr on Oracle Always-Free.

4. **Open UI audit advisories from `2026-05-23-editorial-redesign-ui-review.md`** that weren't blocking-fixed:
   - `StatColumn` `mono` prop is dead code (cosmetic cleanup).
   - `HeaderMetric.accent` field is vestigial (cosmetic cleanup).
   - Dashboard `Failed` tile hint shows "X dead links" even when `counts.failed === 0` (minor UX inconsistency — when there are no actionable failures, the hint points to an empty filter).
   - `enqueueUrl` doesn't reset `abandoned → pending` (currently unreachable in UI; latent).

5. **Deploy pipeline structural improvement** (recommended in this session, not yet acted on): move `prisma migrate deploy` out of `npm run build` and into a separate step (separate GitHub Action gated on build success, OR a Neon webhook trigger). Today's incident — where `prisma migrate deploy` failed inside the build and blocked every subsequent deploy until manual `prisma migrate resolve --rolled-back` — recurs structurally with the current pipeline. Splitting them prevents the blocking pattern.

---

## Reference files & locations

- **Project source:** `C:\Users\achar\Documents\Github\debate_cv` (Windows, PowerShell, npm-only)
- **Repo:** `https://github.com/DrftingWood/debate_cv`
- **Vercel project:** `prj_zFvbnnORfRVVayf5TBs2Lh1xZBDo` (team `team_rwui4f7Nb7InhcNLs5v9BowM`)
- **Design contract:** `docs/superpowers/specs/2026-05-23-editorial-redesign-design.md`
- **Implementation plan:** `docs/superpowers/plans/2026-05-23-editorial-redesign.md`
- **UI audit report:** `docs/superpowers/specs/2026-05-23-editorial-redesign-ui-review.md`
- **Prisma resolve workflow:** `.github/workflows/prisma-resolve.yml` (run from GitHub Actions UI; secrets `POSTGRES_PRISMA_URL` + `POSTGRES_URL_NON_POOLING` already configured)
- **Failed migration recovery path:** Run the prisma-resolve workflow with `migration_name` input and `action` (defaults `rolled-back`); then trigger a Vercel redeploy (empty commit or UI button).

## User preferences (from memory)

- **Truly free** infrastructure only — no freemium/trial-tier services dressed up as free. ScraperAPI was rejected on these grounds; FlareSolverr on Oracle Always-Free is the durable alternative if Cloudflare bypass becomes recurring.
- Editorial design language already locked: cream paper `#FAF6EC`, ink `#181A1F`, oxblood accent `#7A2528`, Fraunces italic display, Plus Jakarta small-caps kickers, Inter body. Tokens in `tailwind.config.ts`, utilities in `app/globals.css`.
- On Windows / PowerShell; remote-control mobile is common; prefers tight decisive options over open discussion.

## Project guidance (from CLAUDE.md highlights)

- npm-only — do NOT re-introduce pnpm-lock.yaml.
- Don't retroactively TDD existing components/routes; new logic gets tests.
- Don't bump PARSER_VERSION casually.
- Print stylesheet in `app/globals.css` is preserved verbatim — don't touch.
- Comments explain WHY when non-obvious, not WHAT.
- 488 vitest tests baseline; new helpers add to the count.

---

## How to resume in the next session

Paste this to start:

> Resume from `docs/HANDOFF.md`. The Reconnect Gmail token write is broken — I shipped diagnostic logging on commit `65d4915`. Pull Vercel runtime logs for the last `auth.signIn` / `auth.linkAccount` traces (project `prj_zFvbnnORfRVVayf5TBs2Lh1xZBDo`, team `team_rwui4f7Nb7InhcNLs5v9BowM`, query `auth`, since `30m`) and tell me which short-circuit fired. Then propose a fix.

The first thing the next session should do is read this doc and the linked refs, then either: (a) ask the user to retest if logs are empty, or (b) read the captured traces and diagnose from there.
