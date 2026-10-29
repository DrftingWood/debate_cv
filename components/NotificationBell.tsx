'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, Tray } from '@/components/ui/icons';
import { cn } from '@/lib/utils/cn';
import { postJson } from '@/lib/utils/api';
import { formatDate } from '@/lib/utils/date';
import { usePopover } from '@/components/ui/usePopover';

type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

type ListResponse = {
  unreadCount: number;
  notifications: NotificationItem[];
};

/**
 * Header bell with an unread-count badge + dropdown panel of recent
 * notifications. Polls /api/notifications every 60s while the tab is
 * focused so a user sitting on /cv during a long ingest sees new entries
 * arrive without refreshing. Opening the panel marks everything read.
 */
export function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const { open, setOpen, containerRef, triggerRef, panelRef } = usePopover();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data: ListResponse = await res.json();
      setItems(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // Silent — bell is enrichment, not critical.
    }
  }, []);

  // Initial load + 60s polling while document is visible.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time fetch, then polling; state is set when each response arrives
    void refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const handle = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(handle);
    };
  }, [refresh]);

  const onToggle = () => {
    setOpen((wasOpen) => {
      const willOpen = !wasOpen;
      if (willOpen && unreadCount > 0) {
        // Optimistically clear unread; server-side mark-read happens in
        // parallel. If it fails, the next refresh re-syncs.
        setUnreadCount(0);
        setItems((prev) =>
          prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
        );
        void postJson('/api/notifications/mark-read');
      }
      return willOpen;
    });
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="notifications-panel"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink coarse:h-11 coarse:w-11"
      >
        <Bell className="h-4 w-4" aria-hidden />
        {unreadCount > 0 ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground ring-2 ring-background"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
        {/* The button's name. It used to be overridden by an aria-label of
            plain "Notifications", so the unread count was never read out. */}
        <span className="sr-only">
          {unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        </span>
      </button>
      {open ? (
        // A disclosure, not role="menu" (UX-5): the panel holds a heading
        // and plain links, none of them menu items, so the menu role was a
        // promise of arrow-key navigation it could not keep (axe
        // aria-required-children).
        <div
          ref={panelRef}
          id="notifications-panel"
          role="region"
          aria-labelledby="notifications-heading"
          tabIndex={-1}
          className="absolute right-0 z-30 mt-2 w-[320px] max-w-[calc(100vw-2rem)] rounded-card border border-border bg-card shadow-lg"
        >
          <h2
            id="notifications-heading"
            className="border-b border-border px-4 py-2.5 text-table font-medium text-ink"
          >
            Notifications
          </h2>
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center text-caption text-ink-soft">
              <Tray weight="light" className="h-5 w-5" aria-hidden />
              <span>You&apos;re all caught up.</span>
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <NotificationRow item={n} onClick={() => setOpen(false)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function NotificationRow({ item, onClick }: { item: NotificationItem; onClick: () => void }) {
  const created = new Date(item.createdAt);
  const time = relativeTime(created);
  const inner = (
    <div
      className={cn(
        'flex flex-col gap-0.5 px-4 py-3 text-ui transition-colors hover:bg-surface-2',
        !item.readAt && 'bg-primary/6',
      )}
    >
      <span className="font-medium text-ink">{item.title}</span>
      {item.body ? <span className="text-ink-soft">{item.body}</span> : null}
      <span className="text-byline text-ink-soft">{time}</span>
    </div>
  );
  if (item.href) {
    return (
      <Link href={item.href} onClick={onClick}>
        {inner}
      </Link>
    );
  }
  return inner;
}

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(date);
}
