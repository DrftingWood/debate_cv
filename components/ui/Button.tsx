import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'link';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap ' +
  'rounded-md transition-colors duration-150 ease-soft select-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
  'disabled:cursor-not-allowed';

// Disabled treatment lives per-variant, not in `base`: a blanket
// `disabled:opacity-50` turned the filled primary into a muddy slab with an
// illegible label — and primary buttons sit disabled for MINUTES during the
// scan→ingest flow ("Scanning Gmail…"), so the busy state must stay
// readable. Filled variants soften their fill and keep full-opacity text;
// light variants can dim wholesale because dark text on a light surface
// degrades gracefully.
const variants: Record<Variant, string> = {
  // Emerald is the single accent: primary action, verified, "up". A filled
  // emerald button is the only saturated block of colour on most screens.
  // Disabled fills drop to a neutral surface with muted ink rather than a
  // washed-out accent. `bg-primary/60` kept white text over a 60%-opacity
  // emerald, which measured 2.91:1 — a label you have to squint at, which
  // reads as "broken" rather than "not available yet".
  primary:
    'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-hover disabled:bg-surface-3 disabled:text-ink-soft',
  // secondary is a deprecated alias of outline — kept identical so callers
  // don't need to change and the visual result stays consistent.
  secondary:
    'bg-surface text-ink border border-border hover:bg-surface-2 disabled:opacity-50',
  outline:
    'bg-surface text-ink border border-border hover:bg-surface-2 disabled:opacity-50',
  ghost: 'bg-transparent text-ink hover:bg-surface-2 disabled:opacity-50',
  danger:
    'bg-destructive text-destructive-foreground hover:brightness-110 disabled:bg-destructive/60',
  link:
    'text-primary hover:text-primary-hover underline-offset-4 hover:underline p-0 h-auto disabled:opacity-50',
};

// Denser than the previous scale — a statement UI packs controls tightly
// alongside tables rather than giving each one a generous landing pad.
const sizes: Record<Size, string> = {
  sm: 'text-table h-8 px-3',
  md: 'text-ui h-10 px-3.5',
  lg: 'text-body h-11 px-5',
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
