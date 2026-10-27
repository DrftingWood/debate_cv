/**
 * The public CV (/u/<slug>) asks for speaker field sizes (one grouped count,
 * not the heavy field summary) and shows "Nth of N" with a percentile in its
 * highlights, as the owner's /cv does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeCvData, makeSpeakerRow } from './setup/cv-fixtures';

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

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue({
    id: 'u1',
    name: 'Maya Rao',
    image: null,
    publicCvEnabled: true,
    publicAvatarEnabled: false,
  });
});

describe('public CV field size', () => {
  it('requests field sizes without the heavy field stats and renders "of N"', async () => {
    const base = makeCvData({
      speakerRows: [makeSpeakerRow({ speakerRankOpen: 5, speakerFieldSize: 400 })],
      judgeRows: [],
    });
    buildCvDataMock.mockResolvedValue({
      ...base,
      highlights: {
        ...base.highlights,
        bestSpeakerRank: {
          tournamentName: 'Worlds 2024',
          year: 2024,
          rank: 5,
          totalSpeakers: 400,
          topPercent: 1.25,
          tied: true,
        },
      },
    });
    const page = await PublicCvPage({ params: Promise.resolve({ slug: 'maya' }) });
    const html = renderToStaticMarkup(createElement('div', null, page));
    expect(buildCvDataMock).toHaveBeenCalledWith('u1', {
      includeFieldStats: false,
      includeFieldSizes: true,
    });
    expect(html).toContain('5th= of 400');
    expect(html).toContain('top 1%');
  });
});
