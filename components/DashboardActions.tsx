'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Play, RotateCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

type DrainResponse = { processed: number; remaining: number };
type ScanResponse = { scanned: number; found: number };
type IngestUrlResponse = {
  tournamentId: string;
  fingerprint: string;
  cached: boolean;
  claimedPersonId: string | null;
  claimedPersonName: string | null;
  totalTeams: number | null;
  totalParticipants: number | null;
  warnings?: string[];
};

async function drainUntilEmpty(
  onProgress: (summary: { processed: number; remaining: number }) => void,
): Promise<{ processed: number; remaining: number }> {
  let totalProcessed = 0;
  let remaining = 0;
  for (let i = 0; i < 50; i++) {
    const result = await postJson<DrainResponse>('/api/ingest/drain');
    if (!result.ok) throw new Error(result.error);
    totalProcessed += result.data.processed ?? 0;
    remaining = result.data.remaining ?? 0;
    onProgress({ processed: totalProcessed, remaining });
    if ((result.data.processed ?? 0) === 0 || remaining === 0) break;
  }
  return { processed: totalProcessed, remaining };
}

function formatMetrics(totalTeams: number | null, totalParticipants: number | null): string {
  const parts: string[] = [];
  if (totalTeams != null && totalTeams > 0) parts.push(`${totalTeams} teams`);
  if (totalParticipants != null && totalParticipants > 0) parts.push(`${totalParticipants} participants`);
  return parts.join(' · ');
}

export function ScanButton() {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'ingesting'>('idle');

  return (
    <Button
      type="button"
      variant="primary"
      loading={isPending}
      leftIcon={!isPending ? <Search className="h-4 w-4" aria-hidden /> : undefined}
      onClick={() => {
        startTransition(async () => {
          try {
            setPhase('scanning');
            const scan = await postJson<ScanResponse>('/api/ingest/gmail');
            if (!scan.ok) throw new Error(scan.error);
            toast.show({
              kind: 'success',
              title: 'Gmail scan complete',
              description: `Found ${scan.data.found} private URLs in ${scan.data.scanned} messages.`,
            });
            router.refresh();

            if (scan.data.found > 0) {
              setPhase('ingesting');
              const drain = await drainUntilEmpty(() => router.refresh());
              toast.show({
                kind: 'success',
                title: 'Ingest complete',
                description: drain.remaining
                  ? `Ingested ${drain.processed}. ${drain.remaining} still queued — click "Ingest all" to continue.`
                  : `Ingested ${drain.processed} private URLs.`,
              });
              router.refresh();
            }
            setPhase('idle');
          } catch (e) {
            setPhase('idle');
            toast.show({
              kind: 'error',
              title: 'Scan failed',
              description: e instanceof Error ? e.message : 'Unknown error',
            });
          }
        });
      }}
    >
      {phase === 'scanning' ? 'Scanning Gmail…' : phase === 'ingesting' ? 'Ingesting URLs…' : 'Scan Gmail'}
    </Button>
  );
}

export function IngestAllButton({ pendingCount }: { pendingCount?: number }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [progress, setProgress] = useState<{ processed: number; remaining: number } | null>(null);

  return (
    <Button
      type="button"
      variant="secondary"
      loading={isPending}
      leftIcon={!isPending ? <Play className="h-4 w-4" aria-hidden /> : undefined}
      onClick={() => {
        setProgress(null);
        startTransition(async () => {
          try {
            const drain = await drainUntilEmpty((p) => {
              setProgress(p);
              router.refresh();
            });
            toast.show({
              kind: 'success',
              title: 'Done',
              description: drain.remaining
                ? `Ingested ${drain.processed} · ${drain.remaining} queued for later.`
                : `Ingested ${drain.processed} private URLs.`,
            });
            router.refresh();
          } catch (e) {
            toast.show({
              kind: 'error',
              title: 'Ingest failed',
              description: e instanceof Error ? e.message : 'Unknown error',
            });
          }
        });
      }}
    >
      {isPending && progress
        ? `Ingesting… ${progress.processed}/${progress.processed + progress.remaining}`
        : pendingCount
          ? `Ingest all (${pendingCount})`
          : 'Ingest all'}
    </Button>
  );
}

export function IngestButton({ url, alreadyDone }: { url: string; alreadyDone: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const label = alreadyDone ? 'Re-ingest' : 'Ingest';

  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      loading={isPending}
      leftIcon={!isPending && alreadyDone ? <RotateCw className="h-3.5 w-3.5" aria-hidden /> : undefined}
      onClick={() => {
        startTransition(async () => {
          const result = await postJson<IngestUrlResponse>('/api/ingest/url', { url, force: alreadyDone });
          if (!result.ok) {
            toast.show({
              kind: 'error',
              title: `${label} failed`,
              description: result.error,
            });
            return;
          }
          const metrics = formatMetrics(result.data.totalTeams, result.data.totalParticipants);
          const host = new URL(url).host;
          toast.show({
            kind: 'success',
            title: `${label}ed`,
            description: metrics
              ? `${host} · ${metrics}${result.data.cached ? ' (cached)' : ''}`
              : result.data.cached
                ? `${host} (cached)`
                : host,
          });
          // Show a dedicated toast when the ingest auto-identified the user,
          // with a direct link to their CV so achievements are immediately visible.
          if (result.data.claimedPersonId) {
            toast.show({
              kind: 'success',
              title: 'Auto-identified',
              description: result.data.claimedPersonName
                ? `Matched as ${result.data.claimedPersonName}`
                : 'Your identity was confirmed from the private URL.',
              action: { label: 'View your CV', href: '/cv' },
            });
          }
          const warnings = result.data.warnings ?? [];
          if (warnings.length > 0) {
            toast.show({
              kind: 'error',
              title: '⚠ Scrape warnings',
              description: warnings.slice(0, 3).join('\n'),
            });
          }
          router.refresh();
        });
      }}
    >
      {label}
    </Button>
  );
}

export function ClearButton({ url }: { url: string }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      loading={isPending}
      leftIcon={!isPending ? <Trash2 className="h-3.5 w-3.5" aria-hidden /> : undefined}
      onClick={() => {
        startTransition(async () => {
          const result = await postJson('/api/ingest/clear', { url });
          if (!result.ok) {
            toast.show({
              kind: 'error',
              title: 'Clear failed',
              description: result.error,
            });
            return;
          }
          toast.show({
            kind: 'success',
            title: 'Cleared',
            description: 'Ingestion reset — click Ingest to retry.',
          });
          router.refresh();
        });
      }}
    >
      Clear
    </Button>
  );
}
