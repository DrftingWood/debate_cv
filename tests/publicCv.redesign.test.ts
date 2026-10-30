/**
 * The public CV (/u/<slug>) after the redesign (owner decision 18,
 * 2026-10-29): it loads the record without the heavy field summary and
 * without the speaker field sizes, which only the old "best speaker rank"
 * highlight used (Highlights now follow team results, never speaker rank),
 * shows Highlights as two short lists, and shows pro-am marks only when the
 * owner opted in (decision 17).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeCvData, makeJudgeRow, makeSpeakerRow } from './setup/cv-fixtures';

(globalThis as { React?: typeof React }).React = React;

const buildCvDataMock = vi.fn();
const findUnique = vi.fn();
vi.mock('@/lib/cv/buildCvData', () => ({ buildCvData: buildCvDataMock }));
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique } } }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound');
  },
}));

const { default: PublicCvPage } = await import('@/app/u/[slug]/page');

function owner(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    name: 'Maya Rao',
    image: null,
    publicCvEnabled: true,
    publicAvatarEnabled: false,
    publicHiddenTournamentIds: [],
    publicProAmEnabled: false,
    proAmMarks: ['1|partner one'],
    ...overrides,
  };
}

const record = () =>
  makeCvData({
    speakerRows: [
      makeSpeakerRow({
        tournamentId: 1n,
        tournamentName: 'Test Open',
        broke: true,
        eliminationReached: 'Semifinals',
        teammates: ['Partner One'],
      }),
    ],
    judgeRows: [
      makeJudgeRow({ tournamentId: 2n, broke: true, lastOutroundChaired: 'Grand Final' }),
    ],
    summary: {
      totalTournaments: 2,
      speakingBreaks: 1,
      judgingBreaks: 1,
      tournamentsSpoken: 1,
      tournamentsJudged: 1,
      totalRoundsChaired: 0,
    },
  });

async function render() {
  buildCvDataMock.mockResolvedValue(record());
  const page = await PublicCvPage({ params: Promise.resolve({ slug: 'maya' }) });
  return renderToStaticMarkup(createElement('div', null, page));
}

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(owner());
});

describe('public CV, redesign', () => {
  it('builds the record without field stats or field sizes', async () => {
    await render();
    expect(buildCvDataMock).toHaveBeenCalledWith('u1', {
      includeFieldStats: false,
      excludeTournamentIds: [],
    });
  });

  it('shows Highlights as a Speaking list and a Judging list', async () => {
    const html = await render();
    expect(html).toContain('id="highlights"');
    expect(html).toMatch(/<h3[^>]*>Speaking<\/h3>[\s\S]*Semifinals/);
    expect(html).toMatch(/<h3[^>]*>Judging<\/h3>[\s\S]*Chaired the Final/);
  });

  it('shares the Record header: tiles and charts per role, year groups and tabs', async () => {
    const html = await render();
    expect(html).toContain('Speaking, by year');
    expect(html).toContain('Judging, by year');
    // The public CV keeps its charts open: only the Record folds them.
    expect(html).toContain('<figure');
    expect(html).not.toContain('Show career charts');
    expect(html).toMatch(/<details id="y2025"/);
    expect(html).toMatch(/role="tab"[^>]*>Judging</);
    expect(html).not.toMatch(/role="tab"[^>]*>Partners</);
  });

  it('hides pro-am marks unless the owner opted in', async () => {
    expect(await render()).not.toContain('>Pro-am<');
    findUnique.mockResolvedValue(owner({ publicProAmEnabled: true }));
    expect(await render()).toContain('>Pro-am<');
  });
});
