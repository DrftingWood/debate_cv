'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Share2, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { usePopover } from '@/components/ui/usePopover';
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
  const { open, setOpen, containerRef, triggerRef, panelRef } = usePopover();
  const [pendingToggle, startToggle] = useTransition();

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

  const setEnabled = (next: boolean) => {
    startToggle(async () => {
      const res = await postJson<SharingState>('/api/sharing', { enabled: next });
      if (!res.ok) {
        // Not res.error: that is the server's code ("bad_request") or the
        // first 200 characters of an HTML error page (DASH-5).
        toast.show({
          kind: 'error',
          title: next ? 'Sharing not turned on' : 'Sharing not turned off',
          description:
            res.status === 0
              ? 'Could not reach the server. Check your connection and try again.'
              : 'Nothing changed. Try again, or use Settings → Sharing.',
        });
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
    <div ref={containerRef} className="relative" data-print-hide="true">
      <Button
        ref={triggerRef}
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
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-label="Share your CV"
          className="absolute right-0 z-30 mt-2 w-[320px] max-w-[calc(100vw-2rem)] rounded-card outline-none border border-border bg-card p-4 shadow-lg"
        >
          {!state ? (
            <p role="status" className="text-caption text-ink-soft">
              Loading…
            </p>
          ) : !state.enabled ? (
            <div className="space-y-2.5">
              <p className="text-ui text-ink">
                Public sharing is off. Turn it on and we&apos;ll generate a link you can share.
              </p>
              <div className="flex items-center justify-between gap-2">
                <Link
                  href="/settings/sharing"
                  className="text-caption text-oxblood hover:underline"
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
              <p className="text-ui text-ink">Anyone with this link can view your CV.</p>
              <div className="flex items-center gap-2">
                <a
                  href={fullUrl ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 truncate font-mono text-caption text-oxblood hover:underline"
                >
                  {fullUrl ?? '/u/...'}
                  <span className="sr-only"> (opens in new tab)</span>
                </a>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  leftIcon={<Copy className="h-3.5 w-3.5" aria-hidden />}
                  onClick={() => {
                    if (!fullUrl) return;
                    // A blocked clipboard (an insecure origin, a denied
                    // permission) used to do nothing visible at all. Wrapped
                    // so a missing navigator.clipboard (plain http) lands in
                    // the failure branch instead of throwing.
                    Promise.resolve()
                      .then(() => navigator.clipboard.writeText(fullUrl))
                      .then(
                        () => toast.show({ kind: 'success', title: 'Link copied' }),
                        () =>
                          toast.show({
                            kind: 'error',
                            title: 'Could not copy the link',
                            description: 'Select the link above and press Ctrl+C (⌘C on a Mac).',
                          }),
                      );
                  }}
                >
                  Copy
                </Button>
                <a
                  href={fullUrl ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink coarse:h-11 coarse:w-11"
                  aria-label="Open public CV in new tab"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                <Link
                  href="/settings/sharing"
                  className="text-caption text-oxblood hover:underline"
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
