import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export function Skeleton({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer rounded-md bg-linear-to-r from-muted via-secondary to-muted bg-size-[400px_100%]',
        className,
      )}
      {...rest}
    />
  );
}
