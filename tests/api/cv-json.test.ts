import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => m.authMockModule));
// Same boundaries as tests/api/cv-export.test.ts: the builder and the
// limiter are covered elsewhere; this file is about the route's contract.
vi.mock('@/lib/cv/buildCvData', () => ({ buildCvData: vi.fn() }));
vi.mock('@/lib/rateLimit', () => ({ enforceRateLimit: vi.fn().mockResolvedValue(null) }));

import { GET } from '@/app/cv.json/route';
import { buildCvData } from '@/lib/cv/buildCvData';
import { enforceRateLimit } from '@/lib/rateLimit';
import { authMock, fakeSession, expectUnauthorized } from '../setup/api-test-utils';
import { makeCvData, makeSpeakerRow } from '../setup/cv-fixtures';

const buildCvDataMock = vi.mocked(buildCvData);

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(fakeSession('user-1'));
  buildCvDataMock.mockResolvedValue(
    makeCvData({ speakerRows: [makeSpeakerRow({ tournamentName: 'Mumbai Open', year: 2025 })], judgeRows: [] }),
  );
});

describe('GET /cv.json', () => {
  it('returns 401 when unauthenticated', async () => {
    await expectUnauthorized(() => GET());
  });

  it('serves the JSON Resume document inline, uncached, without field stats', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('content-disposition')).toBeNull();
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(buildCvDataMock).toHaveBeenCalledWith('user-1', { includeFieldStats: false });
    expect(enforceRateLimit).toHaveBeenCalledWith('cv:export', 'user-1');
    const body = (await res.json()) as {
      $schema: string;
      meta: { canonical: string; 'x-debate-cv': { version: number; speaking: { tournament: string }[] } };
    };
    expect(body.$schema).toMatch(/resume-schema\/v1\.0\.0\/schema\.json$/);
    expect(body.meta.canonical).toMatch(/^https?:\/\/.+\/cv\.json$/);
    expect(body.meta['x-debate-cv'].version).toBe(1);
    expect(body.meta['x-debate-cv'].speaking.map((s) => s.tournament)).toEqual(['Mumbai Open']);
  });

  it('passes a rate-limit response straight through', async () => {
    vi.mocked(enforceRateLimit).mockResolvedValueOnce(
      new Response('slow down', { status: 429 }) as Awaited<ReturnType<typeof enforceRateLimit>>,
    );
    const res = await GET();
    expect(res.status).toBe(429);
    expect(buildCvDataMock).not.toHaveBeenCalled();
  });
});
