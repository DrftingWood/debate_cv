'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Share2, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

type SharingState = {
  enabled: boolean;
  slug: string | null;
  avatarEnabled: boolean;
};

/**
 * Share button for the /cv header. Per Q19 the popover is the same UI in
 * both states — opening it when sharing is off shows the toggle inline so
 * the user can flip it on without navigating to Settings; opening it when
 * sharing is on shows the URL + copy. Custom slug + avatar toggle live
 * over in /settings/sharing — this is the day-to-day "send my CV" surface.
 */
export function CvShareButton() {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<SharingState | null>(null);
  const [open, setOpen] = useState(false);
  const [pendingToggle, startToggle] = useTransition();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Lazy-load only on first open so we don't hit /api/sharing for users
  // who never click Share.
  useEffect(() => {
    if (!open || state) return;
    void (async () => {
      try {
        const res = await fetch('/api/sharing');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: SharingState = await res.json();
        setState(data);
      } catch {
        toast.show({ kind: 'error', title: 'Could not load sharing state' });
      }
    })();
  }, [open, state, toast]);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKeydown);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKeydown);
    };
  }, [open]);

  const setEnabled = (next: boolean) => {
    startToggle(async () => {
      const res = await postJson<SharingState>('/api/sharing', { enabled: next });
      if (!res.ok) {
        toast.show({ kind: 'error', title: 'Save failed', description: res.error });
        return;
      }
      setState(res.data);
      toast.show({
        kind: 'success',
        title: next ? 'Public sharing on' : 'Public sharing off',
      });
      router.refresh();
    });
  };

  const fullUrl =
    state?.slug && typeof window !== 'undefined'
      ? `${window.location.origin}/u/${state.slug}`
      : null;

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        size="sm"
        variant="outline"
        leftIcon={<Share2 className="h-3.5 w-3.5" aria-hidden />}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        Share
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-label="Share your CV"
          className="absolute right-0 z-30 mt-2 w-[320px] rounded-card border border-border bg-card p-4 shadow-lg"
        >
          {!state ? (
            <p className="text-caption text-muted-foreground">Loading…</p>
          ) : !state.enabled ? (
            <div className="space-y-2.5">
              <p className="text-[13px] text-foreground">
                Public sharing is off. Turn it on and we&apos;ll generate a
                link you can share.
              </p>
              <div className="flex items-center justify-between gap-2">
                <Link
                  href="/settings/sharing"
                  className="text-caption text-primary hover:underline"
                >
                  More options →
                </Link>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  loading={pendingToggle}
                  onClick={() => setEnabled(true)}
                >
                  Turn on sharing
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[13px] text-foreground">Anyone with this link can view your CV.</p>
              <div className="flex items-center gap-2">
                <a
                  href={fullUrl ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 truncate font-mono text-[12.5px] text-primary hover:underline"
                >
                  {fullUrl ?? '/u/...'}
                </a>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  leftIcon={<Copy className="h-3.5 w-3.5" aria-hidden />}
                  onClick={() => {
                    if (!fullUrl) return;
                    void navigator.clipboard.writeText(fullUrl).then(() =>
                      toast.show({ kind: 'success', title: 'Link copied' }),
                    );
                  }}
                >
                  Copy
                </Button>
                <a
                  href={fullUrl ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Open public CV in new tab"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                <Link
                  href="/settings/sharing"
                  className="text-caption text-primary hover:underline"
                >
                  Custom slug + avatar in Settings →
                </Link>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  loading={pendingToggle}
                  onClick={() => setEnabled(false)}
                >
                  Turn off
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
