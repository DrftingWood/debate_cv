import * as React from 'react';
import {
  CheckCircle,
  CircleNotch,
  Clock,
  Prohibit,
  UserFocus,
  WarningCircle,
  XCircle,
} from '@/components/ui/icons';
import { cn } from '@/lib/utils/cn';

// 'warning' is a finished result that needs a look (an accuracy check that
// warned), as against 'pending', which means work still to come.
export type Status =
  'done' | 'pending' | 'running' | 'failed' | 'unavailable' | 'unmatched' | 'warning';

// Per-status colour tokens — used only for the icon and an optional
// underline. The label itself is small-caps ink, the same across all
// statuses, so the pill reads sober rather than traffic-light.
const tones: Record<Status, string> = {
  done: 'text-success',
  pending: 'text-warning',
  running: 'text-primary',
  failed: 'text-destructive',
  unavailable: 'text-ink-soft',
  unmatched: 'text-warning',
  warning: 'text-warning',
};

const icons: Record<Status, React.ComponentType<{ className?: string }>> = {
  done: CheckCircle,
  pending: Clock,
  running: CircleNotch,
  failed: XCircle,
  unavailable: Prohibit,
  unmatched: UserFocus,
  warning: WarningCircle,
};

const labels: Record<Status, string> = {
  done: 'Done',
  pending: 'Pending',
  running: 'Running',
  failed: 'Failed',
  unavailable: 'Unavailable',
  unmatched: 'Unmatched',
  warning: 'Check',
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
        'inline-flex items-center gap-hair uppercase tracking-[0.08em] text-kicker font-semibold text-ink-soft',
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
