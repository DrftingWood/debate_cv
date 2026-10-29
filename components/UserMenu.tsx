'use client';

import Link from 'next/link';
import { LogOut, Settings } from 'lucide-react';
import { signOutAction } from '@/lib/auth/signOutAction';
import { usePopover } from '@/components/ui/usePopover';

/**
 * Header avatar + popover with Account link and Sign out.
 *
 * Why this exists: before this, SignOutButton lived only inside the
 * dashboard's "More actions" dropdown, so a user stuck on a broken
 * /settings/account render had no global way to log out. The popover
 * shares NotificationBell's disclosure mechanics (`usePopover`): focus
 * moves into the panel on open and back to the avatar on Escape. It was
 * `role="menu"` with `menuitem`s and none of the arrow-key model that role
 * promises; two links do not need a menu (UX-5).
 *
 * Avatar shows the Google profile photo when present; falls back to
 * two-letter initials drawn from `name` (preferred) or `email`. We
 * intentionally use a plain <img> rather than next/image — the photo
 * is small, comes from a third-party origin, and skipping the
 * remotePatterns config keeps deploy churn low.
 */
export function UserMenu({
  name,
  email,
  image,
}: {
  name: string | null;
  email: string | null;
  image: string | null;
}) {
  const { open, setOpen, containerRef, triggerRef, panelRef } = usePopover();

  const initials = (() => {
    const source = (name?.trim() || email?.trim() || '?').replace(/[^a-zA-Z0-9 ]/g, ' ');
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return source.slice(0, 2).toUpperCase();
  })();

  const displayName = name?.trim() || email || 'Account';
  const showEmailRow = Boolean(name?.trim()) && Boolean(email);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-label="Account menu"
        aria-expanded={open}
        aria-controls="account-panel"
        className="inline-flex h-9 w-9 coarse:h-11 coarse:w-11 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-2 text-byline font-semibold uppercase tracking-wide text-ink transition-colors hover:bg-ink/10"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            width={36}
            height={36}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span aria-hidden>{initials}</span>
        )}
      </button>
      {open ? (
        <div
          ref={panelRef}
          id="account-panel"
          tabIndex={-1}
          className="absolute right-0 z-30 mt-2 w-[240px] rounded-card border border-border bg-card shadow-lg"
        >
          <div className="border-b border-border px-4 py-3">
            <div className="truncate text-ui font-medium text-ink" title={displayName}>
              {displayName}
            </div>
            {showEmailRow ? (
              <div className="truncate text-byline text-ink-soft" title={email ?? undefined}>
                {email}
              </div>
            ) : null}
          </div>
          <ul className="py-1">
            <li>
              <Link
                href="/settings/account"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-4 py-2 text-ui text-ink transition-colors hover:bg-surface-2"
              >
                <Settings className="h-3.5 w-3.5 text-ink-soft" aria-hidden />
                Account
              </Link>
            </li>
            <li>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-ui text-ink transition-colors hover:bg-surface-2"
                >
                  <LogOut className="h-3.5 w-3.5 text-ink-soft" aria-hidden />
                  Sign out
                </button>
              </form>
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
