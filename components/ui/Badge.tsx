import * as React from 'react';
import { cn } from '@/lib/utils/cn';

type Variant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const variants: Record<Variant, string> = {
  neutral: 'bg-bg-muted text-ink-3 border-border',
  success: 'bg-success-50 text-success-700 border-success-100',
  warning: 'bg-warning-50 text-warning-800 border-warning-100',
  danger: 'bg-danger-50 text-danger-700 border-danger-100',
  info: 'bg-primary-50 text-primary-700 border-primary-100',
};

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: Variant;
};

export function Badge({ className, variant = 'neutral', ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 border rounded-full px-2 py-0.5 text-xs font-medium',
        variants[variant],
        className,
      )}
      {...rest}
    />
  );
}
