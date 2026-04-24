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
    'bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover hover:-translate-y-[1px] active:translate-y-0',
  secondary:
    'bg-card text-foreground border border-border shadow-xs hover:bg-muted hover:border-border',
  outline:
    'bg-transparent text-foreground border border-border hover:bg-muted',
  ghost: 'bg-transparent text-foreground hover:bg-muted',
  danger:
    'bg-destructive text-destructive-foreground shadow-sm hover:brightness-110',
  link:
    'text-primary hover:text-primary-hover underline-offset-4 hover:underline p-0 h-auto',
};

const sizes: Record<Size, string> = {
  sm: 'text-[13px] h-9 px-3.5',
  md: 'text-[14px] h-11 px-4',
  lg: 'text-[15px] h-12 px-5',
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
