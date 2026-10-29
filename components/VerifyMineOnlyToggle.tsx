'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { UserCheck, Users } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';

/**
 * Client control that flips the `mine` query-param on /cv/verify. The page is
 * a server component so the toggle just updates the URL and lets Next.js
 * re-render with the filtered data. The page shows only the user's rows by
 * default, so the param is `mine=0` for "everyone" and absent otherwise.
 *
 * A toggle button keeps one fixed label and states its on/off in
 * `aria-pressed`. It used to swap its text between "Only me" and "Everyone",
 * which left a screen-reader user unable to tell whether the label named
 * the current state or what the click would do.
 */
export function VerifyMineOnlyToggle({ mine }: { mine: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const toggle = useCallback(() => {
    const next = new URLSearchParams(Array.from(params.entries()));
    if (mine) next.set('mine', '0');
    else next.delete('mine');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [mine, params, pathname, router]);

  return (
    <Button
      type="button"
      variant={mine ? 'primary' : 'secondary'}
      size="sm"
      leftIcon={
        mine ? (
          <UserCheck className="h-4 w-4" aria-hidden />
        ) : (
          <Users className="h-4 w-4" aria-hidden />
        )
      }
      onClick={toggle}
      aria-pressed={mine}
    >
      Only me
    </Button>
  );
}
