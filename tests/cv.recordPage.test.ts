/**
 * /cv rendered to static HTML with the session, the database and buildCvData
 * mocked. The pure modules behind the page have their own suites; this one
 * pins the markup fixed after the 2026-10-27 UI audit (docs/UI_UX_AUDIT-
 * 2026-10-27.md): the ledger's column set (CV-2), the new-tab links (CV-3),
 * the mobile cards (CV-1, CV-8), the Report column header (CV-15) and the
 * Reported badge (CV-6).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeCvData, makeJudgeRow, makeSpeakerRow } from './setup/cv-fixtures';

(globalThis as { React?: typeof React }).React = React;

const authMock = vi.fn();
const buildCvDataMock = vi.fn();
const gmailTokenMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/cv/buildCvData', () => ({ buildCvData: buildCvDataMock }));
vi.mock('@/lib/db', () => ({
  prisma: {
    person: { count: async () => 1 },
    ingestJob: { count: async () => 0 },
    gmailToken: { findUnique: gmailTokenMock },
  },
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
  usePathname: () => '/cv',
}));
// Client leaves with their own effects, and the async server sub-nav (its
// own suite, cv.subNav), stand in as markers.
vi.mock('@/components/AutoScanOnVisit', () => ({
  AutoScanOnVisit: () => createElement('i', { 'data-testid': 'autoscan' }),
}));
vi.mock('@/components/CvNeedsAttentionBanners', () => ({ CvNeedsAttentionBanners: () => null }));
vi.mock('@/components/CvSubNav', () => ({ CvSubNav: () => null }));

const { default: CvPage } = await import('@/app/(app)/cv/page');
const { ToastProvider } = await import('@/components/ui/Toast');

const LONG = 'Australs Intervarsity Debating Championship hosted in Wellington 2025';

async function render(data = makeCvData()) {
  buildCvDataMock.mockResolvedValue(data);
  const page = await CvPage();
  return renderToStaticMarkup(createElement(ToastProvider, null, page));
}

function record() {
  return makeCvData({
    speakerRows: [
      makeSpeakerRow({
        tournamentId: 1n,
        tournamentName: LONG,
        teamName: 'Victoria University of Wellington A',
        teammates: ['Partner With A Long Name'],
        teamRank: 3,
        totalTeams: 40,
        teamPoints: '18',
        broke: true,
        eliminationReached: 'Semifinals',
        hasOpenReport: true,
      }),
    ],
    judgeRows: [makeJudgeRow({ tournamentId: 2n, tournamentName: 'Judged IV', broke: true })],
    summary: {
      totalTournaments: 2,
      speakingBreaks: 1,
      judgingBreaks: 0,
      tournamentsSpoken: 2,
      tournamentsJudged: 0,
      totalRoundsChaired: 0,
    },
  });
}

/** The desktop speaking ledger's header row, as a list of visible header texts. */
function speakingHeaders(html: string): string[] {
  const table = html.slice(html.indexOf('Speaking record by tournament'));
  const thead = table.slice(table.indexOf('<thead>'), table.indexOf('</thead>'));
  return [...thead.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, '').trim(),
  );
}

beforeEach(() => {
  authMock.mockResolvedValue({ user: { id: 'u1', email: 'u1@example.com' } });
  gmailTokenMock.mockResolvedValue({ userId: 'u1' });
  buildCvDataMock.mockReset();
});

describe('/cv speaking ledger (desktop)', () => {
  it('drops the Teams and Partner columns and carries the field size on the rank (CV-2)', async () => {
    const out = await render(record());
    expect(speakingHeaders(out)).toEqual([
      'Tournament',
      'Year',
      'Format',
      'Team',
      'Team rank',
      'Pts',
      'Spk avg',
      'Spk tab',
      'Spk rank',
      'Result',
      'Report a problem',
    ]);
    expect(out).toContain('#3<span class="text-ink-soft">/40</span>');
    expect(out).toContain('with Partner With A Long Name');
  });

  it('spans the round-ledger row across exactly the header columns', async () => {
    const row = makeSpeakerRow({
      roundScores: [{ roundNumber: 1, positionLabel: null, score: 75 }],
    });
    const out = await render(
      makeCvData({
        speakerRows: [row],
        summary: {
          totalTournaments: 1,
          speakingBreaks: 0,
          judgingBreaks: 0,
          tournamentsSpoken: 1,
          tournamentsJudged: 0,
          totalRoundsChaired: 0,
        },
      }),
    );
    expect(out).toContain(`colSpan="${speakingHeaders(out).length}"`);
  });

  it('names the Report column with text, not an empty header (CV-15)', async () => {
    const out = await render(record());
    expect(out).not.toMatch(/<th[^>]*aria-label="Report"[^>]*><\/th>/);
    expect(out.match(/<span class="sr-only">Report a problem<\/span>/g)?.length).toBe(2);
  });

  it('marks every tournament link as opening a new tab (CV-3)', async () => {
    const out = await render(record());
    const blankLinks = out.match(/target="_blank"/g)?.length ?? 0;
    const announced = out.match(/\(opens in new tab\)/g)?.length ?? 0;
    // Two tournaments, each linked once in the ledger and once on its card.
    expect(blankLinks).toBe(4);
    expect(announced).toBe(blankLinks);
    expect(out).not.toContain('opacity-0');
  });

  it('shows the Reported badge as plain text, not a live region (CV-6)', async () => {
    const out = await render(record());
    expect(out).toContain('>Reported</span>');
    expect(out).not.toMatch(/<span[^>]*role="status"[^>]*>Reported/);
    expect(out).not.toContain('Open report against this tournament');
  });
});

describe('/cv mobile cards', () => {
  it('shows the full tournament, team and partner names (CV-1)', async () => {
    const out = await render(record());
    const cards = out.slice(out.indexOf('<ul class="space-y-3 md:hidden">'));
    expect(cards).toContain(LONG);
    expect(cards).toContain('Victoria University of Wellington A');
    expect(cards).toContain('Partner With A Long Name');
    expect(cards).not.toContain('truncate');
  });

  it('puts the outround inside the gold badge instead of beside a second Broke badge (CV-8)', async () => {
    const out = await render(record());
    const cards = out.slice(out.indexOf('<ul class="space-y-3 md:hidden">'));
    const firstCard = cards.slice(0, cards.indexOf('</li>'));
    expect(firstCard).toMatch(/<span class="[^"]*break-gold[^"]*">Semifinals<\/span>/);
    expect(firstCard).not.toContain('>Broke<');
  });

  it('names each Report button for its tournament (CV-12)', async () => {
    const out = await render(record());
    expect(out).toContain(`aria-label="Report a problem with ${LONG}"`);
    expect(out).toContain('aria-label="Report a problem with Judged IV"');
  });
});

describe('/cv header and Gmail state', () => {
  it('gives the h1 context for a screen reader (CV-11)', async () => {
    const out = await render(record());
    expect(out).toMatch(
      /<h1[^>]*><span class="sr-only">Debate record of <\/span>Test Person<\/h1>/,
    );
  });

  it('does not fire the auto-scan without a Gmail grant (DASH-13)', async () => {
    gmailTokenMock.mockResolvedValue(null);
    const out = await render(record());
    expect(out).not.toContain('data-testid="autoscan"');
    expect(out).toContain('Gmail disconnected');
  });

  it('still auto-scans with a Gmail grant', async () => {
    expect(await render(record())).toContain('data-testid="autoscan"');
  });
});
