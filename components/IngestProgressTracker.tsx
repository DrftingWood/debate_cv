'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type ProgressScope = {
  pending: number;
  running: number;
  doneRecent: number;
  failedRecent: number;
  batchTotal: number;
  currentUrl: string | null;
  currentStartedAt: string | null;
  avgJobSeconds: number | null;
  etaSeconds: number | null;
};

type ProgressResponse = {
  user: ProgressScope;
  global: ProgressScope | null;
};

const ACTIVE_POLL_MS = 5_000;
// While idle we still check occasionally so the bar appears on its own
// when the 15-minute background drain (or another tab) starts working
// through the queue — without the user having to reload.
const IDLE_POLL_MS = 30_000;

function formatEta(seconds: number): string {
  if (seconds < 60) return `~${Math.max(Math.round(seconds / 5) * 5, 5)}s left`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `~${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  return `~${hours}h ${minutes % 60}m left`;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/privateurls\/.*/, '/…')}`;
  } catch {
    return url;
  }
}

/**
 * Live ingestion progress + ETA. `scope="user"` (dashboard) shows the
 * caller's own queue; `scope="global"` (/admin) shows everyone's. Both
 * poll the same COUNT-cheap endpoint — fast while jobs are moving, slow
 * heartbeat while idle — and render nothing when there's no recent
 * activity, so the page stays clean outside of ingest bursts.
 *
 * "Progress" is framed against the last hour's batch (see the endpoint
 * for why): finished-recently vs still-queued. The ETA self-calibrates
 * from the last 20 completed jobs, so a queue full of cache hits reads
 * seconds while a fresh-scrape backlog reads minutes.
 */
export function IngestProgressTracker({ scope }: { scope: 'user' | 'global' }) {
  const router = useRouter();
  const [data, setData] = useState<ProgressScope | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const wasActiveRef = useRef(false);
  const seenRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // One poll: fetch, publish, and return the delay before the next one.
  const poll = useCallback(async (): Promise<number> => {
    let next: ProgressScope | null = null;
    try {
      const res = await fetch('/api/ingest/progress', { cache: 'no-store' });
      if (res.ok) {
        const body = (await res.json()) as ProgressResponse;
        next = scope === 'global' ? body.global : body.user;
      }
    } catch {
      // Transient network failure — keep showing the last snapshot.
    }
    if (next) {
      setData(next);
      const active = next.pending + next.running > 0;
      // One refresh when the queue empties so the surrounding server
      // component (dashboard rows, CV banners) picks up the results
      // without the user reloading.
      if (wasActiveRef.current && !active) router.refresh();
      // Speak only when the queue starts or finishes. The first poll sets
      // the baseline silently: a page load is not news, and announcing the
      // counts on every 5-second poll talked over whatever the user was
      // doing (the whole section used to be aria-live).
      if (seenRef.current && active !== wasActiveRef.current) {
        setAnnouncement(progressAnnouncement(next, active));
      }
      seenRef.current = true;
      wasActiveRef.current = active;
    }
    return next && next.pending + next.running > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS;
  }, [router, scope]);

  useEffect(() => {
    let cancelled = false;
    async function loop() {
      const interval = await poll();
      if (!cancelled) timerRef.current = setTimeout(() => void loop(), interval);
    }
    void loop();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [poll]);

  // The status region renders on every path, including the empty one, so
  // it is in the page before its first message (a live region inserted
  // together with its text is often not read).
  const status = (
    <p role="status" className="sr-only">
      {announcement}
    </p>
  );

  if (!data || data.batchTotal === 0) return status;

  const active = data.pending + data.running;
  const completed = data.doneRecent + data.failedRecent;
  const fraction = data.batchTotal > 0 ? completed / data.batchTotal : 0;

  return (
    <>
      {status}
      <section
        aria-label="Ingestion progress"
        className="space-y-2 border-y border-border py-3"
        data-print-hide="true"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="kicker">
            {scope === 'global' ? 'INGESTION — ALL USERS' : 'INGESTION'}
            {active > 0 ? ' · LIVE' : ' · DONE'}
          </span>
          <span className="num text-caption text-ink-soft">
            {active > 0 && data.etaSeconds != null ? formatEta(data.etaSeconds) : 'queue empty'}
          </span>
        </div>

        <div
          role="progressbar"
          aria-label="Import progress"
          aria-valuetext={`${completed} of ${data.batchTotal} processed`}
          aria-valuemin={0}
          aria-valuemax={data.batchTotal}
          aria-valuenow={completed}
          className="h-1.5 overflow-hidden rounded-sm bg-ink/8"
        >
          <div
            className={
              'h-full rounded-sm transition-[width] duration-700 ease-soft ' +
              (active > 0 ? 'bg-primary' : 'bg-ink/60')
            }
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </div>

        <p className="text-caption text-ink-soft">
          <span className="num text-ink">{completed}</span> of{' '}
          <span className="num text-ink">{data.batchTotal}</span> processed
          {data.failedRecent > 0 ? <> ({data.failedRecent} failed)</> : null}
          {data.running > 0 && data.currentUrl ? (
            <>
              {' '}
              · now scraping{' '}
              <span className="font-mono text-byline">{shortUrl(data.currentUrl)}</span>
            </>
          ) : null}
          {data.running === 0 && data.pending > 0 ? (
            <>
              {' '}
              · {data.pending} queued — next background run starts within ~15 min, or use Ingest all
            </>
          ) : null}
        </p>
      </section>
    </>
  );
}

function progressAnnouncement(scope: ProgressScope, active: boolean): string {
  const completed = scope.doneRecent + scope.failedRecent;
  if (active) return `Importing: ${completed} of ${scope.batchTotal} processed.`;
  const failed = scope.failedRecent > 0 ? `, ${scope.failedRecent} failed` : '';
  return `Imports finished: ${completed} processed${failed}.`;
}
