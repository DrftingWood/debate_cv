'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

type ClearResponse = {
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
