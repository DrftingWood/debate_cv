import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type BreakMarkerProps = {
  children: React.ReactNode;
  className?: string;
};

// Gold is earned, never decorative: the one moment of ceremony the system
// allows. Marks breaks, titles, and outround results wherever they appear.
export function BreakMarker({ children, className }: BreakMarkerProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-semibold text-break-gold', className)}>
      <span className="inline-block h-[7px] w-[7px] shrink-0 bg-break-gold" aria-hidden />
      {children}
    </span>
  );
}
