'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

async function drainUntilEmpty(
  onProgress: (summary: { processed: number; remaining: number }) => void,
): Promise<{ processed: number; remaining: number }> {
  let totalProcessed = 0;
  let remaining = 0;
  // Cap at 50 rounds to avoid runaway loops if the server is pathological.
  for (let i = 0; i < 50; i++) {
    const res = await fetch('/api/ingest/drain', { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).error ?? `status ${res.status}`);
    const data = (await res.json()) as { processed: number; remaining: number };
    totalProcessed += data.processed;
    remaining = data.remaining;
    onProgress({ processed: totalProcessed, remaining });
    if (data.processed === 0 || remaining === 0) break;
  }
  return { processed: totalProcessed, remaining };
}

export function ScanButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'ingesting'>('idle');
  const [summary, setSummary] = useState<
    { found: number; scanned: number; processed?: number; remaining?: number } | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          setSummary(null);
          startTransition(async () => {
            try {
              setPhase('scanning');
              const scanRes = await fetch('/api/ingest/gmail', { method: 'POST' });
              if (!scanRes.ok) throw new Error((await scanRes.json()).error ?? `status ${scanRes.status}`);
              const scan = await scanRes.json();
              setSummary({ found: scan.found, scanned: scan.scanned });
              router.refresh();

              if (scan.found > 0) {
                setPhase('ingesting');
                const drain = await drainUntilEmpty((progress) => {
                  setSummary((s) =>
                    s ? { ...s, processed: progress.processed, remaining: progress.remaining } : s,
                  );
                  router.refresh();
                });
                setSummary((s) =>
                  s ? { ...s, processed: drain.processed, remaining: drain.remaining } : s,
                );
                router.refresh();
              }
              setPhase('idle');
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Scan failed');
              setPhase('idle');
            }
          });
        }}
        className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-white font-medium hover:opacity-90 disabled:opacity-50"
      >
        {phase === 'scanning' ? 'Scanning Gmail…' : phase === 'ingesting' ? 'Ingesting URLs…' : 'Scan Gmail'}
      </button>
      {summary ? (
        <span className="text-xs text-gray-600">
          Found {summary.found} in {summary.scanned} messages
          {summary.processed != null ? ` · Ingested ${summary.processed}` : ''}
          {summary.remaining ? ` · ${summary.remaining} left` : ''}
        </span>
      ) : null}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}

export function IngestAllButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [summary, setSummary] = useState<{ processed: number; remaining: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          setSummary(null);
          startTransition(async () => {
            try {
              const drain = await drainUntilEmpty((progress) => {
                setSummary(progress);
                router.refresh();
              });
              setSummary(drain);
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Ingest failed');
            }
          });
        }}
        className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-ink hover:bg-gray-50 disabled:opacity-50"
      >
        {isPending ? (summary ? `Ingesting… (${summary.processed} done, ${summary.remaining} left)` : 'Ingesting…') : 'Ingest all'}
      </button>
      {!isPending && summary ? (
        <span className="text-xs text-gray-600">
          Ingested {summary.processed}{summary.remaining ? ` · ${summary.remaining} left` : ''}
        </span>
      ) : null}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}

export function IngestButton({ url, alreadyDone }: { url: string; alreadyDone: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const label = alreadyDone ? 'Re-ingest' : 'Ingest now';
  return (
    <div className="flex flex-col">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const res = await fetch('/api/ingest/url', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                // Force only when the user explicitly chose to re-ingest a done URL.
                body: JSON.stringify({ url, force: alreadyDone }),
              });
              if (!res.ok) throw new Error((await res.json()).error ?? `status ${res.status}`);
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Ingest failed');
            }
          });
        }}
        className="text-xs text-accent hover:underline disabled:opacity-50"
      >
        {isPending ? 'Ingesting…' : label}
      </button>
      {error ? <span className="text-xs text-red-600 mt-1 max-w-xs truncate" title={error}>{error}</span> : null}
    </div>
  );
}
