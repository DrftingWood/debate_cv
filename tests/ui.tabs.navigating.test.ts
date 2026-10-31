import { describe, expect, it, vi } from 'vitest';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tabs } from '@/components/ui/Tabs';
import { tabKeyAction } from '@/lib/utils/tabKeys';

(globalThis as { React?: typeof React }).React = React;

// Navigating mode (/admin): the caller moves the address. There is no DOM
// runner here, so the keyboard rules are tested as the pure function the
// component calls, and the markup through static rendering.

const items = [
  { value: 'a', label: 'Alpha', panel: null, href: '/admin' },
  { value: 'b', label: 'Beta', panel: null, href: '/admin?tab=b' },
  { value: 'c', label: 'Gamma', panel: null, href: '/admin?tab=c' },
];

describe('tabKeyAction, manual activation', () => {
  const base = { count: 3, vertical: false, manual: true };
  it('arrows, Home and End move focus only', () => {
    expect(tabKeyAction({ ...base, key: 'ArrowRight', focused: 0 })).toEqual({ focus: 1 });
    expect(tabKeyAction({ ...base, key: 'ArrowRight', focused: 2 })).toEqual({ focus: 0 });
    expect(tabKeyAction({ ...base, key: 'ArrowLeft', focused: 0 })).toEqual({ focus: 2 });
    expect(tabKeyAction({ ...base, key: 'Home', focused: 1 })).toEqual({ focus: 0 });
    expect(tabKeyAction({ ...base, key: 'End', focused: 1 })).toEqual({ focus: 2 });
  });
  it('Enter and Space activate the focused tab', () => {
    expect(tabKeyAction({ ...base, key: 'Enter', focused: 1 })).toEqual({ activate: 1 });
    expect(tabKeyAction({ ...base, key: ' ', focused: 2 })).toEqual({ activate: 2 });
  });
  it('ignores other keys', () => {
    expect(tabKeyAction({ ...base, key: 'a', focused: 0 })).toBeNull();
  });
});

describe('tabKeyAction, automatic activation (unchanged)', () => {
  it('an arrow moves and selects; Enter is left to the browser', () => {
    const base = { count: 3, vertical: false, manual: false };
    expect(tabKeyAction({ ...base, key: 'ArrowRight', focused: 0 })).toEqual({
      focus: 1,
      activate: 1,
    });
    expect(tabKeyAction({ ...base, key: 'Enter', focused: 0 })).toBeNull();
  });
  it('vertical lists use Up and Down', () => {
    const base = { count: 3, vertical: true, manual: false };
    expect(tabKeyAction({ ...base, key: 'ArrowDown', focused: 0 })).toEqual({
      focus: 1,
      activate: 1,
    });
    expect(tabKeyAction({ ...base, key: 'ArrowRight', focused: 0 })).toBeNull();
  });
});

describe('Tabs with onSelect', () => {
  const html = (extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      createElement(Tabs, {
        label: 'Sections',
        param: 'tab',
        items,
        initialValue: 'b',
        onSelect: vi.fn(),
        ...extra,
      }),
    );

  it('renders each tab as a link to its address, the selected one from the prop', () => {
    const out = html();
    expect(out).toMatch(/<a [^>]*href="\/admin\?tab=c"/);
    expect(out).toMatch(/<a [^>]*href="\/admin"/);
    expect(out.match(/role="tab"/g)).toHaveLength(3);
    expect(out.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(out).toMatch(/<a [^>]*aria-selected="true"[^>]*>Beta<\/a>/);
    expect(out).not.toContain('<button');
  });

  it('marks the list busy while a switch is pending, and not otherwise', () => {
    expect(html({ pending: true })).toContain('aria-busy="true"');
    expect(html()).toContain('aria-busy="false"');
  });

  it('without onSelect the tabs stay buttons with no busy mark', () => {
    const out = renderToStaticMarkup(createElement(Tabs, { label: 'Role', param: 'role', items }));
    expect(out).toContain('<button');
    expect(out).not.toContain('aria-busy');
  });
});
