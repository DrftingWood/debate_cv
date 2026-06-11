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

import { POST } from '@/app/api/admin/tags/classify/route';
import { requireAdmin } from '@/lib/admin';
import { classifyMotions, isClassifierConfigured } from '@/lib/tags/classifyMotions';
import { prismaMock, resetPrismaMock } from '../setup/api-test-utils';

const requireAdminMock = vi.mocked(requireAdmin);
const classifyMock = vi.mocked(classifyMotions);
const configuredMock = vi.mocked(isClassifierConfigured);

beforeEach(() => {
  vi.clearAllMocks();
  resetPrismaMock();
  requireAdminMock.mockResolvedValue('admin@example.com');
  configuredMock.mockReturnValue(true);
  prismaMock.user.findUnique.mockResolvedValue({ id: 'admin-user' });
});

describe('POST /api/admin/tags/classify', () => {
  it('rejects non-admins with the thrown status', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    const res = await POST();
    expect(res.status).toBe(403);
  });

  it('returns 503 when no API key is configured', async () => {
    configuredMock.mockReturnValue(false);
    const res = await POST();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('classifier_not_configured');
  });

  it('no-ops cleanly when every motion is already tagged', async () => {
    prismaMock.motion.findMany.mockResolvedValue([]);
    prismaMock.motion.count.mockResolvedValue(0);
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ classified: 0, proposalsFiled: 0, remaining: 0 });
    expect(classifyMock).not.toHaveBeenCalled();
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
    prismaMock.motion.count.mockResolvedValue(2);
    classifyMock.mockResolvedValue([
      { id: 11n, motionType: 'THW', topic: 'Economics & Business' },
      { id: 12n, motionType: 'THR', topic: 'Religion & Culture' },
    ]);
    prismaMock.tagProposal.findFirst.mockResolvedValue(null);
    prismaMock.tagProposal.create.mockResolvedValue({ id: 'p' });

    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { classified: number; proposalsFiled: number; remaining: number };
    expect(body.classified).toBe(2);
    // Motion 11: type + topic. Motion 12: type only (topic already canonical).
    expect(body.proposalsFiled).toBe(3);
    expect(body.remaining).toBe(0);

    const created = prismaMock.tagProposal.create.mock.calls.map(
      (c) => (c[0] as { data: { kind: string; motionId: bigint; value: string } }).data,
    );
    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'motion_type', motionId: 11n, value: 'THW', userId: 'admin-user' }),
        expect.objectContaining({ kind: 'motion_topic', motionId: 11n, value: 'Economics & Business' }),
        expect.objectContaining({ kind: 'motion_type', motionId: 12n, value: 'THR' }),
      ]),
    );
    expect(created.some((d) => d.kind === 'motion_topic' && d.motionId === 12n)).toBe(false);
  });

  it('refreshes the admin’s existing proposal instead of stacking a duplicate', async () => {
    prismaMock.motion.findMany.mockResolvedValue([
      { id: 11n, tournamentId: 1n, text: 'THW ban X', infoSlide: null, motionType: null, topic: 'Education' },
    ]);
    prismaMock.motion.count.mockResolvedValue(1);
    classifyMock.mockResolvedValue([
      { id: 11n, motionType: 'THW', topic: 'Economics & Business' },
    ]);
    prismaMock.tagProposal.findFirst.mockResolvedValue({ id: 'existing-prop' });
    prismaMock.tagProposal.update.mockResolvedValue({ id: 'existing-prop' });

    const res = await POST();
    expect(res.status).toBe(200);
    expect(prismaMock.tagProposal.create).not.toHaveBeenCalled();
    expect(prismaMock.tagProposal.update).toHaveBeenCalledWith({
      where: { id: 'existing-prop' },
      data: { value: 'THW', status: 'pending', adminNote: null, reviewedAt: null },
    });
  });

  it('reports the backlog remaining beyond this batch', async () => {
    prismaMock.motion.findMany.mockResolvedValue([
      { id: 11n, tournamentId: 1n, text: 'THW ban X', infoSlide: null, motionType: null, topic: null },
    ]);
    prismaMock.motion.count.mockResolvedValue(75);
    classifyMock.mockResolvedValue([]);
    const res = await POST();
    const body = (await res.json()) as { remaining: number };
    expect(body.remaining).toBe(74);
  });
});
