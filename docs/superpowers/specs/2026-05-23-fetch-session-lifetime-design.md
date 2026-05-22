# `FetchSession` Lifetime for Cookie Jar + Throttle — Design Spec

**Date:** 2026-05-23
**Status:** Approved, ready for plan-writing
**Type:** Refactor (no behavior change, no schema, no PARSER_VERSION bump)
**Subsystem:** `lib/calicotab/fetch.ts` (+ new `fetchSession.ts`; minor ingest.ts wiring)

## Goal

Move the two module-level mutable Maps in `lib/calicotab/fetch.ts` (`cookieStore` at L28, `lastRequestByHost` at L16) into an explicit `FetchSession` class. Eliminate cross-tenant shared state by construction. Preserve the existing intra-ingest cookie reuse that makes Cloudflare-walled Tabbycat installs ingestable.

## Motivation

Today, two concurrent ingests for different users share the same module-level cookie jar in a single Node.js process. The user-visible impact is bounded (Tabbycat data is public; CF clearance cookies aren't authenticated credentials), but the shape — cross-tenant mutable state — is exactly what the original session diagnosis flagged as "wrong by default." It will become a real bug the first time a header is something authenticated.

The cookies are functionally necessary: Tabbycat installs behind Cloudflare set a `cf_clearance` cookie on the first request that passes the bot check, and subsequent tab fetches in the same ingest must replay that cookie or get re-challenged with a 403. So the fix isn't "delete the cookie jar" — it's "give the cookie jar an explicit lifetime tied to one ingest."

## In scope

1. **Create `lib/calicotab/fetchSession.ts`** exporting a `FetchSession` class. It owns two private Maps (cookie jars by host, last-request timestamps by host) and exposes four methods: `storeCookies(host, response)`, `getCookieHeader(host)`, `getLastRequestAt(host)`, `markRequestNow(host)`. Logic is the existing module-level functions, encapsulated verbatim as methods.

2. **Modify `lib/calicotab/fetch.ts`**:
   - Delete module-level `cookieStore`, `lastRequestByHost`, `storeCookies`, `getCookieHeader`.
   - Add `import { FetchSession } from './fetchSession'`.
   - Add optional `session?: FetchSession` to the options object of `fetchHtmlWithProvenance` and `fetchRoundWithProvenance`. Add optional positional `session?: FetchSession` to `probeFetch`.
   - When omitted: `const session = options.session ?? new FetchSession();` at the top of each public function. Single-shot mode for preflight/admin-debug.
   - Internal `throttledFetch` takes a required `session: FetchSession` parameter (no fallback at the internal layer).
   - Clean up `__test__` exports — drop `storeCookies`, `getCookieHeader`, `cookieStore` (verified unused by all tests). Keep `browserHeaders`, `DEFAULT_USER_AGENT`, `isCloudflareChallenge`.

3. **Modify `lib/calicotab/ingest.ts`**: near the top of `ingestPrivateUrl`, instantiate `const fetchSession = new FetchSession();`. Thread it through the three fetch call sites by adding `session: fetchSession` to their options:
   - L66 landing: `fetchHtmlWithProvenance(normalized, { session: fetchSession })`
   - L183 tab loop: `fetchHtmlWithProvenance(targetUrl, { referer: normalized, session: fetchSession })`
   - L197 round loop: `fetchRoundWithProvenance(targetUrl, { referer: normalized, session: fetchSession })`

## Explicitly out of scope

- **AsyncLocalStorage-based session passing.** Considered and rejected during brainstorming: introduces magic global-but-isolated context that hides plumbing footguns (escaped callbacks lose the context).
- **Per-host TTL eviction.** Considered and rejected: keeps cross-tenant state during the TTL window.
- **Throttle interval tuning.** The 750ms `MIN_INTERVAL_MS` constant is unchanged.
- **Preflight + admin-debug session sharing.** Each gets a fresh single-shot session implicitly — they don't share intra-call cookies because they don't do multi-step fetches.
- **No `PARSER_VERSION` bump.** No parsing changes; output shape identical.
- **No new dependencies.**

## File layout

| File | Change |
|---|---|
| `lib/calicotab/fetchSession.ts` | **+ NEW** ~50 LOC including JSDoc. The four methods encapsulate existing logic verbatim. |
| `lib/calicotab/fetch.ts` | Net ~−15 LOC. Module-level Maps + helper functions deleted; optional session param added to 3 public functions; throttledFetch takes session as required param. `__test__` export trims 3 entries. |
| `lib/calicotab/ingest.ts` | Net +4 LOC: one `new FetchSession()` plus three call sites get `session: fetchSession` added to their options. |
| `tests/fetch.headers.test.ts` | No change. Only uses `browserHeaders` and `DEFAULT_USER_AGENT` — both still exported. |
| `tests/fetch.retry.test.ts` | No change. Uses `vi.resetModules()` for isolation, doesn't touch the cookie machinery. |

## `FetchSession` API (canonical)

```typescript
// lib/calicotab/fetchSession.ts
/**
 * Per-ingest fetch state — cookie jar and per-host last-request timestamps.
 * Each ingestPrivateUrl call creates one and passes it to every fetch in
 * that ingest, so Cloudflare clearance cookies set on the landing page
 * replay on subsequent tab fetches while two concurrent users' ingests
 * cannot leak cookies into each other. Replaces the module-level Maps
 * that previously lived in fetch.ts.
 *
 * Preflight + admin-debug fetches don't share state across calls — they
 * each get a fresh single-shot session implicitly (created inside the
 * fetch.ts public functions when no session is supplied).
 */
export class FetchSession {
  private readonly cookieJars = new Map<string, Map<string, string>>();
  private readonly lastRequestAtByHost = new Map<string, number>();

  storeCookies(host: string, response: Response): void;
  getCookieHeader(host: string): string | undefined;
  getLastRequestAt(host: string): number;
  markRequestNow(host: string): void;
}
```

Method bodies are the existing `storeCookies` / `getCookieHeader` functions from `fetch.ts:30-49` plus trivial Map read/write for the throttle methods.

## Updated `fetch.ts` public signatures

```typescript
export async function fetchHtmlWithProvenance(
  url: string,
  options: { referer?: string; session?: FetchSession } = {},
): Promise<FetchResult>

export async function fetchRoundWithProvenance(
  url: string,
  options: { referer?: string; session?: FetchSession } = {},
): Promise<FetchResult>

export async function probeFetch(
  url: string,
  session?: FetchSession,
): Promise<{ status: number; ok: boolean; bodyPreview: string; elapsedMs: number; responseHeaders: Record<string, string> }>
```

Backwards-compatible: all existing callers continue to work without passing a session. Only `ingest.ts` opts into session-sharing.

## Behavior preservation

| Behavior | Before | After |
|---|---|---|
| CF clearance cookie persists across ~16 tab fetches in one ingest | Yes (via module-level cookieStore) | Yes (via one shared FetchSession passed through) |
| 750ms per-host throttle | Yes (module-level lastRequestByHost) | Yes (per-session lastRequestAtByHost; same threshold) |
| Two concurrent users' cookies isolated | **No** — shared module-level Map | **Yes** — separate FetchSession instances |
| Preflight gets fresh state | Inadvertently no (saw last user's cookies) | Yes — fresh session per call |
| Admin debug probe gets fresh state | Same problem | Yes — fresh session per call |

## Commit sequence

**Single commit:** `refactor: move fetch.ts module state into FetchSession class`. Atomic — one logical change. Commit message captures the cross-tenant smell + the cookies-still-persist-within-ingest invariant.

## Verification

- `npm test`: 466 tests pass (unchanged — neither affected test references the cookie machinery directly).
- `npm run lint`: 2 warnings, 0 errors (unchanged).
- `npm run typecheck`: clean.
- Manual: re-ingest a Cloudflare-walled Tabbycat URL in dev and confirm tabs still load (their CF clearance cookies are preserved across the session). The example URL from `scripts/test-scrape.mjs` (`ilnurr2026/privateurls/rbo1rd0g/`) is a reasonable check; the env-gated live smoke test from sub-project 4's epilogue also exercises this path.

## Risk

**Low.** Identical behavior at the use-case level. The only failure mode is "missed call site → that fetch creates a fresh session → CF clearance cookie not replayed → 403." All 5 call sites identified at brainstorm time (3 in ingest.ts, 1 in preflight, 1 in admin-debug). Single-shot callers (preflight, admin-debug) don't need cross-call cookies — they make one request and return. Only ingest.ts needs the shared session and the plan threads it through all three sites.

## Rollback

Single commit; `git revert <sha>` restores the module-level Maps and removes the param plumbing. No schema, no dependency, no migration to undo.

## Cross-references

- Previous sub-projects: 5 in `docs/superpowers/specs/`. This is sub-project 6.
- Original session diagnosis flagged this as a latent cross-tenant state leak with the specific note that "data is public, so it's not exfiltration — but cross-tenant state in a multi-user app is a smell."
- CLAUDE.md rules honored: no `PARSER_VERSION` bump, no schema change, no new dependencies, no introduction of state-management / ORM / test framework, no queue lock-order changes.
