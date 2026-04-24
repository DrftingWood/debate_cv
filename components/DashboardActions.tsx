'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function ScanButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'ingesting'>('idle');
  const [summary, setSummary] = useState<{ found: number; scanned: number; processed?: number; remaining?: number } | null>(null);
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
                const drainRes = await fetch('/api/ingest/drain', { method: 'POST' });
                if (drainRes.ok) {
                  const drain = await drainRes.json();
                  setSummary((s) => s && { ...s, processed: drain.processed, remaining: drain.remaining });
                }
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
          {summary.remaining ? ` · ${summary.remaining} queued` : ''}
        </span>
      ) : null}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}

export function DrainButton() {
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
              const res = await fetch('/api/ingest/drain', { method: 'POST' });
              if (!res.ok) throw new Error((await res.json()).error ?? `status ${res.status}`);
              const data = await res.json();
              setSummary({ processed: data.processed, remaining: data.remaining });
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Drain failed');
            }
          });
        }}
        className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-ink hover:bg-gray-50 disabled:opacity-50"
      >
        {isPending ? 'Processing…' : 'Process queued'}
      </button>
      {summary ? (
        <span className="text-xs text-gray-600">
          Ingested {summary.processed}{summary.remaining ? ` · ${summary.remaining} left` : ''}
        </span>
      ) : null}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}

export function IngestButton({ url }: { url: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
                body: JSON.stringify({ url, force: true }),
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
        {isPending ? 'Ingesting…' : 'Ingest now'}
      </button>
      {error ? <span className="text-xs text-red-600 mt-1 max-w-xs truncate" title={error}>{error}</span> : null}
    </div>
  );
}
