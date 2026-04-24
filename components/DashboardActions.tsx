'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function ScanButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [summary, setSummary] = useState<{ found: number; scanned: number } | null>(null);
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
              const res = await fetch('/api/ingest/gmail', { method: 'POST' });
              if (!res.ok) throw new Error((await res.json()).error ?? `status ${res.status}`);
              const data = await res.json();
              setSummary({ found: data.found, scanned: data.scanned });
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Scan failed');
            }
          });
        }}
        className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-white font-medium hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? 'Scanning…' : 'Scan Gmail'}
      </button>
      {summary ? (
        <span className="text-xs text-gray-600">Found {summary.found} in {summary.scanned} messages</span>
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
