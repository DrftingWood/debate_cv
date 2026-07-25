import * as React from 'react';
import { cn } from '@/lib/utils/cn';

type DivProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * The statement sheet. Hairline border, card background, no shadow by
 * default — depth in this system comes from the border and the canvas
 * behind it, not from elevation.
 */
export function Card({ className, ...rest }: DivProps) {
  return <div className={cn('panel', className)} {...rest} />;
}

export function CardHeader({ className, ...rest }: DivProps) {
  return <div className={cn('px-5 pt-4 pb-3', className)} {...rest} />;
}

export function CardBody({ className, ...rest }: DivProps) {
  return <div className={cn('px-5 pb-5', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: DivProps) {
  return (
    <div
      className={cn('rounded-b-card border-t bg-surface-2 px-5 py-3', className)}
      {...rest}
    />
  );
}

export function CardTitle({
  className,
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-h4 font-display font-medium tracking-tight text-ink', className)}
      {...rest}
    />
  );
}

export function CardDescription({
  className,
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-1 text-table text-ink-soft', className)} {...rest} />;
}

/**
 * Section header used above tables and chart blocks: a mono micro-label on
 * the left, optional right-hand meta (sample size, coverage note, action).
 * This is the statement's structural rhythm — every block of figures is
 * introduced the same way, so the eye learns where to find the caveat.
 */
export function SectionHeader({
  label,
  title,
  meta,
  className,
}: {
  label?: string;
  title?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-end justify-between gap-4 pb-2', className)}>
      <div className="min-w-0">
        {label ? <div className="data-label">{label}</div> : null}
        {title ? (
          <h2 className="mt-1 text-h4 font-display font-medium tracking-tight text-ink">
            {title}
          </h2>
        ) : null}
      </div>
      {meta ? <div className="shrink-0 text-caption text-ink-soft">{meta}</div> : null}
    </div>
  );
}
