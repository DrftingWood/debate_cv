import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from '../setup/api-test-utils';

vi.mock('@/lib/db', () =>
  import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })),
);
const requireAdminMock = vi.fn();
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));

const { GET } = await import('@/app/api/admin/tags/export/route');
const { POST } = await import('@/app/api/admin/tags/import/route');

function importReq(body: unknown) {
  return POST(
    new Request('http://localhost/api/admin/tags/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  requireAdminMock.mockReset();
  resetPrismaMock();
  requireAdminMock.mockResolvedValue('admin@example.com');
  prismaMock.user.findUnique.mockResolvedValue({ id: 'admin-user' });
});

describe('GET /api/admin/tags/export', () => {
  it('rejects non-admins', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    expect((await GET()).status).toBe(403);
    expect(prismaMock.motion.findMany).not.toHaveBeenCalled();
  });

  it('lists only what still needs an answer, as plain JSON the admin can hand over', async () => {
    prismaMock.motion.findMany.mockResolvedValue([
      {
        id: 11n,
        tournamentId: 5n,
        text: 'THW ban zoos',
        infoSlide: null,
        motionType: null,
        topic: null,
      },
    ]);
    prismaMock.tournament.findMany.mockResolvedValue([
      {
        id: 5n,
        name: 'WUDC Belgrade 2022',
        format: 'British Parliamentary',
        year: 2022,
        sourceUrlRaw: 'https://wudc2022.calicotab.com/wudc/',
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="untagged-/);
    const body = (await res.json()) as {
      motions: Array<{ id: string; tournamentId: string; text: string }>;
      tournaments: Array<{ id: string; name: string; host: string }>;
    };
    // BigInt ids travel as strings.
    expect(body.motions[0]).toMatchObject({ id: '11', tournamentId: '5', text: 'THW ban zoos' });
    expect(body.tournaments[0]).toMatchObject({
      id: '5',
      name: 'WUDC Belgrade 2022',
      host: 'wudc2022.calicotab.com',
    });
    // Same "still to do" rule as the classifier: nothing already tagged or suggested.
    expect((prismaMock.motion.findMany.mock.calls[0][0] as { where: unknown }).where).toEqual({
      OR: [
        { motionType: null, tagProposals: { none: { kind: 'motion_type' } } },
        { topic: null, tagProposals: { none: { kind: 'motion_topic' } } },
      ],
    });
  });
});

describe('POST /api/admin/tags/import', () => {
  it('rejects non-admins and writes nothing', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    const res = await importReq({ motions: [], tournaments: [] });
    expect(res.status).toBe(403);
    expect(prismaMock.tagProposal.createMany).not.toHaveBeenCalled();
  });

  it('rejects a value outside the vocabulary before touching the database', async () => {
    const res = await importReq({
      motions: [{ id: '11', motionType: 'THW', topic: 'Cooking' }],
      tournaments: [],
    });
    expect(res.status).toBe(400);
    expect(prismaMock.motion.findMany).not.toHaveBeenCalled();
  });

  it('files pending proposals for the dimensions that are still empty, and skips the rest', async () => {
    prismaMock.motion.findMany.mockResolvedValue([
      // Both empty, no proposals: both dimensions get filed.
      { id: 11n, tournamentId: 5n, motionType: null, topic: null, tagProposals: [] },
      // Topic already approved: only the type may be filed.
      { id: 12n, tournamentId: 5n, motionType: null, topic: 'Education', tagProposals: [] },
      // Type already has a (say, rejected) proposal: it must not be revived.
      {
        id: 13n,
        tournamentId: 5n,
        motionType: null,
        topic: null,
        tagProposals: [{ kind: 'motion_type' }],
      },
    ]);
    prismaMock.tournament.findMany.mockResolvedValue([
      { id: 5n, region: null, tagProposals: [] },
      { id: 6n, region: 'Europe', tagProposals: [] },
    ]);
    prismaMock.tagProposal.createMany.mockResolvedValue({ count: 5 });

    const res = await importReq({
      motions: [
        { id: '11', motionType: 'THW', topic: 'Economics & Business' },
        { id: '12', motionType: 'THR', topic: 'Religion & Culture' },
        { id: '13', motionType: 'THS', topic: 'Education' },
      ],
      tournaments: [
        { id: '5', region: 'Europe' },
        { id: '6', region: 'Africa' },
      ],
    });
    expect(res.status).toBe(200);

    const data = (
      prismaMock.tagProposal.createMany.mock.calls[0][0] as {
        data: Array<{
          kind: string;
          motionId: bigint | null;
          tournamentId: bigint;
          value: string;
          userId: string;
        }>;
      }
    ).data;
    const key = (d: (typeof data)[number]) =>
      `${d.kind}:${d.motionId ?? 't'}:${d.tournamentId}:${d.value}`;
    expect(data.map(key).sort()).toEqual(
      [
        'motion_type:11:5:THW',
        'motion_topic:11:5:Economics & Business',
        'motion_type:12:5:THR',
        'motion_topic:13:5:Education',
        'region:t:5:Europe',
      ].sort(),
    );
    expect(data.every((d) => d.userId === 'admin-user')).toBe(true);
    const out = (await res.json()) as { filed: number; skipped: number };
    expect(out.filed).toBe(5);
    expect(out.skipped).toBe(3); // 12's topic, 13's type, 6's region
  });
});
