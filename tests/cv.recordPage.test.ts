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
    user: { findUnique: async () => ({ proAmMarks: ['1|partner with a long name'] }) },
  },
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
  usePathname: () => '/cv',
}));
// Client leaves with their own effects stand in as markers.
vi.mock('@/components/AutoScanOnVisit', () => ({
  AutoScanOnVisit: () => createElement('i', { 'data-testid': 'autoscan' }),
}));
vi.mock('@/components/CvNeedsAttentionBanners', () => ({ CvNeedsAttentionBanners: () => null }));

const { default: CvPage } = await import('@/app/(app)/cv/page');
const { ToastProvider } = await import('@/components/ui/Toast');

const LONG = 'Australs Intervarsity Debating Championship hosted in Wellington 2025';

// Only the selected tab is built (owner review 2026-10-29), so a test of
// another tab opens it through the URL, as a reader's link would.
async function render(data = makeCvData(), tab?: string) {
  buildCvDataMock.mockResolvedValue(data);
  const page = await CvPage(tab ? { searchParams: Promise.resolve({ tab }) } : undefined);
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
  const table = html.slice(html.indexOf('Speaking record, '));
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
      'Rounds',
      'Tournament',
      'Format',
      'Team',
      'Team rank',
      'Pts',
      'Spk avg',
      'Spk tab',
      'Spk rank',
      'Result',
      'Source',
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
    expect(out.match(/<span class="sr-only">Report a problem<\/span>/g)?.length).toBe(1);
    const judging = await render(record(), 'adjudication');
    expect(judging.match(/<span class="sr-only">Report a problem<\/span>/g)?.length).toBe(1);
  });

  it('marks every tournament link as opening a new tab (CV-3)', async () => {
    const out = await render(record());
    const blankLinks = out.match(/target="_blank"/g)?.length ?? 0;
    const announced = out.match(/\(opens in new tab\)/g)?.length ?? 0;
    // The Ledger tab's one speaking row: on the desktop ledger the Source
    // column is the row's one link (the name is plain text since the
    // 2026-10-29 review), and its phone card links the name.
    expect(blankLinks).toBe(2);
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
    expect(await render(record(), 'adjudication')).toContain(
      'aria-label="Report a problem with Judged IV"',
    );
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

describe('/cv redesign: header, tabs and year groups (owner decisions 13-16)', () => {
  it('shows two tiles per role above its chart, and leaves out a role with no tournaments', async () => {
    const out = await render(record());
    expect(out).toContain('wrap-break-word">Spoke<');
    expect(out).toContain('>Broke<');
    expect(out).toContain('Speaking, by year');
    // tournamentsJudged is 0 in this fixture: no "Judged 0" tile, no chart.
    expect(out).not.toContain('wrap-break-word">Judged<');
    expect(out).not.toContain('Judging, by year</figcaption>');
  });

  it('puts speaking under Ledger and judging under Adjudication, both printed', async () => {
    const out = await render(record());
    expect(out).toMatch(/role="tab"[^>]*>Ledger</);
    expect(out).toMatch(/role="tab"[^>]*>Adjudication</);
    expect(out).toContain('data-print-all="true"');
    expect(await render(record(), 'adjudication')).toContain('Judging record, 2025');
  });

  it('groups a year in a <details> named for the chart link, with its subtotal', async () => {
    const out = await render(record());
    expect(out).toMatch(/<details id="y2025"/);
    expect(await render(record(), 'adjudication')).toMatch(/<details id="j2025"/);
    // Segments are wrapped one span each, so compare the text.
    expect(out.replace(/<[^>]+>/g, '')).toContain(
      '1 tournament · broke 1 · best Semifinals · median top 8% (n=1)',
    );
  });

  it('links the Source column to the public tab host, never a private URL', async () => {
    const out = await render(record());
    expect(out).not.toContain('privateurls');
    expect(out).toMatch(/font-mono text-caption[^"]*"><span[^>]*>example\.calicotab\.com</);
  });
});

describe('/cv round detail (owner, 2026-10-29: an icon in the row, not a widget)', () => {
  it('opens the rounds from a caret in the row, folded until clicked and printed regardless', async () => {
    const out = await render(
      makeCvData({
        speakerRows: [
          makeSpeakerRow({ roundScores: [{ roundNumber: 1, positionLabel: null, score: 75 }] }),
        ],
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
    expect(out).toMatch(
      /aria-expanded="false" aria-controls="rounds-1" aria-label="Rounds of Test Open \(1\)"/,
    );
    expect(out).toMatch(/<tr id="rounds-1" hidden="" data-rounds="true"/);
    expect(out).not.toContain('Round ledger —');
  });
});

describe('/cv Partners tab (owner decision 17)', () => {
  it('lists each partner per tournament with a pressed-state pro-am toggle, never printed', async () => {
    const out = await render(record(), 'partners');
    expect(out).toMatch(/role="tab"[^>]*>Partners</);
    expect(out).toContain('Partners by year');
    // The fixture's mark matches tournament 1's partner by name key.
    expect(out).toMatch(
      /aria-pressed="true" aria-label="Pro-am with Partner With A Long Name at Australs/,
    );
    expect(out).toMatch(/<div data-print-hide="true"><div class="space-y-section">/);
  });
});

describe('/cv career charts fold away (owner, 2026-10-29)', () => {
  it('keeps the tiles and folds the charts behind a toggle, so the ledger starts above the fold', async () => {
    const out = await render(record());
    expect(out).toContain('wrap-break-word">Spoke<');
    expect(out).toContain('Show career charts');
    // Closed by default and not yet built: no chart figure in the page.
    expect(out).not.toContain('<figure');
  });
});
