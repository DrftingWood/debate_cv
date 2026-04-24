import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export function Spinner({
  className,
  size = 'md',
  label,
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}) {
  const px = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-6 w-6' : 'h-5 w-5';
  return (
    <span
      className={cn('inline-flex items-center gap-2 text-muted-foreground', className)}
      role="status"
    >
      <Loader2 className={cn(px, 'animate-spin')} aria-hidden />
      {label ? <span className="text-[14px]">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}
