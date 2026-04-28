'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

type RetryResponse = { retried: number; skipped: number };

/**
 * Chip-level bulk action for the dashboard's `Failed` filter. Resets every
 * failed IngestJob back to pending in one trip via
 * /api/ingest/retry-failed, then refreshes the page so the user sees the
 * status updates. Permanently-dead URLs (HTTP 404 sources) are skipped on
 * the server side.
 */
export function RetryFailedButton({ count }: { count: number }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      loading={isPending}
      leftIcon={!isPending ? <RefreshCw className="h-3.5 w-3.5" aria-hidden /> : undefined}
      onClick={() => {
        startTransition(async () => {
          const res = await postJson<RetryResponse>('/api/ingest/retry-failed');
          if (!res.ok) {
            toast.show({ kind: 'error', title: 'Retry failed', description: res.error });
            return;
          }
          const { retried, skipped } = res.data;
          toast.show({
            kind: 'success',
            title:
              retried > 0
                ? `Retrying ${retried} ${retried === 1 ? 'URL' : 'URLs'}`
                : 'Nothing to retry',
            description:
              skipped > 0
                ? `${skipped} permanently-dead URLs skipped (use Clear).`
                : 'Click Ingest all once these are queued.',
          });
          router.refresh();
        });
      }}
    >
      Retry all {count}
    </Button>
  );
}
