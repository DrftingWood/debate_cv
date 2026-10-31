import { beforeEach, describe, expect, it, vi } from 'vitest';

// R12 ruling 19: ignored tournaments leave every kind of Inbox item, and the
// counts read through the same filters as the lists.

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  stored: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ prisma: { tournament: { findMany: h.findMany } } }));
vi.mock('@/lib/admin/tournamentLookup', () => ({ storedMatchesByUrl: h.stored }));

const { withoutIgnoredReports, withoutIgnoredParserGroups } =
  await import('@/lib/admin/inboxIgnored');

/** Which stored tournaments are ignored, as the database would answer. */
function flags(map: Record<string, boolean>) {
  h.findMany.mockImplementation(async ({ where }: { where: { id: { in: bigint[] } } }) =>
    where.id.in.flatMap((id) => (String(id) in map ? [{ id, ignored: map[String(id)] }] : [])),
  );
}
const report = (...tournamentIds: string[]) => ({ r: { tournamentIds } });

beforeEach(() => {
  h.findMany.mockReset();
  h.stored.mockReset();
});

describe('reports', () => {
  it('drops a report about an ignored tournament only', async () => {
    flags({ '1': true, '2': false });
    const kept = await withoutIgnoredReports([report('1'), report('2'), report('1', '2')]);
    expect(kept).toEqual([report('2'), report('1', '2')]);
  });

  it('keeps a report naming no stored tournament, and one with no ids', async () => {
    flags({});
    const open = [report('9'), report()];
    expect(await withoutIgnoredReports(open)).toEqual(open);
  });
});

describe('parser groups', () => {
  const group = (...urls: string[]) => ({ g: { urls } });

  it('drops a group whose pages all resolve to ignored tournaments', async () => {
    h.stored.mockResolvedValue({
      stored: new Map([
        ['https://a.calicotab.com/t1/', { id: '1' }],
        ['https://b.calicotab.com/t2/', { id: '2' }],
      ]),
      ambiguous: new Map(),
    });
    flags({ '1': true, '2': false });
    const open = [
      group('https://a.calicotab.com/t1/'),
      group('https://b.calicotab.com/t2/'),
      group('https://a.calicotab.com/t1/', 'https://b.calicotab.com/t2/'),
      group('https://c.calicotab.com/unstored/'),
    ];
    expect(await withoutIgnoredParserGroups(open)).toEqual(open.slice(1));
  });

  it('asks nothing when no group has a url', async () => {
    const open = [group()];
    expect(await withoutIgnoredParserGroups(open)).toEqual(open);
    expect(h.stored).not.toHaveBeenCalled();
  });
});
