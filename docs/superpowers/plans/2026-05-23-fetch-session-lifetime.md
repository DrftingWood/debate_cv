# FetchSession Lifetime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the two module-level Maps in `lib/calicotab/fetch.ts` (cookie jar + per-host throttle) into a `FetchSession` class instance threaded explicitly through `ingest.ts`'s ingestion pipeline. Eliminates cross-tenant shared state by construction; preserves intra-ingest cookie reuse.

**Architecture:** Single branch, single commit. New `lib/calicotab/fetchSession.ts` exports a 4-method class encapsulating the existing logic verbatim. `fetch.ts` gains an optional `session?: FetchSession` param on every public function (auto-creates one when omitted). `ingest.ts` instantiates one session per `ingestPrivateUrl` call and passes it to all 3 fetch sites. Tests are unaffected — neither test file references the cookie machinery.

**Tech Stack:** TypeScript 5.7 strict, Vitest 2 (Node env), npm canonical. Path alias `@/*` → repo root.

**Spec:** `docs/superpowers/specs/2026-05-23-fetch-session-lifetime-design.md`

---

## Pre-flight: branch setup & baseline

- [ ] **Step 1: Create the feature branch**

```bash
git checkout main
git status
git checkout -b refactor/fetch-session-lifetime
git status
```

Expected: clean working tree on `refactor/fetch-session-lifetime`, only `.claude/settings.local.json` untracked.

- [ ] **Step 2: Confirm baseline is green**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: **466 tests pass**, 45 files, 1 file skipped (the env-gated smoke).
- `npm run lint`: **2 warnings, 0 errors**.
- `npm run typecheck`: clean.

If anything fails on freshly-branched main, stop and flag.

---

## Task 1: FetchSession class + fetch.ts refactor + ingest.ts wiring

**Files:**
- Create: `lib/calicotab/fetchSession.ts`
- Modify: `lib/calicotab/fetch.ts` (delete module state, add session param, clean __test__ export)
- Modify: `lib/calicotab/ingest.ts` (import FetchSession, instantiate, thread through 3 call sites)

Single commit at the end.

- [ ] **Step 1: Create `lib/calicotab/fetchSession.ts`**

```typescript
/**
 * Per-ingest fetch state — cookie jar and per-host last-request timestamps.
 * Each ingestPrivateUrl call creates one FetchSession and passes it to every
 * fetch in that ingest, so Cloudflare clearance cookies set on the landing
 * page replay on subsequent tab fetches while two concurrent users' ingests
 * cannot leak cookies into each other. Replaces the module-level Maps that
 * previously lived in fetch.ts.
 *
 * Preflight + admin-debug fetches don't share state across calls — they
 * each get a fresh single-shot session implicitly (created inside the
 * fetch.ts public functions when no session is supplied).
 */
export class FetchSession {
  private readonly cookieJars = new Map<string, Map<string, string>>();
  private readonly lastRequestAtByHost = new Map<string, number>();

  /**
   * Capture Set-Cookie headers from a response into the per-host jar.
   * getSetCookie() is the multi-value variant available in Node 18+.
   */
  storeCookies(host: string, response: Response): void {
    const setCookies =
      (response.headers as Headers & { getSetCookie?(): string[] }).getSetCookie?.() ?? [];
    if (!setCookies.length) return;
    const jar = this.cookieJars.get(host) ?? new Map<string, string>();
    for (const raw of setCookies) {
      const pair = raw.split(';')[0] ?? '';
      const eqIdx = pair.indexOf('=');
      if (eqIdx < 1) continue;
      jar.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
    }
    this.cookieJars.set(host, jar);
  }

  /**
   * Build the Cookie header string for the next outbound request to `host`,
   * or undefined if no cookies have been captured for that host yet.
   */
  getCookieHeader(host: string): string | undefined {
    const jar = this.cookieJars.get(host);
    if (!jar?.size) return undefined;
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** Milliseconds-since-epoch of the last request we sent to `host`, or 0 if none. */
  getLastRequestAt(host: string): number {
    return this.lastRequestAtByHost.get(host) ?? 0;
  }

  /** Record that a request to `host` is being made now (for throttle accounting). */
  markRequestNow(host: string): void {
    this.lastRequestAtByHost.set(host, Date.now());
  }
}
```

- [ ] **Step 2: Modify `lib/calicotab/fetch.ts` — imports and delete module state**

At the top of `lib/calicotab/fetch.ts`, the current imports are:

```typescript
import { prisma } from '@/lib/db';
import { sha256Hex } from '@/lib/crypto';
```

Add a third import line:

```typescript
import { prisma } from '@/lib/db';
import { sha256Hex } from '@/lib/crypto';
import { FetchSession } from './fetchSession';
```

Then delete the four module-level pieces:

Delete `const lastRequestByHost = new Map<string, number>();` (currently line 16).

Delete the cookieStore block — the multi-line comment + the Map declaration at lines 23-28:

```typescript
// Per-host cookie jar. Module-level so clearance cookies (cf_clearance, etc.)
// persist across the multiple tab fetches that follow the landing page fetch
// within a single ingest session. Cloudflare sets these on the first request
// that passes its checks; without replaying them the subsequent tab requests
// get re-challenged and 403.
const cookieStore = new Map<string, Map<string, string>>();
```

Delete the `storeCookies` function at lines 30-43:

```typescript
function storeCookies(host: string, response: Response): void {
  // getSetCookie() is the multi-value variant available in Node 18+.
  const setCookies =
    (response.headers as Headers & { getSetCookie?(): string[] }).getSetCookie?.() ?? [];
  if (!setCookies.length) return;
  const jar = cookieStore.get(host) ?? new Map<string, string>();
  for (const raw of setCookies) {
    const pair = raw.split(';')[0] ?? '';
    const eqIdx = pair.indexOf('=');
    if (eqIdx < 1) continue;
    jar.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
  }
  cookieStore.set(host, jar);
}
```

Delete the `getCookieHeader` function at lines 45-49:

```typescript
function getCookieHeader(host: string): string | undefined {
  const jar = cookieStore.get(host);
  if (!jar?.size) return undefined;
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
```

The `MIN_INTERVAL_MS` constant and the rest of the file stay.

- [ ] **Step 3: Modify `throttledFetch` to take a required `session` parameter**

Find `throttledFetch` (currently around line 108 in the pre-edit file). Replace its full body. The current code is:

```typescript
async function throttledFetch(url: string, referer?: string): Promise<Response> {
  const host = new URL(url).host;
  const last = lastRequestByHost.get(host) ?? 0;
  const gap = Date.now() - last;
  if (gap < MIN_INTERVAL_MS) await wait(MIN_INTERVAL_MS - gap);
  lastRequestByHost.set(host, Date.now());

  const cookie = getCookieHeader(host);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(buildTargetUrl(url), {
      headers: {
        ...browserHeaders(referer),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    storeCookies(host, res);
    return res;
  } catch (err) {
    // AbortError surfaces as a generic "aborted" message in Node 18+. Re-raise
    // with a clearer error so fetchWarnings show "fetch: tab timeout (15s)"
    // instead of a cryptic generic abort string.
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`fetch timeout after ${FETCH_TIMEOUT_MS}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
```

Replace with:

```typescript
async function throttledFetch(url: string, session: FetchSession, referer?: string): Promise<Response> {
  const host = new URL(url).host;
  const last = session.getLastRequestAt(host);
  const gap = Date.now() - last;
  if (gap < MIN_INTERVAL_MS) await wait(MIN_INTERVAL_MS - gap);
  session.markRequestNow(host);

  const cookie = session.getCookieHeader(host);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(buildTargetUrl(url), {
      headers: {
        ...browserHeaders(referer),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    session.storeCookies(host, res);
    return res;
  } catch (err) {
    // AbortError surfaces as a generic "aborted" message in Node 18+. Re-raise
    // with a clearer error so fetchWarnings show "fetch: tab timeout (15s)"
    // instead of a cryptic generic abort string.
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`fetch timeout after ${FETCH_TIMEOUT_MS}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
```

Note: `session` is the new required second parameter (positional). `referer` shifts to third position.

- [ ] **Step 4: Modify `fetchWithRetry` to accept and forward the session**

Still in `lib/calicotab/fetch.ts`. The current `fetchWithRetry`:

```typescript
async function fetchWithRetry(url: string, referer?: string): Promise<Response> {
  const delays = [0, 1_000, 3_000];
  let lastRes: Response | null = null;
  for (const delay of delays) {
    if (delay > 0) await wait(delay);
    const res = await throttledFetch(url, referer);
    if (!RETRYABLE_STATUSES.has(res.status)) return res;
    lastRes = res;
  }
  return lastRes!;
}
```

Replace with:

```typescript
async function fetchWithRetry(url: string, session: FetchSession, referer?: string): Promise<Response> {
  const delays = [0, 1_000, 3_000];
  let lastRes: Response | null = null;
  for (const delay of delays) {
    if (delay > 0) await wait(delay);
    const res = await throttledFetch(url, session, referer);
    if (!RETRYABLE_STATUSES.has(res.status)) return res;
    lastRes = res;
  }
  return lastRes!;
}
```

- [ ] **Step 5: Modify `fetchHtmlWithProvenance` to accept the session in options**

Still in `lib/calicotab/fetch.ts`. The current signature is:

```typescript
export async function fetchHtmlWithProvenance(
  url: string,
  options: { referer?: string } = {},
): Promise<FetchResult> {
  const start = Date.now();
  let res: Response;
  try {
    res = await fetchWithRetry(url, options.referer);
  } catch (err) {
```

Replace the signature + first few lines with:

```typescript
export async function fetchHtmlWithProvenance(
  url: string,
  options: { referer?: string; session?: FetchSession } = {},
): Promise<FetchResult> {
  const start = Date.now();
  const session = options.session ?? new FetchSession();
  let res: Response;
  try {
    res = await fetchWithRetry(url, session, options.referer);
  } catch (err) {
```

The rest of the function body stays the same.

- [ ] **Step 6: Modify `fetchRoundWithProvenance` to thread the session**

Current code (around line 269):

```typescript
export async function fetchRoundWithProvenance(
  url: string,
  options: { referer?: string } = {},
): Promise<FetchResult> {
  const trimmed = url.replace(/\/+$/, '') + '/';
  const byDebateUrl = `${trimmed}by-debate/`;
  const byDebate = await fetchHtmlWithProvenance(byDebateUrl, options);
  // Accept the by-debate response only when it actually contains round data.
  // Tabbycat sometimes returns the generic Results overview page (200 OK) for
  // round URLs that don't exist yet — the HTML has no embedded table data.
  if (byDebate.ok && hasEmbeddedTableData(byDebate.html)) return byDebate;
  return fetchHtmlWithProvenance(trimmed, options);
}
```

Update the signature only — the body already forwards `options` which now carries `session` automatically:

```typescript
export async function fetchRoundWithProvenance(
  url: string,
  options: { referer?: string; session?: FetchSession } = {},
): Promise<FetchResult> {
  const trimmed = url.replace(/\/+$/, '') + '/';
  const byDebateUrl = `${trimmed}by-debate/`;
  const byDebate = await fetchHtmlWithProvenance(byDebateUrl, options);
  if (byDebate.ok && hasEmbeddedTableData(byDebate.html)) return byDebate;
  return fetchHtmlWithProvenance(trimmed, options);
}
```

(Keep the comment lines that were there — I trimmed the example for brevity. Only the type signature changes.)

- [ ] **Step 7: Modify `probeFetch` to take an optional session**

Current code:

```typescript
export async function probeFetch(url: string): Promise<{
  status: number;
  ok: boolean;
  bodyPreview: string;
  elapsedMs: number;
  responseHeaders: Record<string, string>;
}> {
  const start = Date.now();
  const res = await throttledFetch(url);
  const body = await res.text();
```

Replace with:

```typescript
export async function probeFetch(url: string, session?: FetchSession): Promise<{
  status: number;
  ok: boolean;
  bodyPreview: string;
  elapsedMs: number;
  responseHeaders: Record<string, string>;
}> {
  const start = Date.now();
  const probeSession = session ?? new FetchSession();
  const res = await throttledFetch(url, probeSession);
  const body = await res.text();
```

The rest of `probeFetch`'s body stays the same.

- [ ] **Step 8: Clean up the `__test__` export at the bottom of `fetch.ts`**

The current export:

```typescript
// Re-export for tests that assert on the outbound headers.
export const __test__ = {
  browserHeaders,
  DEFAULT_USER_AGENT,
  storeCookies,
  getCookieHeader,
  isCloudflareChallenge,
  cookieStore,
};
```

Replace with:

```typescript
// Re-export for tests that assert on the outbound headers.
export const __test__ = {
  browserHeaders,
  DEFAULT_USER_AGENT,
  isCloudflareChallenge,
};
```

`storeCookies`, `getCookieHeader`, and `cookieStore` no longer exist at module scope (they were deleted in Step 2) — this just removes the now-dangling references from the test export.

- [ ] **Step 9: Modify `lib/calicotab/ingest.ts` — import FetchSession**

At the top of `lib/calicotab/ingest.ts`, the current import for fetch is:

```typescript
import { fetchHtmlWithProvenance, fetchRoundWithProvenance } from './fetch';
```

Update to:

```typescript
import { fetchHtmlWithProvenance, fetchRoundWithProvenance } from './fetch';
import { FetchSession } from './fetchSession';
```

- [ ] **Step 10: Instantiate the session and thread it through 3 call sites in ingest.ts**

Find `ingestPrivateUrl` (around line 49 of ingest.ts). The current code around the landing fetch (line 65-66):

```typescript
  // Landing page fetch — with provenance so every parse has a stable source.
  const landingResult = await fetchHtmlWithProvenance(normalized);
```

Insert one line above the comment and update the call to pass the session:

```typescript
  // Per-ingest fetch session — bundles cookie jar + per-host throttle so
  // Cloudflare clearance cookies set on the landing page replay on the
  // subsequent tab fetches, without leaking state to other concurrent users.
  const fetchSession = new FetchSession();

  // Landing page fetch — with provenance so every parse has a stable source.
  const landingResult = await fetchHtmlWithProvenance(normalized, { session: fetchSession });
```

Then find the tab loop helper (around line 182):

```typescript
  const fetchTab = async (targetUrl: string, label: string): Promise<string | null> => {
    const r = await fetchHtmlWithProvenance(targetUrl, { referer: normalized });
```

Replace the call:

```typescript
  const fetchTab = async (targetUrl: string, label: string): Promise<string | null> => {
    const r = await fetchHtmlWithProvenance(targetUrl, { referer: normalized, session: fetchSession });
```

Then find the round loop helper (around line 196):

```typescript
  const fetchRound = async (
    targetUrl: string,
  ): Promise<{ url: string; html: string } | null> => {
    const r = await fetchRoundWithProvenance(targetUrl, { referer: normalized });
```

Replace the call:

```typescript
  const fetchRound = async (
    targetUrl: string,
  ): Promise<{ url: string; html: string } | null> => {
    const r = await fetchRoundWithProvenance(targetUrl, { referer: normalized, session: fetchSession });
```

- [ ] **Step 11: Sanity check via grep**

```bash
grep -n "cookieStore\|lastRequestByHost\|^function storeCookies\|^function getCookieHeader" lib/calicotab/fetch.ts
grep -n "fetchHtmlWithProvenance\|fetchRoundWithProvenance" lib/calicotab/ingest.ts
grep -n "session: fetchSession\|new FetchSession" lib/calicotab/ingest.ts
```

Expected:
- First grep: **zero matches** in fetch.ts (all module-level state and helpers deleted).
- Second grep: shows the 3 call sites in ingest.ts (lines 66, 183, 197 approximately).
- Third grep: shows 1 `new FetchSession()` and 3 `session: fetchSession` references.

If any of these don't match expectations, re-check the relevant Step.

- [ ] **Step 12: Run full test suite, lint, and typecheck**

```bash
npm test
npm run lint
npm run typecheck
```

Expected:
- `npm test`: **466 tests pass** (unchanged — the affected test files don't touch the cookie machinery).
- `npm run lint`: **2 warnings, 0 errors** (unchanged).
- `npm run typecheck`: clean.

If `npm run typecheck` complains about the deleted `cookieStore`/`storeCookies`/`getCookieHeader` symbols still being referenced from `__test__` (or anywhere), find and fix.

If `npm test` shows a regression in `tests/fetch.retry.test.ts`, the most likely cause is that `vi.resetModules()` no longer fully isolates state because the session is now class-based — that would be a behavior surprise, investigate.

- [ ] **Step 13: Commit**

```bash
git add lib/calicotab/fetchSession.ts lib/calicotab/fetch.ts lib/calicotab/ingest.ts
git commit -m "$(cat <<'EOF'
refactor: move fetch.ts module state into FetchSession class

Previously fetch.ts held a module-level cookieStore + lastRequestByHost
Map shared across all users in a Node.js process. On Vercel that's usually
one-instance-per-request, but cold instances can be reused; we should not
rely on isolation the platform doesn't guarantee. The cross-tenant cookie
sharing wasn't a live exploit (Tabbycat data is public) but is exactly the
"wrong by default" shape the session diagnosis flagged.

New FetchSession class encapsulates the cookie jar + per-host throttle as
instance state. fetch.ts public functions take an optional session param;
when omitted they create a fresh single-shot session (preflight, admin
debug). ingest.ts creates one FetchSession at the top of ingestPrivateUrl
and threads it through all 3 fetch sites, preserving the cookie-replay
behavior across the ~16 tab fetches in one ingest.

Behavior preserved:
- CF clearance cookie still persists across all fetches within one ingest.
- 750ms per-host throttle still applies (now per-session).
- Preflight + admin-debug still get fresh state per call (intentional —
  they don't need cross-call cookies).

Cross-tenant leakage closed by construction: two concurrent ingests for
different users each own their own FetchSession.

__test__ export trimmed: removed storeCookies, getCookieHeader, cookieStore
(all unused by any test, verified at brainstorm time). Kept browserHeaders,
DEFAULT_USER_AGENT, isCloudflareChallenge.

No PARSER_VERSION bump; no schema change; no new dependencies.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Post-flight: verification, finishing

- [ ] **Step 1: Confirm final state**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
npm test 2>&1 | tail -5
npm run lint 2>&1 | tail -3
npm run typecheck 2>&1 | tail -3
```

Expected:
- One commit on the branch.
- Three files in the diff: `lib/calicotab/fetchSession.ts` (new, ~55 LOC), `lib/calicotab/fetch.ts` (net ~−15 LOC), `lib/calicotab/ingest.ts` (net ~+5 LOC).
- 466 tests pass.
- Lint: 2 warnings, 0 errors.
- Typecheck: clean.

- [ ] **Step 2: Stop and ask the user about push / PR / merge**

Push and PR are user-visible / shared-state actions per the harness rules. Do not run `git push` or `gh pr create` without explicit user confirmation. Present the standard `superpowers:finishing-a-development-branch` options:

1. Merge to `main` locally (same pattern as the previous six sub-projects).
2. Push + open a PR.
3. Keep the branch as-is.
4. Discard.

---

## Self-review

**1. Spec coverage.** Walking through each section of the spec:

- ✅ "In scope" item 1 (create FetchSession class in fetchSession.ts): Step 1.
- ✅ "In scope" item 2a (delete module-level state in fetch.ts): Step 2.
- ✅ "In scope" item 2b (add session param to fetchHtmlWithProvenance): Step 5.
- ✅ "In scope" item 2c (add session param to fetchRoundWithProvenance): Step 6.
- ✅ "In scope" item 2d (add session param to probeFetch): Step 7.
- ✅ "In scope" item 2e (auto-create session when omitted): Steps 5, 7 (via `?? new FetchSession()`).
- ✅ "In scope" item 2f (throttledFetch takes required session): Step 3.
- ✅ "In scope" item 2g (clean up __test__ export): Step 8.
- ✅ "In scope" item 3 (ingest.ts instantiates + threads): Steps 9-10.
- ✅ Implied: fetchWithRetry needs to forward session: Step 4 (not enumerated in the spec but required for the chain to compile; added as own step).
- ✅ "Explicitly out of scope" — no AsyncLocalStorage, no TTL, no throttle tuning, no PARSER_VERSION bump, no new deps — none are touched by any step.
- ✅ Verification at every gate (Step 11 grep, Step 12 full suite, post-flight Step 1).

**2. Placeholder scan.** Searched the plan for TBD / TODO (as placeholder) / "fill in" / "add appropriate" / "similar to". No matches. Every code step has a complete verbatim code block.

**3. Type consistency.** Cross-checked names and signatures:

- `FetchSession` class — defined in Step 1, imported in Steps 2 and 9, instantiated in Steps 5/7/10.
- Method names — `storeCookies`, `getCookieHeader`, `getLastRequestAt`, `markRequestNow` — used consistently in Step 1 (definition) and Step 3 (consumption in throttledFetch).
- `session` parameter — added in Steps 3, 4, 5, 6, 7; consumed by name in throttledFetch and forwarded by name everywhere else.
- `options.session` access pattern — consistent across Steps 5, 6, 7.

No drift.
