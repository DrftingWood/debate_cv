import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'link';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap ' +
  'rounded-md transition-all duration-[180ms] ease-soft select-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

const variants: Record<Variant, string> = {
  primary:
    'bg-ink text-paper hover:bg-ink/90 active:bg-ink',
  // secondary is a deprecated alias of outline — keep identical so callers
  // don't need to change and the visual result is consistent.
  secondary:
    'bg-transparent text-ink border border-ink/15 hover:bg-ink/[0.04]',
  outline:
    'bg-transparent text-ink border border-ink/15 hover:bg-ink/[0.04]',
  ghost: 'bg-transparent text-ink hover:bg-ink/[0.04]',
  danger:
    'bg-destructive text-destructive-foreground hover:brightness-110',
  link:
    'text-oxblood hover:text-oxblood/80 underline-offset-4 hover:underline p-0 h-auto',
};

const sizes: Record<Size, string> = {
  sm: 'text-table h-9 px-3.5',
  md: 'text-ui h-11 px-4',
  lg: 'text-body h-12 px-5',
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = 'primary', size = 'md', loading, disabled, leftIcon, rightIcon, children, ...rest },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          base,
          variants[variant],
          variant === 'link' ? '' : sizes[size],
          className,
        )}
        {...rest}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : leftIcon ?? null}
        {children}
        {!loading && rightIcon ? rightIcon : null}
      </button>
    );
  },
);
Button.displayName = 'Button';
