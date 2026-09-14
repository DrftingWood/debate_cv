'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

type ClassifyResult = {
  classified: number;
  proposalsFiled: number;
  remaining: number;
};

/**
 * Admin-only trigger for the Haiku motion classifier. Each click classifies
 * one bounded batch of untagged motions and files the suggestions as
 * pending proposals into the same review queue below — the toast reports
 * how many remain so the admin knows whether to click again.
 */
export function AdminClassifyMotionsButton() {
  const router = useRouter();
  const toast = useToast();
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const res = await postJson<ClassifyResult>('/api/admin/tags/classify', {});
      if (!res.ok) {
        toast.show({
          kind: 'error',
          title: 'Classifier failed',
          description:
            res.error === 'classifier_not_configured'
              ? 'ANTHROPIC_API_KEY is not set on this deployment.'
              : res.error,
        });
        return;
      }
      const { classified, proposalsFiled, remaining } = res.data;
      toast.show({
        kind: 'success',
        title:
          classified === 0
            ? 'Nothing to classify'
            : `Filed ${proposalsFiled} suggestion${proposalsFiled === 1 ? '' : 's'}`,
        description:
          remaining > 0
            ? `${remaining} untagged motion${remaining === 1 ? '' : 's'} left — run again for the next batch.`
            : 'All motions have suggestions or approved tags.',
      });
      router.refresh();
    } finally {
      setRunning(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      loading={running}
      leftIcon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}
      onClick={run}
    >
      Suggest motion tags (Haiku)
    </Button>
  );
}
