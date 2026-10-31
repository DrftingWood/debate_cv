import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as { React?: typeof React }).React = React;

// Task R6 fix round 1: Fix, Mark checked, Review later and the bulk retries
// never run together. They share one flight, handed down by the page's
// CheckActionsProvider; a control outside a provider keeps its own.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));

const { CheckActionsProvider } = await import('@/components/admin/CheckActions');
const { usePageFlight } = await import('@/components/admin/pageFlight');
const { retryBatches, RETRY_BATCH_MAX } = await import('@/lib/admin/importRetry');
const { singleFlight } = await import('@/lib/utils/singleFlight');

describe('the page flight', () => {
  it('is one flight for every consumer under a provider', () => {
    const seen: unknown[] = [];
    const own = singleFlight();
    function Probe() {
      seen.push(usePageFlight(own));
      return null;
    }
    renderToStaticMarkup(
      React.createElement(
        CheckActionsProvider,
        null,
        React.createElement(Probe),
        React.createElement(Probe),
      ),
    );
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).not.toBe(own);
  });

  it('is the control own flight outside a provider', () => {
    const own = singleFlight();
    let got: unknown;
    function Probe() {
      got = usePageFlight(own);
      return null;
    }
    renderToStaticMarkup(React.createElement(Probe));
    expect(got).toBe(own);
  });
});

describe('retryBatches', () => {
  it('sends each id once, in batches of the route limit', () => {
    expect(RETRY_BATCH_MAX).toBe(200);
    const ids = Array.from({ length: 450 }, (_, i) => `j${i}`);
    const batches = retryBatches([...ids, 'j0', 'j1']);
    expect(batches.map((b) => b.length)).toEqual([200, 200, 50]);
    expect(batches.flat()).toEqual(ids);
    expect(retryBatches([])).toEqual([]);
  });
});
