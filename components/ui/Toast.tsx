'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle, Info, WarningCircle, X } from '@/components/ui/icons';
import { cn } from '@/lib/utils/cn';

type ToastKind = 'success' | 'error' | 'info';

type ToastItem = {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  /** Optional link rendered below the description. */
  action?: { label: string; href: string };
};

type ToastContextValue = {
  toasts: ToastItem[];
  show: (t: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: string) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const AUTO_DISMISS_MS = 5000;

/**
 * How long a toast stays up on its own, or null for "until dismissed".
 *
 * Only passive success and information may time out (UX-20). Everything
 * used to vanish at 5 s, which is a time limit nobody could extend
 * (SC 2.2.1): a "Scan failed" read by a screen reader half a sentence in,
 * or a "View your CV" action link gone before a keyboard user could Tab to
 * it. An error is something the user has to act on, and a toast with an
 * action exists to be acted on, so both stay until the × is pressed.
 */
export function autoDismissMs(t: Pick<ToastItem, 'kind' | 'action'>): number | null {
  if (t.kind === 'error' || t.action) return null;
  return AUTO_DISMISS_MS;
}

type Timer = { handle: ReturnType<typeof setTimeout> | null; remaining: number; startedAt: number };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const timers = React.useRef<Map<string, Timer>>(new Map());

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t?.handle) clearTimeout(t.handle);
    timers.current.delete(id);
  }, []);

  const start = React.useCallback(
    (id: string, ms: number) => {
      timers.current.set(id, {
        handle: setTimeout(() => dismiss(id), ms),
        remaining: ms,
        startedAt: Date.now(),
      });
    },
    [dismiss],
  );

  // Hover or focus inside a toast holds its timer; leaving resumes it with
  // whatever time was left, so reading the message never costs the user it.
  const pause = React.useCallback((id: string) => {
    const t = timers.current.get(id);
    if (!t?.handle) return;
    clearTimeout(t.handle);
    t.handle = null;
    t.remaining = Math.max(0, t.remaining - (Date.now() - t.startedAt));
  }, []);

  const resume = React.useCallback(
    (id: string) => {
      const t = timers.current.get(id);
      if (!t || t.handle) return;
      start(id, t.remaining);
    },
    [start],
  );

  const show = React.useCallback<ToastContextValue['show']>(
    (t) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev, { id, ...t }]);
      const ms = autoDismissMs(t);
      if (ms != null) start(id, ms);
    },
    [start],
  );

  React.useEffect(() => {
    const current = timers.current;
    return () => {
      current.forEach((t) => {
        if (t.handle) clearTimeout(t.handle);
      });
      current.clear();
    };
  }, []);

  const value = React.useMemo(() => ({ toasts, show, dismiss }), [toasts, show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
    </ToastContext.Provider>
  );
}

type ViewportProps = {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
};

/**
 * Two live regions, both rendered from first paint and never nested.
 *
 * The old viewport was `aria-live="polite" aria-atomic="true"` with a
 * `role="status"` or `role="alert"` on every card inside it: a live region
 * inside a live region, which screen readers announce twice or not at all,
 * and `aria-atomic` re-read every visible toast whenever one was added
 * (UX-19). Now success and info go into one polite `status` region, errors
 * into one `alert` region, and the cards themselves carry no live semantics.
 * The regions have to exist before their content changes or the first
 * message is missed, which is why they render even when empty.
 */
export function ToastViewport({ toasts, onDismiss, onPause, onResume }: ViewportProps) {
  const card = (t: ToastItem) => (
    <ToastCard
      key={t.id}
      item={t}
      onDismiss={() => onDismiss(t.id)}
      onPause={() => onPause?.(t.id)}
      onResume={() => onResume?.(t.id)}
    />
  );
  const errors = toasts.filter((t) => t.kind === 'error');
  const others = toasts.filter((t) => t.kind !== 'error');
  // No `display: none` on an empty region: a region that is hidden when its
  // content arrives is not reliably announced. Empty, they take no space.
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 mx-auto flex max-w-sm flex-col px-4">
      <div role="alert" className="flex flex-col gap-2">
        {errors.map(card)}
      </div>
      <div
        role="status"
        className={cn('flex flex-col gap-2', errors.length > 0 && others.length > 0 && 'mt-2')}
      >
        {others.map(card)}
      </div>
    </div>
  );
}

function ToastCard({
  item,
  onDismiss,
  onPause,
  onResume,
}: {
  item: ToastItem;
  onDismiss: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const Icon = item.kind === 'success' ? CheckCircle : item.kind === 'error' ? WarningCircle : Info;
  const color =
    item.kind === 'success'
      ? 'text-success'
      : item.kind === 'error'
        ? 'text-destructive'
        : 'text-primary';
  return (
    <div
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      onFocus={onPause}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onResume();
      }}
      className="pointer-events-auto flex items-start gap-3 rounded-card border border-border bg-card p-3.5 shadow-lg animate-fade-up"
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', color)} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-ui font-semibold text-ink">{item.title}</div>
        {item.description ? (
          <div className="mt-0.5 text-caption text-ink-soft wrap-break-word">
            {item.description}
          </div>
        ) : null}
        {item.action ? (
          // next/link, not a raw <a>: the action is always an in-app route
          // and a full page reload threw away the client state it came from.
          <Link
            href={item.action.href}
            onClick={onDismiss}
            className="mt-1.5 inline-flex min-h-6 items-center text-caption font-medium text-primary underline-offset-2 hover:underline"
          >
            {item.action.label} →
          </Link>
        ) : null}
      </div>
      {/*
        32 px box (44 px under a coarse pointer) around a 16 px icon. The ×
        was the 16 px icon alone, under the 24 px floor of SC 2.5.8 (UX-8).
        The negative margin keeps the larger box from pushing the text in.
      */}
      <button
        type="button"
        onClick={onDismiss}
        className="-m-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-soft hover:bg-surface-2 hover:text-ink coarse:h-11 coarse:w-11"
        aria-label={`Dismiss: ${item.title}`}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
