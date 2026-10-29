import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

// Server-render checks for the signed-out surfaces and the admin fixes in
// docs/UI_UX_AUDIT-2026-10-27.md: COPY-1/COPY-3 (legal pages), COPY-2 (the
// link-preview card), ADM-1 (approve-all) and ADM-7 (the verify toggle).

describe('legal pages (COPY-1, COPY-3)', () => {
  it('map the typography colours to the theme tokens instead of fixed stone greys', async () => {
    const { default: Privacy } = await import('@/app/(app)/privacy/page');
    const { default: Terms } = await import('@/app/(app)/terms/page');
    for (const out of [renderToStaticMarkup(Privacy()), renderToStaticMarkup(Terms())]) {
      expect(out).not.toContain('prose-stone');
      expect(out).toContain('[--tw-prose-body:hsl(var(--foreground))]');
      expect(out).toContain('[--tw-prose-headings:hsl(var(--foreground))]');
      expect(out).toContain('[--tw-prose-links:hsl(var(--primary))]');
      expect(out).toContain('font-sans');
    }
  });

  it('send the reader to the settings page that actually deletes data', async () => {
    const { default: Privacy } = await import('@/app/(app)/privacy/page');
    const out = renderToStaticMarkup(Privacy());
    expect(out).toContain('href="/settings/account"');
    expect(out).not.toContain('href="/settings"');
  });
});

describe('link-preview card (COPY-2)', () => {
  it('uses the Ledger brand and the landing copy, not the retired editorial one', async () => {
    const { ShareCard } = await import('@/components/landing/ShareCard');
    const out = renderToStaticMarkup(React.createElement(ShareCard));
    expect(out).toContain('Your debate history, kept like an account');
    expect(out).toContain('#0D634F');
    for (const retired of [
      'Georgia',
      'italic',
      '#7A2528',
      'compiled from your inbox',
      'Sign in with Google',
    ]) {
      expect(out).not.toContain(retired);
    }
  });

  it("draws a person's card with the speaking chart and speaking breaks only (decision 12)", async () => {
    const { ShareCard } = await import('@/components/landing/ShareCard');
    const { speakingSeries } = await import('@/lib/cv/careerChart');
    const { makeSpeakerRow } = await import('./setup/cv-fixtures');
    // Called directly: ShareCard's props default to {}, which createElement's
    // overloads cannot see through.
    const out = renderToStaticMarkup(
      ShareCard({
        person: {
          name: 'Maya Rao',
          tournaments: 9,
          speakingBreaks: 3,
          judgingBreaks: 4,
          activeYears: '2023–2025',
          bestFinish: 'Semifinals',
          speaking: speakingSeries([
            makeSpeakerRow({ year: 2024, broke: true, eliminationReached: 'Semifinals' }),
            makeSpeakerRow({ year: 2025 }),
          ]),
        },
      }),
    );
    expect(out).toContain('Maya Rao');
    expect(out).toContain('Best finish');
    // Broke is the speaking figure alone, never speaking plus judging.
    expect(out).toMatch(/Broke<\/div><div[^>]*>3</);
    expect(out).not.toContain('>7<');
    // One cell per tournament, in the tier colours (the broke blue here).
    expect(out).toContain('#4583D3');
    expect(out).toContain('&#x27;24');
  });
});

describe('approveAllInPasses (ADM-1)', () => {
  type Res =
    { ok: true; data: { approved: number } } | { ok: false; status: number; error: string };
  const ok = (approved: number): Res => ({ ok: true, data: { approved } });

  it('is complete only when the endpoint reports an empty queue', async () => {
    const { approveAllInPasses } = await import('@/components/AdminTagProposals');
    const post = vi
      .fn<() => Promise<Res>>()
      .mockResolvedValueOnce(ok(50))
      .mockResolvedValueOnce(ok(7))
      .mockResolvedValueOnce(ok(0));
    expect(await approveAllInPasses(post)).toEqual({ approved: 57, complete: true, error: null });
  });

  it('is not complete when a pass fails part-way, so the list is refetched, not cleared', async () => {
    const { approveAllInPasses } = await import('@/components/AdminTagProposals');
    const post = vi
      .fn<() => Promise<Res>>()
      .mockResolvedValueOnce(ok(50))
      .mockResolvedValueOnce({ ok: false, status: 500, error: 'HTTP 500' });
    expect(await approveAllInPasses(post)).toEqual({
      approved: 50,
      complete: false,
      error: 'HTTP 500',
    });
  });

  it('is not complete when the pass cap runs out with proposals left', async () => {
    const { approveAllInPasses } = await import('@/components/AdminTagProposals');
    const post = vi.fn<() => Promise<Res>>().mockResolvedValue(ok(10));
    expect(await approveAllInPasses(post, 3)).toEqual({
      approved: 30,
      complete: false,
      error: null,
    });
    expect(post).toHaveBeenCalledTimes(3);
  });
});

describe('VerifyMineOnlyToggle (ADM-7)', () => {
  vi.doMock('next/navigation', () => ({
    useRouter: () => ({ replace: vi.fn() }),
    usePathname: () => '/cv/verify',
    useSearchParams: () => new URLSearchParams(),
  }));

  it('keeps one label and states its state in aria-pressed', async () => {
    const { VerifyMineOnlyToggle } = await import('@/components/VerifyMineOnlyToggle');
    const on = renderToStaticMarkup(React.createElement(VerifyMineOnlyToggle, { mine: true }));
    const off = renderToStaticMarkup(React.createElement(VerifyMineOnlyToggle, { mine: false }));
    expect(on).toContain('aria-pressed="true"');
    expect(off).toContain('aria-pressed="false"');
    expect(on).toContain('Only me');
    expect(off).toContain('Only me');
    expect(off).not.toContain('Everyone');
  });
});
