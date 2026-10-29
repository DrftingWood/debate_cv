'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkle } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

type ClassifyResult = {
  classified: number;
  proposalsFiled: number;
  remaining: number;
  regionsFiled: number;
  regionsRemaining: number;
  motionCursor: string | null;
  tournamentCursor: string | null;
};

// A pass is one bounded batch (about 40 motions and 40 tournaments). This is a
// ceiling on the loop, not an expectation: a stuck backlog must not spin.
const MAX_PASSES = 80;

/**
 * Admin-only trigger for the Haiku tag classifier. One click works through the
 * WHOLE backlog — type and topic for every untagged motion, a region for every
 * tournament that has none — filing each answer as a pending proposal in the
 * review queue below. The admin then rejects the odd wrong row and approves
 * the rest in one click, instead of choosing every tag by hand.
 *
 * The cursors the server returns keep each pass moving forward, so an item the
 * model was unsure about is skipped rather than retried forever.
 */
export function AdminClassifyMotionsButton() {
  const router = useRouter();
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const run = async () => {
    setRunning(true);
    setProgress(0);
    let filed = 0;
    let motionAfter: string | undefined;
    let tournamentAfter: string | undefined;
    try {
      for (let pass = 0; pass < MAX_PASSES; pass += 1) {
        const res = await postJson<ClassifyResult>('/api/admin/tags/classify', {
          motionAfter,
          tournamentAfter,
        });
        if (!res.ok) {
          toast.show({
            kind: 'error',
            title: filed > 0 ? `Stopped after ${filed} suggestions` : 'Classifier failed',
            description:
              res.error === 'classifier_not_configured'
                ? 'ANTHROPIC_API_KEY is not set on this deployment.'
                : res.error,
          });
          return;
        }
        const d = res.data;
        filed += d.proposalsFiled + d.regionsFiled;
        setProgress(filed);
        motionAfter = d.motionCursor ?? motionAfter;
        tournamentAfter = d.tournamentCursor ?? tournamentAfter;
        if (d.remaining === 0 && d.regionsRemaining === 0) break;
      }
      toast.show({
        kind: 'success',
        title:
          filed === 0
            ? 'Nothing left to suggest'
            : `Filed ${filed} suggestion${filed === 1 ? '' : 's'}`,
        description:
          filed === 0
            ? 'Every motion and tournament already has a tag or a suggestion.'
            : 'Review the list below, reject any that look wrong, then approve the rest.',
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
      leftIcon={<Sparkle className="h-3.5 w-3.5" aria-hidden />}
      onClick={run}
    >
      {running ? `Suggesting… ${progress}` : 'Suggest all tags'}
    </Button>
  );
}
