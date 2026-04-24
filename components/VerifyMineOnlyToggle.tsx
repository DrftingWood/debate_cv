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
    if (mine) next.delete('mine');
    else next.set('mine', '1');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [mine, params, pathname, router]);

  return (
    <Button
      type="button"
      variant={mine ? 'primary' : 'secondary'}
      size="sm"
      leftIcon={
        mine ? <UserCheck className="h-4 w-4" aria-hidden /> : <Users className="h-4 w-4" aria-hidden />
      }
      onClick={toggle}
    >
      {mine ? 'Only me' : 'Everyone'}
    </Button>
  );
}
