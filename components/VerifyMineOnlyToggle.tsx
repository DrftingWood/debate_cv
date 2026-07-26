'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Users, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * Client control that flips a `mine` query-param on /cv/verify. The page is a
 * server component so the toggle just updates the URL and lets Next.js
 * re-render with the filtered data.
 */
export function VerifyMineOnlyToggle({ mine }: { mine: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const toggle = useCallback(() => {
    const next = new URLSearchParams(Array.from(params.entries()));
    // "Only me" is the default, so it is the ABSENCE of the param and
    // "everyone" is the explicit `mine=0`.
    if (mine) next.set('mine', '0');
    else next.delete('mine');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [mine, params, pathname, router]);

  /*
   * Labelled by what the click DOES, not by what is currently on screen.
   * The old label read "Everyone" while showing everyone, so it was equally
   * readable as a state badge or as an action — and the two readings imply
   * opposite outcomes from the same click.
   */
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-pressed={!mine}
      leftIcon={
        mine ? <Users className="h-4 w-4" aria-hidden /> : <UserCheck className="h-4 w-4" aria-hidden />
      }
      onClick={toggle}
    >
      {mine ? 'Show everyone' : 'Show only me'}
    </Button>
  );
}
