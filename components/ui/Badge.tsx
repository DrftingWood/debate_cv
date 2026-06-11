import * as React from 'react';
import { cn } from '@/lib/utils/cn';

type Variant = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'outline' | 'quiet';

const variants: Record<Variant, string> = {
  neutral: 'bg-ink/[0.06] text-ink-soft border-ink/15',
  success: 'bg-[hsl(var(--success)/0.12)] text-success border-[hsl(var(--success)/0.22)]',
  warning: 'bg-[hsl(var(--warning)/0.12)] text-warning border-[hsl(var(--warning)/0.22)]',
  danger: 'bg-[hsl(var(--destructive)/0.10)] text-destructive border-[hsl(var(--destructive)/0.22)]',
  info: 'bg-oxblood-soft text-oxblood border-oxblood/20',
  outline: 'bg-transparent text-ink border-ink/15',
  // Quiet: small-caps text label, no pill background. Used on /cv and
  // /u/<slug> where the record-row register would clash with bright pills.
  quiet: 'bg-transparent text-ink-soft border-transparent uppercase tracking-[0.16em] text-kicker font-semibold px-0 py-0',
};

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: Variant;
};

export function Badge({ className, variant = 'neutral', ...rest }: BadgeProps) {
  const isQuiet = variant === 'quiet';
  return (
    <span
      className={cn(
        isQuiet
          ? 'inline-flex items-center gap-1'
          : 'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-caption font-medium',
        variants[variant],
        className,
      )}
      {...rest}
    />
  );
}
