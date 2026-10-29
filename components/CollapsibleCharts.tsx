'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { CaretDown } from '@/components/ui/icons';
import { DetailsBody } from '@/components/ui/Deferred';

/**
 * The Record's career charts behind one toggle (owner, 2026-10-29: "make
 * the charts collapsible so the ledger is above the fold"). Closed by
 * default, so the ledger starts under the four tiles; the choice is
 * remembered in this browser, so someone who opens them keeps them open.
 *
 * A native <details>, so it works without JS and the print stylesheet opens
 * it; the charts are built on first open (DetailsBody), and always for print.
 */
const KEY = 'debate-cv:record-charts-open';

export function CollapsibleCharts({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    try {
      if (window.localStorage.getItem(KEY) === '1') details.open = true;
    } catch {
      // Storage blocked: start closed, as the server rendered.
    }
    const remember = () => {
      try {
        window.localStorage.setItem(KEY, details.open ? '1' : '0');
      } catch {
        // Storage blocked: nothing to remember.
      }
    };
    details.addEventListener('toggle', remember);
    return () => details.removeEventListener('toggle', remember);
  }, []);
  return (
    <details ref={ref} className="group/charts">
      <summary className="inline-flex cursor-pointer select-none items-center gap-inline py-hair text-ui font-medium text-primary coarse:min-h-[44px]">
        <span className="group-open/charts:hidden">Show career charts</span>
        <span className="hidden group-open/charts:inline">Hide career charts</span>
        <CaretDown
          className="h-3.5 w-3.5 transition-transform duration-180 group-open/charts:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <DetailsBody initiallyOpen={false}>
        <div className="pt-stack">{children}</div>
      </DetailsBody>
    </details>
  );
}
