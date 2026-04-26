'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

type ClearResponse = {
  mode?: 'standard' | 'full';
  cleared: Record<string, number>;
};

type ReingestResponse = {
  queued: number;
};

export function ClearDataButton() {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="secondary"
      loading={isPending}
      leftIcon={!isPending ? <Trash2 className="h-4 w-4" aria-hidden /> : undefined}
      onClick={() => {
        if (
          !window.confirm(
            'This permanently deletes all scraped tournament data and resets ingest state.\n\nUser identity claims (Person records) are preserved.\n\nContinue?',
          )
        )
          return;

        startTransition(async () => {
          const result = await postJson<ClearResponse>('/api/admin/clear-data');
          if (!result.ok) {
            toast.show({ kind: 'error', title: 'Clear failed', description: result.error });
            return;
          }
          const { cleared } = result.data;
          const summary = [
            cleared.tournaments && `${cleared.tournaments} tournaments`,
            cleared.tournamentParticipants && `${cleared.tournamentParticipants} participants`,
            cleared.ingestJobs && `${cleared.ingestJobs} jobs`,
          ]
            .filter(Boolean)
            .join(' · ');
          toast.show({
            kind: 'success',
            title: 'Data cleared',
            description: summary || 'Nothing to clear.',
          });
          router.refresh();
        });
      }}
    >
      Clear all data
    </Button>
  );
}

/**
 * "Full wipe" — also nukes DiscoveredUrl, PersonRejection, and Person rows
 * across the whole DB. Used to test the discovery + claim flow from zero.
 * The user account itself is preserved (Gmail token survives so the user
 * only needs to re-run the scan, not re-OAuth).
 *
 * Gate behind a typed-confirmation dialog because this trashes data for
 * EVERY user — losing claims they've manually made is irreversible without
 * a re-claim flow.
 */
export function FullWipeButton() {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="secondary"
      loading={isPending}
      leftIcon={!isPending ? <AlertTriangle className="h-4 w-4" aria-hidden /> : undefined}
      onClick={() => {
        const typed = window.prompt(
          'FULL WIPE — destructive across all users.\n\n' +
            'This deletes scraped data PLUS DiscoveredUrls, Person rows, and PersonRejections. ' +
            'User accounts and Gmail tokens are preserved, so users can re-scan.\n\n' +
            'Type FULL WIPE to confirm:',
        );
        if (typed?.trim() !== 'FULL WIPE') return;

        startTransition(async () => {
          const result = await postJson<ClearResponse>('/api/admin/clear-data?full=1');
          if (!result.ok) {
            toast.show({ kind: 'error', title: 'Full wipe failed', description: result.error });
            return;
          }
          const c = result.data.cleared;
          const summary = [
            c.tournaments && `${c.tournaments} tournaments`,
            c.discoveredUrls && `${c.discoveredUrls} URLs`,
            c.persons && `${c.persons} persons`,
          ]
            .filter(Boolean)
            .join(' · ');
          toast.show({
            kind: 'success',
            title: 'Full wipe complete',
            description: summary || 'Nothing to wipe.',
          });
          router.refresh();
        });
      }}
    >
      Full wipe (incl. claims & URLs)
    </Button>
  );
}

export function ReingestAllButton() {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="primary"
      loading={isPending}
      leftIcon={!isPending ? <RefreshCw className="h-4 w-4" aria-hidden /> : undefined}
      onClick={() => {
        startTransition(async () => {
          const result = await postJson<ReingestResponse>('/api/admin/reingest-all');
          if (!result.ok) {
            toast.show({ kind: 'error', title: 'Re-ingest failed', description: result.error });
            return;
          }
          toast.show({
            kind: 'success',
            title: 'Queued for re-ingest',
            description: `${result.data.queued} URLs queued — use "Ingest all" on the dashboard to process them.`,
          });
          router.refresh();
        });
      }}
    >
      Re-ingest all
    </Button>
  );
}
