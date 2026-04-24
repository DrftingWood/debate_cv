'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

/**
 * Force a fresh ingest for a single tournament URL. Bypasses the 30-day
 * freshness cache (via `force: true`). Used on /cv/verify so the operator
 * can replay a tournament against the current parser without hunting for
 * the URL on the dashboard.
 */
export function ReingestButton({ url }: { url: string }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      loading={isPending}
      leftIcon={!isPending ? <RotateCw className="h-3.5 w-3.5" aria-hidden /> : undefined}
      onClick={() => {
        startTransition(async () => {
          const res = await postJson('/api/ingest/url', { url, force: true });
          if (!res.ok) {
            toast.show({ kind: 'error', title: 'Re-ingest failed', description: res.error });
            return;
          }
          toast.show({
            kind: 'success',
            title: 'Re-ingested',
            description: new URL(url).host,
          });
          router.refresh();
        });
      }}
    >
      Re-ingest
    </Button>
  );
}
