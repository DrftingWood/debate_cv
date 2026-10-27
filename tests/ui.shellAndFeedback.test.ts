import * as React from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The components use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as unknown as { React: typeof React }).React = React;

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: authMock, signOut: vi.fn() }));
vi.mock('@/lib/auth/signOutAction', () => ({ signOutAction: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/cv' }));

const { Button, buttonClasses } = await import('@/components/ui/Button');
const { autoDismissMs, ToastViewport } = await import('@/components/ui/Toast');
const { TableScroll, Table } = await import('@/components/ui/DataTable');
const { EmptyState } = await import('@/components/ui/EmptyState');
const { default: AppError } = await import('@/app/(app)/error');
const { default: RootError } = await import('@/app/error');
const { default: NotFound } = await import('@/app/not-found');
const { default: AppLayout } = await import('@/app/(app)/layout');
const { NotificationBell } = await import('@/components/NotificationBell');
const { UserMenu } = await import('@/components/UserMenu');

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

/** `<a …><button` and friends: one interactive element inside another (UX-9). */
const NESTED =
  /<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<button\b|<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<a\b/;

describe('buttonClasses (NAV-4)', () => {
  it('gives a link exactly the classes the Button of the same variant and size gets', () => {
    const btn = html(h(Button, { variant: 'outline', size: 'sm' }, 'x'));
    const cls = buttonClasses({ variant: 'outline', size: 'sm' });
    expect(btn).toContain(`class="${cls}"`);
  });

  it('defaults to primary, md', () => {
    expect(buttonClasses()).toBe(buttonClasses({ variant: 'primary', size: 'md' }));
  });

  it('gives the link variant a 24px floor (DASH-4)', () => {
    expect(buttonClasses({ variant: 'link' })).toContain('min-h-6');
  });
});

describe('Toast (DASH-2)', () => {
  it('lets passive success and info time out', () => {
    expect(autoDismissMs({ kind: 'success' })).toBe(5000);
    expect(autoDismissMs({ kind: 'info' })).toBe(5000);
  });

  it('keeps errors and anything with an action until dismissed', () => {
    expect(autoDismissMs({ kind: 'error' })).toBeNull();
    expect(
      autoDismissMs({ kind: 'success', action: { label: 'View your CV', href: '/cv' } }),
    ).toBeNull();
  });

  const out = html(
    h(ToastViewport, {
      toasts: [
        { id: 'a', kind: 'success', title: 'Saved' },
        { id: 'b', kind: 'error', title: 'Scan failed' },
        { id: 'c', kind: 'info', title: 'Done', action: { label: 'View your CV', href: '/cv' } },
      ],
      onDismiss: () => {},
    }),
  );

  it('renders one alert region and one status region, with no live roles on the cards', () => {
    expect(out.match(/role="alert"/g)).toHaveLength(1);
    expect(out.match(/role="status"/g)).toHaveLength(1);
    expect(out).not.toContain('aria-live');
    expect(out).not.toContain('aria-atomic');
  });

  it('puts the error in the alert region and the others in the status region', () => {
    const alert = out.slice(out.indexOf('role="alert"'), out.indexOf('role="status"'));
    expect(alert).toContain('Scan failed');
    expect(alert).not.toContain('Saved');
    expect(out.slice(out.indexOf('role="status"'))).toContain('Saved');
  });

  it('renders both regions even when there is nothing to say', () => {
    const empty = html(h(ToastViewport, { toasts: [], onDismiss: () => {} }));
    expect(empty).toContain('role="alert"');
    expect(empty).toContain('role="status"');
  });

  it('gives the dismiss button a 32px box and a name that says what it dismisses', () => {
    expect(out).toContain('aria-label="Dismiss: Scan failed"');
    expect(out).toMatch(/<button[^>]*class="[^"]*\bh-8 w-8\b/);
  });

  it('renders the action as an in-app link', () => {
    expect(out).toMatch(/<a[^>]*href="\/cv"/);
  });
});

describe('TableScroll (STATE-3)', () => {
  it('is a focusable region named after the table inside it', () => {
    const out = html(h(TableScroll, null, h(Table, { label: 'Speaking record' }, h('tbody'))));
    expect(out).toMatch(
      /^<div role="region" aria-label="Speaking record" tabindex="0" class="table-scroll /,
    );
  });

  it('takes an explicit label over the table one', () => {
    const out = html(
      h(TableScroll, { label: 'Outer', children: h(Table, { label: 'Inner' }, h('tbody')) }),
    );
    expect(out).toContain('aria-label="Outer"');
  });

  it('drops the region role when there is no name to give it', () => {
    const out = html(h(TableScroll, null, h('table')));
    expect(out).not.toContain('role="region"');
    expect(out).toContain('tabindex="0"');
  });
});

describe('EmptyState (STATE-5)', () => {
  it('uses an h2 by default and the level asked for otherwise', () => {
    expect(html(h(EmptyState, { title: 'Nothing yet' }))).toContain('<h2');
    expect(html(h(EmptyState, { title: 'Nothing yet', headingLevel: 3 }))).toContain('<h3');
  });
});

describe('error boundaries (STATE-1)', () => {
  const error = Object.assign(
    new TypeError("Cannot read properties of undefined (reading 'map')"),
    {
      digest: '3c9f0a',
    },
  );

  for (const [name, Page] of [
    ['app/(app)/error', AppError],
    ['app/error', RootError],
  ] as const) {
    it(`${name} shows fixed copy and the digest, never the raw message`, () => {
      const out = html(h(Page, { error, reset: () => {} }));
      expect(out).not.toContain('Cannot read properties');
      expect(out).toContain('This page did not load');
      expect(out).toContain('3c9f0a');
      expect(out).not.toMatch(NESTED);
    });
  }

  it('omits the reference line when there is no digest', () => {
    const out = html(h(AppError, { error: new Error('boom'), reset: () => {} }));
    expect(out).not.toContain('Reference');
    expect(out).not.toContain('boom');
  });

  it('not-found has one main and no link wrapping a button', () => {
    const out = html(h(NotFound));
    expect(out.match(/<main\b/g)).toHaveLength(1);
    expect(out).not.toMatch(NESTED);
  });
});

describe('(app) layout landmarks (NAV-1, NAV-5, NAV-6)', () => {
  beforeEach(() => authMock.mockReset());

  async function render(user: Record<string, string> | null) {
    authMock.mockResolvedValue(user ? { user } : null);
    return html(await AppLayout({ children: h('p', null, 'PAGE') }));
  }

  it('renders header, main and footer as siblings, with the page inside main', async () => {
    const out = await render({ id: 'u1', name: 'Maya Rao', email: 'maya@example.com' });
    const headerEnd = out.indexOf('</header>');
    const mainStart = out.indexOf('<main id="main"');
    const mainEnd = out.indexOf('</main>');
    const footerStart = out.indexOf('<footer');
    expect(out.match(/<main\b/g)).toHaveLength(1);
    expect(headerEnd).toBeGreaterThan(-1);
    expect(headerEnd).toBeLessThan(mainStart);
    expect(out.indexOf('PAGE')).toBeGreaterThan(mainStart);
    expect(out.indexOf('PAGE')).toBeLessThan(mainEnd);
    expect(mainEnd).toBeLessThan(footerStart);
  });

  it('names both section navs', async () => {
    const out = await render({ id: 'u1', email: 'maya@example.com' });
    expect(out.match(/<nav aria-label="Sections"/g)).toHaveLength(2);
  });

  it('shows a signed-out visitor only destinations they can open', async () => {
    const out = await render(null);
    expect(out).not.toContain('href="/dashboard"');
    expect(out).not.toContain('href="/settings"');
    expect(out).toContain('href="/sample"');
  });
});

describe('header popovers (NAV-2, NAV-3)', () => {
  it('the bell is a disclosure button, not a menu, and its name carries the count', () => {
    const out = html(h(NotificationBell));
    expect(out).not.toContain('role="menu"');
    expect(out).not.toContain('aria-haspopup');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('aria-controls="notifications-panel"');
    expect(out).not.toContain('aria-label="Notifications"');
  });

  it('the account button is a disclosure button, not a menu', () => {
    const out = html(h(UserMenu, { name: 'Maya Rao', email: 'maya@example.com', image: null }));
    expect(out).not.toContain('role="menu"');
    expect(out).not.toContain('aria-haspopup');
    expect(out).toContain('aria-controls="account-panel"');
  });
});
