'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LogOut, Settings } from 'lucide-react';
import { signOutAction } from '@/lib/auth/signOutAction';

/**
 * Header avatar + popover with Account link and Sign out.
 *
 * Why this exists: before this, SignOutButton lived only inside the
 * dashboard's "More actions" dropdown, so a user stuck on a broken
 * /settings/account render had no global way to log out. The popover
 * follows the same a11y + dismissal pattern as NotificationBell
 * (outside-click + Escape close, aria-expanded, role="menu").
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
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-label="Account menu"
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-[11px] font-semibold uppercase tracking-wide text-ink transition-colors hover:bg-muted/70"
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
          role="menu"
          className="absolute right-0 z-30 mt-2 w-[240px] rounded-card border border-border bg-card shadow-lg"
        >
          <div className="border-b border-border px-4 py-3">
            <div className="truncate text-[13px] font-medium text-foreground" title={displayName}>
              {displayName}
            </div>
            {showEmailRow ? (
              <div className="truncate text-[11.5px] text-muted-foreground" title={email ?? undefined}>
                {email}
              </div>
            ) : null}
          </div>
          <div className="py-1">
            <Link
              href="/settings/account"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-4 py-2 text-[13px] text-foreground transition-colors hover:bg-muted/40"
            >
              <Settings className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              Account
            </Link>
            <form action={signOutAction}>
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-muted/40"
              >
                <LogOut className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                Sign out
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
