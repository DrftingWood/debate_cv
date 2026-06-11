import * as React from 'react';
import { CheckCircle2, Clock, XCircle, Loader2, Ban, UserSearch } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type Status =
  | 'done'
  | 'pending'
  | 'running'
  | 'failed'
  | 'unavailable'
  | 'unmatched';

// Per-status colour tokens — used only for the icon and an optional
// underline. The label itself is small-caps ink, the same across all
// statuses, so the pill reads sober rather than traffic-light.
const tones: Record<Status, string> = {
  done: 'text-success',
  pending: 'text-warning',
  running: 'text-record-green',
  failed: 'text-destructive',
  unavailable: 'text-record-muted',
  unmatched: 'text-warning',
};

const icons: Record<Status, React.ComponentType<{ className?: string }>> = {
  done: CheckCircle2,
  pending: Clock,
  running: Loader2,
  failed: XCircle,
  unavailable: Ban,
  unmatched: UserSearch,
};

const labels: Record<Status, string> = {
  done: 'Done',
  pending: 'Pending',
  running: 'Running',
  failed: 'Failed',
  unavailable: 'Unavailable',
  unmatched: 'Unmatched',
};

export function StatusPill({
  status,
  className,
  label,
}: {
  status: Status;
  className?: string;
  label?: string;
}) {
  const Icon = icons[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 uppercase tracking-[0.14em] text-label font-semibold text-record-muted',
        className,
      )}
    >
      <Icon
        className={cn('h-3.5 w-3.5', tones[status], status === 'running' && 'animate-spin')}
        aria-hidden
      />
      {label ?? labels[status]}
    </span>
  );
}
