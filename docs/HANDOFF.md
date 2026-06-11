# Session Handoff — debate_cv

**Date:** 2026-06-11 (supersedes the 2026-05-24 handoff; unresolved items from it are carried forward below)
**Last commit on `main`:** `b439ed1 feat(ingest): harden ingest-once invariant + free 15-min queue drain`
**Test baseline:** 604 vitest tests passing; typecheck/lint/`next build` clean.
**Production:** Vercel + Neon Postgres. Five migrations shipped this session (`20260611*`), all additive / `IF NOT EXISTS`-guarded, applied automatically at deploy via `migrate-if-configured.mjs`.

> Read `CLAUDE.md` first for conventions — this doc is status only.

---

## What shipped this session (2026-06-11, all on `main`)

| Area | What exists now | Key files |
|---|---|---|
| Analytics | `/cv/analytics`: speaker avg by year, round-by-round profile, break record, by-position, by-format, by-region, by-motion (type + topic), judging trend. Pure aggregation over `buildCvData` rows; coverage notes on thin samples; hand-rolled SVG charts (no chart lib). | `lib/cv/computeCvAnalytics.ts`, `components/ui/TrendChart.tsx`, `components/ui/BarList.tsx` |
| Configurable export | `GET /api/cv/export?format=csv\|xlsx&fields=...` driven by one field registry; "Export" picker popover on `/cv` with localStorage prefs; XLSX via exceljs (one sheet per role). Bare GET = legacy CSV. **Column order is append-only.** | `lib/cv/exportFields.ts`, `components/CvExportButton.tsx` |
| Parser expansion | Motions tab scraped (3 markup generations), per-round team positions persisted (`TeamResult.position` — was parsed-and-discarded before), gzipped raw HTML retained (`SourceDocument.bodyGzip`, 5MB raw cap) so future fields can re-derive from storage. `PARSER_VERSION = '20260611.0'`. | `lib/calicotab/parseMotions.ts`, `ingest.ts`, `fetch.ts`, `version.ts` |
| Moderated tags | Fixed vocabularies: REGIONS; MOTION_TYPES (stems THBT/THW/THS/THO/THR/THP/Other); MOTION_TOPICS (14 subject areas). Users propose at `/cv/tags` (only for tournaments on their CV), admins review at `/admin/tags`; **only approval writes canonical columns** (`Tournament.region`, `Motion.motionType/topic`). `TagProposal` = queue + audit trail; one live proposal per (user, kind, target). | `lib/tags/vocabulary.ts`, `app/api/tags/propose/`, `app/api/admin/tag-proposals/`, `components/TagProposalControls.tsx`, `components/AdminTagProposals.tsx` |
| Haiku classifier | `/admin/tags` → "Suggest motion tags (Haiku)" → `POST /api/admin/tags/classify`: claude-haiku-4-5 via `@anthropic-ai/sdk`, structured outputs constrained to the vocabulary, re-validated with zod; files PENDING proposals authored by the admin (approval gate intact). 40 motions/click, reports backlog. 503 without `ANTHROPIC_API_KEY` — feature is optional. | `lib/tags/classifyMotions.ts`, `app/api/admin/tags/classify/route.ts` |
| DB hygiene (audit-driven) | Dropped verified-dead columns (`TeamResult.losses`, `TournamentParticipant.wins`); `SpeakerRoundScore.positionLabel` NOT NULL DEFAULT `''` (was a NULL-in-unique-key hazard); JudgeAssignment round_results writer = atomic deduped replace (was findFirst+create TOCTOU); motion writes = id-preserving upserts (protects TagProposal audit rows); composite indexes `(userId, status)` on IngestJob + CvErrorReport; dropped redundant DiscoveredUrl `(userId)` index; `@updatedAt` on IngestJob/DiscoveredUrl. Kept deliberately (documented in schema comments): `DiscoveredUrl.subject/token/tournamentSlug` (in the account data export), `EliminationResult.result` dual history. | migrations `20260611150000`, `20260611160000`; `lib/queue.ts` |
| Legacy rank:N | Break-page rows no longer write `rank:N` into `EliminationResult.result` (verified unread); historical rows nulled; break upsert has empty `update` so it can't clobber won/lost. | `ingest.ts`, migration `20260611160000` |
| Retention | `pruneIngestArtifacts()` at end of cron drain, **gated to the 03:00 UTC hour**: 90-day retention; always keeps newest SourceDocument per URL (raw-HTML archive) and each doc's latest successful ParserRun (load-bearing for cache freshness + /cv/verify + admin parser health). | `lib/calicotab/provenance.ts`, `app/api/cron/process-queue/route.ts` |
| Ingest-once hardening | (a) `Tournament.parserVersion` — tournament-scoped cache check; fixed real bug where a 2nd user's first touch of a cached tournament always full-re-scraped (old check was per-landing-SourceDocument). (b) `candidateFingerprints()` probes year/null/year±1 when year was inferred from email date → year-boundary duplicates converge on one row; explicit-year names get exactly one candidate. (c) `Tournament.scrapeClaimedAt` claim (conditional UPDATE, 2-min TTL, 15s bounded wait) so concurrent cache-miss ingests don't both run the ~16-fetch tab phase. | `lib/calicotab/fingerprint.ts`, `ingest.ts`, migration `20260611170000` |
| UI/UX pass (2026-06-11, late) | Three-agent audit (inventory, nav/IA, visual consistency) then implemented with owner sign-off: CvSubNav tab bar (Record/Analytics/Tags/Verify) replacing the buried "More" dropdown + footnote-only Tags path; /cv actions 4→2 (Share + merged Download popover = print-to-PDF + column-picker export; CvExportButton→CvDownloadButton); Dashboard renamed "Imports" with calm summary default (URL table behind ?filter=, editorial table style, dupes removed, Export-errors→/admin, AutoScanOnVisit on /cv only); conditional Admin NavLink (isAdminEmail in lib/admin.ts); app-wide editorial-token migration (new text-ui 14px token, Button/Badge/StatusPill/popovers/settings/verify/onboarding/admin off raw px + shadcn family, secondary Button variant = deprecated alias of outline, admin pages aligned to max-w-5xl). | `components/CvSubNav.tsx`, `CvDownloadButton.tsx`, `app/(app)/dashboard/page.tsx`, `tailwind.config.ts` |
| Free 15-min drain | `.github/workflows/drain-queue.yml` curls `POST /api/cron/process-queue` every 15 min (GH Actions schedules are free; Vercel Hobby crons are daily-only). Needs **repository** secrets `APP_URL` + `CRON_SECRET`; no-ops green until set; concurrency-grouped. Vercel 03:00 cron = guaranteed backstop + owns the prune. | `.github/workflows/drain-queue.yml` |

### Ingestion dedup audit — verdict (2026-06-11)

The "ingest once, extract thereafter" invariant **holds** across all three entry paths (admin re-queue, user private URL / Gmail scan, name-only claiming — the last never scrapes). Cache hit = 1 landing fetch + ~6 DB ops, no tab fetches; full scrape only on >30-day staleness, parser-version change, round-count growth, or `force`. Residual known gaps (deliberate, low-frequency): duplicate Tournament rows possible if the same event is served from two hostnames or renamed mid-event on the tab site. Conclusions are encoded as code comments in `ingest.ts` and `fingerprint.ts`.

---

## Operator checklist (human steps — check off as completed)

- [ ] Verify Vercel deploy of `b439ed1` green; five `20260611*` migrations applied; smoke-check `/cv/analytics`, `/cv/tags`, `/admin/tags`, Export button on `/cv`.
- [ ] Add GitHub **repository** secrets `CRON_SECRET` + `APP_URL` (Settings → Secrets and variables → Actions → *Repository* secrets — NOT environment secrets; the workflow job has no `environment:` key and would skip silently). Verify: Actions → "Drain ingest queue" → Run workflow → step prints JSON. **Until this is done, the queue still only drains daily at 03:00 UTC.**
- [ ] (Optional) `ANTHROPIC_API_KEY` in Vercel env → enables the Haiku classifier button.
- [ ] `/admin` → **Re-ingest all** to backfill positions/motions under the new parser version. Dead Heroku tabs going `abandoned` is expected.
- [ ] After backfill: `/admin/tags` → run the Haiku classifier until backlog clear + approve; set regions at `/cv/tags` + approve. Region/motion analytics sections appear once approved tags exist.

## Next steps for the next agent (priority order)

1. **Auto-drain after scan** (discussed + accepted in spirit, NOT yet built): `components/AutoScanOnVisit.tsx` already knows when a scan found new URLs — chain it into the same `/api/ingest/drain` loop the dashboard's "Ingest all" button uses (see `DashboardActions`), so on-page users see tournaments appear live instead of waiting ≤15 min for the GH tick. Client-side only.
2. **Admin tournament-merge tool** for the residual duplicate cases (host change, mid-event rename — see audit verdict above).
3. **Region auto-suggestion**: parse the institutions page (`nav.institutions` is discovered but never fetched) → majority institution country → region, filed as a pre-filled TagProposal through the same moderation flow as the Haiku classifier.
4. **Speaker order within a round** (1st vs 2nd speaker): needs per-ballot pages — deliberately not scraped; build only on real user demand.
5. **Post-rollout watches**: Sentry `stage: 'prune'` + ingest errors; Neon storage growth from `bodyGzip` (knob: `RETENTION_DAYS` in `lib/calicotab/provenance.ts`).

## Landmines / invariants (read before touching)

- `PARSER_VERSION` bump = fleet-wide re-scrape. Bundle parser changes; never bump casually.
- Export field registry / CSV columns: **append-only** (positional consumers).
- Tag vocabularies: **append-mostly** — rename/removal needs a data migration for approved rows.
- The scrape claim is a conditional UPDATE on purpose — session-level advisory locks are unsafe on the pgbouncer-pooled connection. The tx-scoped `pg_advisory_xact_lock` in the write phase is fine. Don't merge the two.
- Prune must keep: newest SourceDocument per URL + latest successful ParserRun per doc.
- Queue lock ordering: rerun `tests/calicotab.deadlock.test.ts` after touching `lib/queue.ts` or the ingest tx.
- Raw SQL UPDATEs on IngestJob/DiscoveredUrl must set `"updatedAt" = NOW()` (Prisma `@updatedAt` fires only on client ops).

---

## Carried forward from the 2026-05-24 handoff (status unknown — verify before assuming)

1. **Reconnect Gmail token write** — was broken (OAuth consent completes but `GmailToken` row not written; diagnostic logging shipped in `lib/auth.ts` on `65d4915`). Not touched this session. If still broken: pull Vercel runtime logs for `auth.signIn` / `auth.linkAccount` traces and branch per the diagnosis table in the 2026-05-24 handoff (git history of this file).
2. **Two orphan migrations in prod** (`20260428100000_person_disambiguation`, `20260512000000_multi_gmail_tokens`) — in `_prisma_migrations` but not in the repo; `prisma migrate status` exits 1, `migrate deploy` unaffected.
3. **Cloudflare blanket-blocked ingests** (`iitmpd`, `sbsdebate`) — may need FlareSolverr on Oracle Always-Free if recurring (ScraperAPI rejected: must be truly free).
4. **Deploy pipeline improvement** — move `prisma migrate deploy` out of `npm run build` into a gated separate step (a failed migration inside build blocks all deploys until manual `prisma migrate resolve`). Recovery path exists: `.github/workflows/prisma-resolve.yml`.
5. Minor UI advisories from the editorial-redesign review (dead `mono`/`accent` props, Failed-tile hint when count is 0, `enqueueUrl` doesn't reset `abandoned → pending`).

## Reference locations

- Repo: `https://github.com/DrftingWood/debate_cv` (npm-only; owner often works from Windows/PowerShell or mobile)
- Vercel project: `prj_zFvbnnORfRVVayf5TBs2Lh1xZBDo` (team `team_rwui4f7Nb7InhcNLs5v9BowM`)
- Failed-migration recovery: run `.github/workflows/prisma-resolve.yml` with `migration_name` + `action`, then redeploy.

## User preferences

- **Truly free infrastructure only** — no freemium/trial tiers dressed up as free.
- Editorial design language is locked (cream paper, ink, oxblood accent, Fraunces italic display, kickers) — tokens in `tailwind.config.ts` / `app/globals.css`; print stylesheet preserved verbatim.
- Prefers tight, decisive options over open-ended discussion; uses sub-agents deliberately (Haiku for context reads, Sonnet for parsing tasks).

---

## How to resume in the next session

Paste this to start:

> Resume from `docs/HANDOFF.md` (2026-06-11). First confirm the operator checklist state with me (GitHub drain secrets? re-ingest-all run? tags seeded?), then pick up "Next steps for the next agent" — item 1 is the auto-drain-after-scan change in `components/AutoScanOnVisit.tsx`.
