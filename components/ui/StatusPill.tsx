import * as React from 'react';
import { CheckCircle2, Clock, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type Status = 'done' | 'pending' | 'running' | 'failed';

const styles: Record<Status, string> = {
  done: 'bg-[hsl(var(--success)/0.12)] text-success border-[hsl(var(--success)/0.22)]',
  pending: 'bg-[hsl(var(--warning)/0.12)] text-warning border-[hsl(var(--warning)/0.22)]',
  running: 'bg-primary-soft text-accent-foreground border-primary/20',
  failed: 'bg-[hsl(var(--destructive)/0.10)] text-destructive border-[hsl(var(--destructive)/0.22)]',
};

const icons: Record<Status, React.ComponentType<{ className?: string }>> = {
  done: CheckCircle2,
  pending: Clock,
  running: Loader2,
  failed: XCircle,
};

const labels: Record<Status, string> = {
  done: 'Done',
  pending: 'Pending',
  running: 'Running',
  failed: 'Failed',
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
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-caption font-medium',
        styles[status],
        className,
      )}
    >
      <Icon
        className={cn('h-3 w-3', status === 'running' && 'animate-spin')}
        aria-hidden
      />
      {label ?? labels[status]}
    </span>
  );
}
