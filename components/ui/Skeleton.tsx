import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export function Skeleton({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer rounded-md bg-gradient-to-r from-bg-muted via-bg-subtle to-bg-muted bg-[length:400px_100%]',
        className,
      )}
      {...rest}
    />
  );
}
