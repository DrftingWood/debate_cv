import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => import('../setup/api-test-utils').then((m) => m.dbMockModule));
vi.mock('@/lib/admin', () => ({ requireAdmin: vi.fn() }));
// The classifier wraps the Anthropic SDK; its behavior is config + API
// shaped, so the route test substitutes it at the module boundary and
// asserts on what the route does with classifications.
vi.mock('@/lib/tags/classifyMotions', () => ({
  classifyMotions: vi.fn(),
  isClassifierConfigured: vi.fn(),
}));

vi.mock('@/lib/tags/classifyTournaments', () => ({
  classifyTournamentRegions: vi.fn(),
}));

import { POST } from '@/app/api/admin/tags/classify/route';
import { requireAdmin } from '@/lib/admin';
import { classifyMotions, isClassifierConfigured } from '@/lib/tags/classifyMotions';
import { classifyTournamentRegions } from '@/lib/tags/classifyTournaments';
import { prismaMock, resetPrismaMock } from '../setup/api-test-utils';

// Next.js route handlers must take a required `req`, so every call passes one.
const emptyRequest = () =>
  new Request('http://localhost/api/admin/tags/classify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

const requireAdminMock = vi.mocked(requireAdmin);
const classifyMock = vi.mocked(classifyMotions);
const configuredMock = vi.mocked(isClassifierConfigured);
const regionsMock = vi.mocked(classifyTournamentRegions);

beforeEach(() => {
  vi.clearAllMocks();
  resetPrismaMock();
  requireAdminMock.mockResolvedValue('admin@example.com');
  configuredMock.mockReturnValue(true);
  prismaMock.user.findUnique.mockResolvedValue({ id: 'admin-user' });
  // Most cases are about motions; tournaments default to "nothing to do".
  prismaMock.tournament.findMany.mockResolvedValue([]);
  prismaMock.tournament.count.mockResolvedValue(0);
});

describe('POST /api/admin/tags/classify', () => {
  it('rejects non-admins with the thrown status', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    const res = await POST(emptyRequest());
    expect(res.status).toBe(403);
  });

  it('returns 503 when no API key is configured', async () => {
    configuredMock.mockReturnValue(false);
    const res = await POST(emptyRequest());
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('classifier_not_configured');
  });

  it('no-ops cleanly when every motion is already tagged', async () => {
    prismaMock.motion.findMany.mockResolvedValue([]);
    prismaMock.motion.count.mockResolvedValue(0);
    const res = await POST(emptyRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      classified: 0,
      proposalsFiled: 0,
      remaining: 0,
      regionsFiled: 0,
      regionsRemaining: 0,
      motionCursor: null,
      tournamentCursor: null,
    });
    expect(classifyMock).not.toHaveBeenCalled();
    expect(regionsMock).not.toHaveBeenCalled();
  });

  it('files pending proposals only for the untagged dimensions', async () => {
    prismaMock.motion.findMany.mockResolvedValue([
      {
        id: 11n,
        tournamentId: 1n,
        text: 'THW ban X',
        infoSlide: null,
        motionType: null,
        topic: null,
      },
      {
        // Topic already approved — only the type may get a suggestion.
        id: 12n,
        tournamentId: 1n,
        text: 'This House regrets Y',
        infoSlide: null,
        motionType: null,
        topic: 'Education',
      },
    ]);
    prismaMock.motion.count.mockResolvedValue(0);
    classifyMock.mockResolvedValue([
      { id: 11n, motionType: 'THW', topic: 'Economics & Business' },
      { id: 12n, motionType: 'THR', topic: 'Religion & Culture' },
    ]);
    prismaMock.tagProposal.findFirst.mockResolvedValue(null);
    prismaMock.tagProposal.create.mockResolvedValue({ id: 'p' });

    const res = await POST(emptyRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      classified: number;
      proposalsFiled: number;
      remaining: number;
    };
    expect(body.classified).toBe(2);
    // Motion 11: type + topic. Motion 12: type only (topic already canonical).
    expect(body.proposalsFiled).toBe(3);
    expect(body.remaining).toBe(0);

    const created = prismaMock.tagProposal.create.mock.calls.map(
      (c) => (c[0] as { data: { kind: string; motionId: bigint; value: string } }).data,
    );
    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'motion_type',
          motionId: 11n,
          value: 'THW',
          userId: 'admin-user',
        }),
        expect.objectContaining({
          kind: 'motion_topic',
          motionId: 11n,
          value: 'Economics & Business',
        }),
        expect.objectContaining({ kind: 'motion_type', motionId: 12n, value: 'THR' }),
      ]),
    );
    expect(created.some((d) => d.kind === 'motion_topic' && d.motionId === 12n)).toBe(false);
  });

  it('refreshes the admin’s existing proposal instead of stacking a duplicate', async () => {
    prismaMock.motion.findMany.mockResolvedValue([
      {
        id: 11n,
        tournamentId: 1n,
        text: 'THW ban X',
        infoSlide: null,
        motionType: null,
        topic: 'Education',
      },
    ]);
    prismaMock.motion.count.mockResolvedValue(1);
    classifyMock.mockResolvedValue([{ id: 11n, motionType: 'THW', topic: 'Economics & Business' }]);
    prismaMock.tagProposal.findFirst.mockResolvedValue({ id: 'existing-prop' });
    prismaMock.tagProposal.update.mockResolvedValue({ id: 'existing-prop' });

    const res = await POST(emptyRequest());
    expect(res.status).toBe(200);
    expect(prismaMock.tagProposal.create).not.toHaveBeenCalled();
    expect(prismaMock.tagProposal.update).toHaveBeenCalledWith({
      where: { id: 'existing-prop' },
      data: { value: 'THW', status: 'pending', adminNote: null, reviewedAt: null },
    });
  });

  it('reports the backlog remaining beyond this batch', async () => {
    prismaMock.motion.findMany.mockResolvedValue([
      {
        id: 11n,
        tournamentId: 1n,
        text: 'THW ban X',
        infoSlide: null,
        motionType: null,
        topic: null,
      },
    ]);
    // Remaining is what is left AFTER this batch's last id, so it is the
    // count query that answers it.
    prismaMock.motion.count.mockResolvedValue(74);
    classifyMock.mockResolvedValue([]);
    const res = await POST(emptyRequest());
    const body = (await res.json()) as { remaining: number; motionCursor: string };
    expect(body.remaining).toBe(74);
    expect(body.motionCursor).toBe('11');
    expect(prismaMock.motion.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: { gt: 11n } }),
    });
  });

  it('never re-picks a motion that already has a suggestion for that dimension', async () => {
    // Filing a suggestion does not change Motion.motionType/topic (only
    // approval does), so without this the same first batch would be selected
    // on every call and a "run until done" loop would never finish.
    prismaMock.motion.findMany.mockResolvedValue([]);
    prismaMock.motion.count.mockResolvedValue(0);
    await POST(emptyRequest());
    const where = (prismaMock.motion.findMany.mock.calls[0][0] as { where: unknown }).where;
    expect(where).toEqual({
      OR: [
        { motionType: null, tagProposals: { none: { kind: 'motion_type' } } },
        { topic: null, tagProposals: { none: { kind: 'motion_topic' } } },
      ],
    });
  });

  it('files a region suggestion for tournaments with no region, even with no motions to do', async () => {
    prismaMock.motion.findMany.mockResolvedValue([]);
    prismaMock.motion.count.mockResolvedValue(0);
    prismaMock.tournament.findMany.mockResolvedValue([
      {
        id: 5n,
        name: 'WUDC Belgrade 2022',
        format: 'British Parliamentary',
        year: 2022,
        sourceUrlRaw: 'https://wudc2022.calicotab.com/wudc/',
      },
    ]);
    prismaMock.tournament.count.mockResolvedValue(0);
    regionsMock.mockResolvedValue([{ id: 5n, region: 'Europe' }]);
    prismaMock.tagProposal.findFirst.mockResolvedValue(null);
    prismaMock.tagProposal.create.mockResolvedValue({ id: 'p' });

    const res = await POST(emptyRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { regionsFiled: number; regionsRemaining: number };
    expect(body.regionsFiled).toBe(1);
    expect(body.regionsRemaining).toBe(0);
    expect(prismaMock.tagProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'region',
        tournamentId: 5n,
        value: 'Europe',
        userId: 'admin-user',
      }),
    });
    // The tournament query skips ones that already carry a region suggestion.
    const where = (prismaMock.tournament.findMany.mock.calls[0][0] as { where: unknown }).where;
    expect(where).toEqual({ region: null, tagProposals: { none: { kind: 'region' } } });
  });

  it('moves past items the model could not answer, using the cursors it is given', async () => {
    // An "unsure" tournament files no proposal, so without a cursor it would
    // sit in the first batch forever and hide everything behind it.
    prismaMock.motion.findMany.mockResolvedValue([]);
    prismaMock.motion.count.mockResolvedValue(0);
    prismaMock.tournament.findMany.mockResolvedValue([]);
    await POST(
      new Request('http://localhost/api/admin/tags/classify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ motionAfter: '40', tournamentAfter: '12' }),
      }),
    );
    expect(
      (prismaMock.motion.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where,
    ).toMatchObject({
      id: { gt: 40n },
    });
    expect(
      (prismaMock.tournament.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where,
    ).toMatchObject({
      id: { gt: 12n },
    });
  });

  it('rejects a cursor that is not a number', async () => {
    const res = await POST(
      new Request('http://localhost/api/admin/tags/classify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ motionAfter: 'abc' }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
