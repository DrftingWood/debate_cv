import * as React from 'react';
import { cn } from '@/lib/utils/cn';

type DivProps = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...rest }: DivProps) {
  return (
    <div
      className={cn('rounded-card border bg-card', className)}
      {...rest}
    />
  );
}

export function CardHeader({ className, ...rest }: DivProps) {
  return <div className={cn('px-5 pt-5 pb-3', className)} {...rest} />;
}

export function CardBody({ className, ...rest }: DivProps) {
  return <div className={cn('px-5 pb-5', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: DivProps) {
  return (
    <div
      className={cn(
        'px-5 py-3 border-t bg-ink/[0.03] rounded-b-card',
        className,
      )}
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
      className={cn('font-display text-h3 font-semibold text-ink', className)}
      {...rest}
    />
  );
}

export function CardDescription({
  className,
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('mt-0.5 text-table text-ink-soft', className)} {...rest} />
  );
}
