import * as React from 'react';
import { cn } from '@/lib/utils/cn';

// Static ruled placeholder — paper doesn't shimmer. The block reads as a
// pencilled-in row waiting for data, not a loading animation.
export function Skeleton({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('rounded-md bg-record-ink/[0.06]', className)}
      {...rest}
    />
  );
}
