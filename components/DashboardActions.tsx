'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Play, RotateCw, Trash2, RefreshCw, Download, Lock, Unlock } from 'lucide-react';
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
  linkedTournamentsCount: number;
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
          // Surface where the ingest landed — every URL auto-claims the
          // registered participant, so we always know how many tournaments
          // are visible on the user's CV.
          if (result.data.claimedPersonId) {
            const n = result.data.linkedTournamentsCount;
            toast.show({
              kind: 'success',
              title: 'Linked to your CV',
              description:
                n > 0
                  ? `${n} ${n === 1 ? 'tournament' : 'tournaments'} now visible`
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

type ReingestMineResponse = { queued: number; skipped: number; skippedLocked: number };

function reingestDescription({
  queued,
  skipped,
  skippedLocked,
  selected,
}: ReingestMineResponse & { selected?: boolean }): string {
  const notes = [
    skipped > 0 ? `${skipped} unavailable` : null,
    skippedLocked > 0 ? `${skippedLocked} locked` : null,
  ].filter(Boolean);
  const note = notes.length > 0 ? ` (${notes.join(', ')} skipped)` : '';
  if (queued > 0) {
    return `${queued} ${queued === 1 ? 'URL' : 'URLs'} queued - use "Ingest all" to process them.${note}`;
  }
  if (notes.length > 0) return `Nothing queued${selected ? ' from that selection' : ''} - ${notes.join(', ')} skipped.`;
  return selected ? 'Choose at least one unlocked URL first.' : 'Nothing to re-ingest yet.';
}

function selectedReingestUrls(): string[] {
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[data-reingest-url]:checked'))
    .map((input) => input.value)
    .filter(Boolean);
}

export function ReingestMineButton() {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      loading={isPending}
      leftIcon={!isPending ? <RefreshCw className="h-4 w-4" aria-hidden /> : undefined}
      onClick={() => {
        startTransition(async () => {
          const result = await postJson<ReingestMineResponse>('/api/ingest/reingest-mine');
          if (!result.ok) {
            toast.show({ kind: 'error', title: 'Re-ingest failed', description: result.error });
            return;
          }
          const { queued: n, skipped } = result.data;
          const skipNote =
            skipped > 0 ? ` (${skipped} skipped — source page no longer exists)` : '';
          toast.show({
            kind: 'success',
            title: 'Queued for re-ingest',
            description:
              n > 0
                ? `${n} ${n === 1 ? 'URL' : 'URLs'} queued — use "Ingest all" to process them.${skipNote}`
                : skipped > 0
                  ? `Nothing to re-ingest — all ${skipped} URLs are permanently unavailable.`
                  : 'Nothing to re-ingest yet.',
          });
          if (result.data.skippedLocked > 0) {
            toast.show({
              kind: 'success',
              title: 'Locked tournaments skipped',
              description: `${result.data.skippedLocked} locked ${result.data.skippedLocked === 1 ? 'URL was' : 'URLs were'} left untouched.`,
            });
          }
          router.refresh();
        });
      }}
    >
      Re-ingest mine
    </Button>
  );
}

export function ReingestSelectedButton() {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [selectedCount, setSelectedCount] = useState(0);

  useEffect(() => {
    const update = () => setSelectedCount(selectedReingestUrls().length);
    update();
    document.addEventListener('change', update);
    return () => document.removeEventListener('change', update);
  }, []);

  return (
    <Button
      type="button"
      variant="outline"
      loading={isPending}
      disabled={selectedCount === 0}
      leftIcon={!isPending ? <RefreshCw className="h-4 w-4" aria-hidden /> : undefined}
      onClick={() => {
        const urls = selectedReingestUrls();
        if (urls.length === 0) {
          toast.show({
            kind: 'error',
            title: 'Nothing selected',
            description: 'Select one or more unlocked tournament URLs first.',
          });
          return;
        }

        startTransition(async () => {
          const result = await postJson<ReingestMineResponse>('/api/ingest/reingest-mine', { urls });
          if (!result.ok) {
            toast.show({ kind: 'error', title: 'Re-ingest failed', description: result.error });
            return;
          }
          for (const input of document.querySelectorAll<HTMLInputElement>('input[data-reingest-url]:checked')) {
            input.checked = false;
          }
          setSelectedCount(0);
          toast.show({
            kind: 'success',
            title: 'Queued for re-ingest',
            description: reingestDescription({ ...result.data, selected: true }),
          });
          router.refresh();
        });
      }}
    >
      {selectedCount > 0 ? `Re-ingest selected (${selectedCount})` : 'Re-ingest selected'}
    </Button>
  );
}

export function LockUrlButton({ url, locked }: { url: string; locked: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const nextLocked = !locked;

  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      loading={isPending}
      leftIcon={!isPending ? (
        locked ? <Unlock className="h-3.5 w-3.5" aria-hidden /> : <Lock className="h-3.5 w-3.5" aria-hidden />
      ) : undefined}
      onClick={() => {
        startTransition(async () => {
          const result = await postJson<{ locked: boolean; updated: number }>('/api/ingest/lock', {
            url,
            locked: nextLocked,
          });
          if (!result.ok) {
            toast.show({ kind: 'error', title: 'Lock update failed', description: result.error });
            return;
          }
          toast.show({
            kind: 'success',
            title: nextLocked ? 'Tournament locked' : 'Tournament unlocked',
            description: nextLocked
              ? 'Bulk re-ingest will skip this URL. Manual re-ingest still works.'
              : 'Bulk re-ingest can queue this URL again.',
          });
          router.refresh();
        });
      }}
    >
      {locked ? 'Unlock' : 'Lock'}
    </Button>
  );
}

export function ExportErrorsButton() {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      loading={isPending}
      leftIcon={!isPending ? <Download className="h-4 w-4" aria-hidden /> : undefined}
      onClick={() => {
        startTransition(async () => {
          try {
            const res = await fetch('/api/ingest/errors-export');
            if (!res.ok) {
              const body = await res.json().catch(() => ({ error: 'export_failed' }));
              throw new Error(body.error ?? `HTTP ${res.status}`);
            }
            // Force download via blob URL — keeps the auth cookie that
            // window.location navigation would also send, but doesn't navigate
            // the user away from the dashboard.
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const date = new Date().toISOString().slice(0, 10);
            a.download = `ingest-errors-${date}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast.show({ kind: 'success', title: 'Errors exported' });
          } catch (e) {
            toast.show({
              kind: 'error',
              title: 'Export failed',
              description: e instanceof Error ? e.message : 'Unknown error',
            });
          }
        });
      }}
    >
      Export errors
    </Button>
  );
}
