# Debate CV — Full Technical + Product Breakdown and Rebuild Plan

This brief is written to be handed directly to Claude (or any coding agent) to upgrade the current project from a foundation-doc repo into a production-ready application.

---

## 1) Current State: What exists today

### 1.1 Repository contents

The current repository is a **foundation/spec repo**, not a full app codebase yet.

What is present:

- Gmail/OAuth implementation guidance with a sample Node snippet.
- Calicotab data model and ingestion workflow docs.
- Initial SQL schema.
- A lightweight Python parser that discovers private-page structure.
- One parser unit test with fixture HTML.

What is missing:

- No frontend app code (React/Next routes/components).
- No backend API implementation.
- No actual Gmail integration service code.
- No job queue / worker.
- No production auth/session code.
- No migration framework wiring.

### 1.2 Website behavior review (`https://debate-cv.vercel.app`)

Observed pages:

- Home page includes product messaging and lifecycle explanation:
  - Connect Gmail
  - Find Tabbycat links
  - Build CV
- `Dashboard` and `My CV` pages currently render minimal shell output in this environment.
- Privacy and Terms pages are present and informative.

Key UX signals from live site copy:

- Strong value proposition and onboarding narrative.
- Explicit mention of Google testing/unverified app state.
- Explicit admission of a token-encryption gap in privacy text.

---

## 2) Quality review of current docs and code

### 2.1 Strengths

- Correct high-level pipeline (Gmail discovery -> URL parse -> ingest -> CV).
- Reasonable initial schema entities for tournament/participant role modeling.
- Parser correctly discovers key navigation links from private URL page.
- Docs identify idempotency/caching concept and least-privilege OAuth scope.

### 2.2 Gaps / risks

#### A) Product/UX gaps

1. Dashboard/CV experience appears under-specified in code (no concrete implementation in repo).
2. Missing explicit ingest-state UX:
   - queued / running / failed / partial / complete
3. Missing conflict-resolution UX:
   - when parser cannot confidently map identity
4. Missing trust controls in product flow:
   - revoke/disconnect CTA
   - data delete self-serve flow

#### B) Logic / data gaps

1. Schema under-models debate rounds:
   - no debate-level table linking teams/sides/ranks per round
   - no explicit format-aware position stats (BP/AP differences)
2. No parser versioning in DB for reprocessing invalidation.
3. No source content hash / provenance rows per fetch.
4. Name matching is likely brittle (no canonical identity strategy beyond simple name storage).
5. No dedupe strategy for tournament aliases across URL variants beyond conceptual fingerprinting.
6. No idempotency keys at job/request level.

#### C) Security/compliance gaps

1. Refresh token encryption-at-rest not implemented.
2. No key-rotation plan for token encryption keys.
3. No retention policy automation (TTL purge jobs).
4. No audit trail table for sensitive actions (token refresh, deletion, export).

#### D) Engineering/process gaps

1. Minimal tests (single parser unit test only).
2. No integration tests with real-world HTML fixtures.
3. No API contract tests.
4. No observability baseline (structured logs/metrics/traces).

---

## 3) Target architecture (what should be changed)

## 3.1 App layers

1. **Web app (Next.js App Router)**
   - Landing, Dashboard, My CV, Settings, Privacy, Terms
2. **API layer**
   - OAuth callbacks
   - ingestion endpoints
   - CV read endpoints
3. **Workers**
   - Gmail scanner
   - URL fetcher/parser
   - normalization/upsert processor
4. **Postgres**
   - normalized tournament + participant + round model
5. **Queue**
   - Redis/Upstash/PG queue for ingest jobs

## 3.2 Data model upgrades (required)

Add tables:

- `ingest_jobs` (idempotency, status, attempts, error)
- `source_documents` (url, fetched_at, status, content_hash)
- `parser_runs` (parser_version, success/failure, diagnostics)
- `rounds` (round number, stage type, motion)
- `debates` (round_id, bracket info)
- `debate_teams` (debate_id, team, side/position, rank, points)
- `speaker_scores` (speaker, round, position, score, reply score)
- `adjudicator_results` (panel role, ranking where available)
- `user_claims` (user<->person mapping + confidence + manual overrides)

Add constraints:

- unique composite keys for deterministic upserts.
- check constraints for role/stage enums.

## 3.3 Parser upgrades (required)

Current parser is structure discovery only. Extend to full extractor modules:

- `private_page_parser.py`
- `team_tab_parser.py`
- `speaker_tab_parser.py`
- `results_parser.py` (team view + debate view)
- `break_parser.py` (team/adjudicator breaks)
- `participants_parser.py`

Each parser should return:

- structured payload
- parser confidence
- warnings
- parse metadata (selectors hit/missed)

## 3.4 UI upgrades (required)

### Dashboard

- Ingest CTA + status timeline:
  - Not connected
  - Connected, not scanned
  - Scanning
  - Parsing
  - Completed / Partial / Failed
- “Latest scan” card with counts:
  - messages scanned
  - private URLs found
  - tournaments parsed
  - failed URLs

### My CV

- Tournament cards with filters:
  - year, format, role (speaker/judge)
- Expandable per-round detail table.
- Confidence badge when identity match is inferred.
- Manual “I am this person” override UI.

### Settings / Privacy controls

- Disconnect Google.
- Delete all account data.
- Download my data JSON.
- Re-run scan with date range control.

---

## 4) Prioritized execution plan

### P0 (must-have before broader release)

1. Implement secure token vaulting (encryption-at-rest + rotation-ready).
2. Implement job queue + idempotent ingest pipeline.
3. Build robust parser modules with fixture regression tests.
4. Build Dashboard status UX + CV baseline rendering from DB.
5. Add account-level delete/disconnect flows.

### P1

1. Identity resolution and manual override workflow.
2. Full results normalization (prelim + out-round bracket path).
3. Observability: logs/metrics/error reporting.
4. Retry/failure policies with dead-letter handling.

### P2

1. Advanced CV analytics (best tournaments, trend lines).
2. Export formats (PDF, JSON, shareable private link).
3. Team collaboration / coach view (if product direction requires).

---

## 5) Engineering standards for the rebuild

- Type-safe API contracts (zod/openapi).
- Migration-managed schema (Drizzle/Prisma SQL migrations).
- Unit + integration + snapshot fixture tests.
- Backfill/reparse command (`parser_version` bump).
- Feature flags for risky parser changes.

---

## 6) Concrete first milestone (2-week scope)

Deliverables:

1. Next.js app skeleton with auth/session.
2. `POST /api/ingest-gmail` job enqueue endpoint.
3. Worker that:
   - discovers URLs from Gmail
   - fetches private pages
   - parses nav + registration
   - writes source docs + tournaments + participants
4. Dashboard progress UI wired to job status.
5. 20+ HTML fixture tests across tab variants.

Definition of done:

- A new user connects Gmail, runs scan, and sees at least one parsed tournament row with status and provenance.

---

## 7) Copy-paste prompt for Claude

Use the exact prompt below with Claude:

```text
You are implementing the next production-ready version of debate-cv.

Context:
- Read this file fully: docs/CLAUDE_REBUILD_BRIEF.md
- Existing repository currently contains mostly docs + schema + a basic parser in src/calicotab_parser.py.
- Goal is to convert it into a working app with robust ingestion, parsing, and CV rendering.

Your tasks:
1) Produce a concrete architecture + file tree proposal for a Next.js + Postgres + worker setup.
2) Create/modify code to implement the P0 milestone from the brief:
   - secure OAuth token storage design
   - ingest job queue + idempotent job processing
   - parser module split (private/team/speaker/results/break/participants)
   - dashboard status endpoint and UI state handling
3) Upgrade database schema/migrations to include ingest_jobs, source_documents, parser_runs, rounds, debates, debate_teams, speaker_scores, adjudicator_results, user_claims.
4) Add tests:
   - parser fixture tests
   - API contract tests
   - at least one end-to-end ingest flow test
5) Add a short README section for local run instructions.

Constraints:
- Keep data access user-scoped and privacy-preserving.
- Assume Gmail scope remains gmail.readonly only.
- Design for re-parsing when parser_version changes.
- Prefer deterministic upserts and explicit unique keys.

Output format:
- First: implementation plan.
- Then: code changes.
- Then: migration and test instructions.
- Then: risk list + follow-up tasks.
```
