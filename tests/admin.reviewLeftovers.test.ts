import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as { React?: typeof React }).React = React;

// Review leftovers on the part-2 admin tables, as far as a Node runner can
// see them: the decisions behind tap, focus and the busy status line are
// pure functions, checked here; the browser check drives the real events.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

const { TabStatus } = await import('@/components/admin/TabStatus');
const { fixedSide, Tooltip } = await import('@/components/ui/Tooltip');
const { focusTargetAfterDone } = await import('@/components/admin/reviewSetFocus');
const { closeAndRefocus, escapeCloses } = await import('@/components/admin/AddToReviewSet');
const { statusSaveBlocked, BUSY_MESSAGE } = await import('@/components/admin/CvReportsTable');

const h = React.createElement;

describe('the "? Partly" list on a phone', () => {
  it('is a button that says whether the list is open, so a tap can show it', () => {
    const out = renderToStaticMarkup(
      h(TabStatus, {
        tab: { state: 'partial', tournamentId: '5', errors: ['R3: HTTP 503 Service Unavailable'] },
      }),
    );
    expect(out).toMatch(/<button type="button" aria-expanded="false"[^>]*>.*Partly<\/button>/);
    expect(out).not.toContain('tabindex="0"');
  });

  it('still takes a plain child, for the icon buttons that only want a name', () => {
    const out = renderToStaticMarkup(
      h(Tooltip, { content: 'Menu', children: h('button', null, 'x') }),
    );
    expect(out).toContain('<button>x</button>');
    expect(out).toContain('Menu');
  });
});

describe('a fixed label near the bottom of the screen', () => {
  it('opens upwards when it would spill below and there is more room above', () => {
    expect(
      fixedSide('bottom', { top: 700, bottom: 724 }, { labelHeight: 180, viewportHeight: 844 }),
    ).toBe('top');
  });

  it('opens downwards when it fits, or when there is less room above', () => {
    expect(
      fixedSide('bottom', { top: 100, bottom: 124 }, { labelHeight: 180, viewportHeight: 844 }),
    ).toBe('bottom');
    expect(
      fixedSide('bottom', { top: 40, bottom: 64 }, { labelHeight: 900, viewportHeight: 844 }),
    ).toBe('bottom');
    expect(
      fixedSide('top', { top: 700, bottom: 724 }, { labelHeight: 180, viewportHeight: 844 }),
    ).toBe('top');
  });
});

describe('focus after "Mark done" with done rows hidden', () => {
  it("goes to the next row's first control", () => {
    expect(focusTargetAfterDone(['a', 'b', 'c'], 'b')).toEqual({ row: 'c' });
  });

  it("goes to the table's caption after the last row, or to Show done when none is left", () => {
    expect(focusTargetAfterDone(['a', 'b'], 'b')).toBe('caption');
    expect(focusTargetAfterDone(['a'], 'a')).toBe('toggle');
  });
});

describe('the Add to review set form', () => {
  it('closes on Escape, and not on other keys', () => {
    const onClose = vi.fn();
    const preventDefault = vi.fn();
    escapeCloses(onClose)({ key: 'a', preventDefault });
    expect(onClose).not.toHaveBeenCalled();
    escapeCloses(onClose)({ key: 'Escape', preventDefault });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('puts focus back on its trigger once it has closed', () => {
    const frames: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (f: () => void) => frames.push(f));
    const setOpen = vi.fn();
    const trigger = { focus: vi.fn() };
    closeAndRefocus(setOpen, trigger);
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(trigger.focus).not.toHaveBeenCalled();
    frames.forEach((f) => f());
    expect(trigger.focus).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe('a CV report status change during a save', () => {
  it('is refused in words, not dropped in silence', () => {
    expect(statusSaveBlocked(false, false)).toBeNull();
    expect(statusSaveBlocked(true, false)).toBe(BUSY_MESSAGE);
    expect(statusSaveBlocked(false, true)).toBe('Wait for the last save to finish.');
  });
});
