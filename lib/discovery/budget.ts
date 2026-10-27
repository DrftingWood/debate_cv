/**
 * A hard time budget and an error net around the Found loader.
 *
 * /cv/found once sat on the shared "Loading your record…" skeleton for more
 * than a minute with nothing in the browser console and nothing in the
 * Vercel log: the server render was still awaiting the loader, so the
 * streamed page never replaced its Suspense fallback. A page that may be
 * slow must say so instead. Past the budget the page renders a "taking too
 * long" state with a retry link, and an error (a missing table because a
 * migration has not run, a query failure) renders a plain message instead of
 * throwing. A raw-query failure on a missing relation arrives as P2010 with
 * "relation ... does not exist", which is matched on the message.
 *
 * `Promise.race` does not cancel the queries already sent; the AbortSignal
 * stops the loader at its next stage boundary so it sends no more.
 */

import type { FoundLoad } from '@/lib/discovery/loader';

export const FOUND_BUDGET_MS = 12_000;

export type FoundOutcome =
  | { status: 'ok'; load: FoundLoad }
  | { status: 'timeout'; budgetMs: number }
  /** `missing_table`: a migration has not run (Prisma P2021/P2022). */
  | { status: 'error'; kind: 'missing_table' | 'query'; detail: string };

type Loader = (userId: string, opts: { signal?: AbortSignal }) => Promise<FoundLoad>;

function errorKind(err: unknown): 'missing_table' | 'query' {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'P2021' || code === 'P2022') return 'missing_table';
  const message = err instanceof Error ? err.message : String(err);
  return /relation .* does not exist|table .* does not exist/i.test(message)
    ? 'missing_table'
    : 'query';
}

/** A short, log-safe description: the Prisma code and the first line. */
function describe(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  const message = (err instanceof Error ? err.message : String(err)).trim().split('\n').pop();
  return [typeof code === 'string' ? code : null, message?.slice(0, 300)]
    .filter(Boolean)
    .join(': ');
}

export async function loadFoundWithBudget(
  loader: Loader,
  userId: string,
  budgetMs: number = FOUND_BUDGET_MS,
): Promise<FoundOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      resolve('timeout');
    }, budgetMs);
  });
  const run = loader(userId, { signal: controller.signal }).then(
    (load) => ({ status: 'ok', load }) as const,
    (err: unknown) => ({ status: 'error', err }) as const,
  );
  try {
    const first = await Promise.race([run, timeout]);
    if (first === 'timeout') {
      controller.abort();
      console.warn(`[found] timeout ${JSON.stringify({ userId, budgetMs })}`);
      return { status: 'timeout', budgetMs };
    }
    if (first.status === 'ok') return first;
    const kind = errorKind(first.err);
    const detail = describe(first.err);
    console.error(`[found] load failed ${JSON.stringify({ userId, kind, detail })}`);
    return { status: 'error', kind, detail };
  } finally {
    clearTimeout(timer);
  }
}
