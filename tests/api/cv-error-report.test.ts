import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authMock,
  prismaMock,
  resetPrismaMock,
  fakeSession,
  jsonRequest,
  readJson,
} from '../setup/api-test-utils';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => ({ auth: m.authMock })));
vi.mock('@/lib/db', () => import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { POST } = await import('@/app/api/cv/error-report/route');

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
});

describe('POST /api/cv/error-report', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(
      jsonRequest('/api/cv/error-report', {
        body: { tournamentIds: ['1'], categories: ['wrong_teammate'] },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects an empty submission (no categories AND no comment)', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    const res = await POST(
      jsonRequest('/api/cv/error-report', { body: { tournamentIds: ['1'] } }),
    );
    expect(res.status).toBe(400);
  });

  it('accepts a category-only submission (comment optional)', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.discoveredUrl.findMany.mockResolvedValue([{ tournamentId: BigInt(1) }]);
    prismaMock.cvErrorReport.create.mockResolvedValue({
      id: 'rpt1',
      createdAt: new Date('2026-04-29T10:00:00Z'),
    });
    const res = await POST(
      jsonRequest('/api/cv/error-report', {
        body: { tournamentIds: ['1'], categories: ['wrong_teammate'] },
      }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ id: string; tournamentCount: number }>(res);
    expect(data.id).toBe('rpt1');
    expect(data.tournamentCount).toBe(1);
    expect(prismaMock.cvErrorReport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        tournamentIds: ['1'],
        categories: ['wrong_teammate'],
        comment: '',
      }),
      select: expect.any(Object),
    });
  });

  it('rejects unknown categories', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    const res = await POST(
      jsonRequest('/api/cv/error-report', {
        body: { tournamentIds: ['1'], categories: ['definitely_not_a_real_category'] },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects when none of the requested tournament IDs belong to the user', async () => {
    // AUDIT ISSUE #18: silently dropping all IDs returns no_accessible_tournaments
    // — confirms the endpoint surfaces a clear error instead of silently storing
    // an empty report.
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.discoveredUrl.findMany.mockResolvedValue([]); // user owns none of the requested
    const res = await POST(
      jsonRequest('/api/cv/error-report', {
        body: { tournamentIds: ['9999'], categories: ['wrong_teammate'] },
      }),
    );
    expect(res.status).toBe(400);
    const data = await readJson<{ error: string }>(res);
    expect(data.error).toBe('no_accessible_tournaments');
    expect(prismaMock.cvErrorReport.create).not.toHaveBeenCalled();
  });

  it('drops IDs the user does not own and reports against the rest', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.discoveredUrl.findMany.mockResolvedValue([{ tournamentId: BigInt(1) }]); // owns 1, not 2
    prismaMock.cvErrorReport.create.mockResolvedValue({
      id: 'rpt2',
      createdAt: new Date(),
    });
    const res = await POST(
      jsonRequest('/api/cv/error-report', {
        body: {
          tournamentIds: ['1', '2'],
          categories: ['wrong_speaker_rank'],
          comment: 'My rank is wrong',
        },
      }),
    );
    expect(res.status).toBe(200);
    const data = await readJson<{ tournamentCount: number }>(res);
    expect(data.tournamentCount).toBe(1);
    expect(prismaMock.cvErrorReport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tournamentIds: ['1'],
        categories: ['wrong_speaker_rank'],
        comment: 'My rank is wrong',
      }),
      select: expect.any(Object),
    });
  });
});
