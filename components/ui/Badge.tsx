import * as React from 'react';
import { cn } from '@/lib/utils/cn';

type Variant = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

const variants: Record<Variant, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  success: 'bg-[hsl(var(--success)/0.12)] text-success border-[hsl(var(--success)/0.22)]',
  warning: 'bg-[hsl(var(--warning)/0.12)] text-warning border-[hsl(var(--warning)/0.22)]',
  danger: 'bg-[hsl(var(--destructive)/0.10)] text-destructive border-[hsl(var(--destructive)/0.22)]',
  info: 'bg-primary-soft text-accent-foreground border-primary/20',
  outline: 'bg-transparent text-foreground border-border',
};

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: Variant;
};

export function Badge({ className, variant = 'neutral', ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-caption font-medium',
        variants[variant],
        className,
      )}
      {...rest}
    />
  );
}
