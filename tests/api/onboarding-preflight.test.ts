import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authMock,
  fakeSession,
  prismaMock,
  resetPrismaMock,
  jsonRequest,
  readJson,
} from '../setup/api-test-utils';

// Owner, 2026-10-30: onboarding reads private-URL pages only to learn who the
// user is: at least ten, then the links it did not need are marked skipped.
vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => ({ auth: m.authMock })));
vi.mock('@/lib/db', () =>
  import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })),
);
vi.mock('@/lib/rateLimit', () => ({ enforceRateLimit: async () => null }));

const h = vi.hoisted(() => ({ fetchHtml: vi.fn() }));
vi.mock('@/lib/calicotab/fetch', () => ({
  LANDING_FETCH_TIMEOUT_MS: 30_000,
  fetchHtmlWithProvenance: h.fetchHtml,
}));
vi.mock('@/lib/calicotab/parseNav', () => ({
  parsePrivateUrlPage: (html: string) => ({ registration: { personName: html } }),
}));

const { POST } = await import('@/app/api/onboarding/preflight/route');
const { PREFLIGHT_SKIPPED } = await import('@/lib/identity/nameSample');

type Url = { id: string; url: string; registrationName: string | null };

/** The user's links as a tiny in-memory table behind the prisma mock. */
function links(rows: Url[]) {
  prismaMock.discoveredUrl.findMany.mockImplementation((async (args: {
    where: { registrationName?: unknown };
    take?: number;
  }) => {
    if (args.where.registrationName === null) {
      return rows.filter((r) => r.registrationName === null).slice(0, args.take);
    }
    return rows.filter((r) => r.registrationName !== null);
  }) as never);
  prismaMock.discoveredUrl.update.mockImplementation((async (args: {
    where: { id: string };
    data: { registrationName: string };
  }) => {
    const row = rows.find((r) => r.id === args.where.id);
    if (row) row.registrationName = args.data.registrationName;
    return row;
  }) as never);
  prismaMock.discoveredUrl.updateMany.mockImplementation((async (args: {
    data: { registrationName: string };
  }) => {
    let count = 0;
    for (const r of rows) {
      if (r.registrationName === null) {
        r.registrationName = args.data.registrationName;
        count += 1;
      }
    }
    return { count };
  }) as never);
  prismaMock.discoveredUrl.count.mockImplementation(
    (async () => rows.filter((r) => r.registrationName === null).length) as never,
  );
}

const unread = (n: number): Url[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `u${i}`,
    url: `https://t${i}.calicotab.com/t/privateurls/k${i}/`,
    registrationName: null,
  }));

const call = async () =>
  readJson<{ extracted: number; failed: number; remaining: number }>(
    await POST(jsonRequest('/api/onboarding/preflight', { body: {} })),
  );

beforeEach(() => {
  resetPrismaMock();
  h.fetchHtml.mockReset();
  authMock.mockResolvedValue(fakeSession('user-1'));
});

describe('POST /api/onboarding/preflight — read a sample, not every link', () => {
  it('reads ten pages, then marks the links it did not need as skipped', async () => {
    const rows = unread(25);
    links(rows);
    h.fetchHtml.mockResolvedValue({ ok: true, html: 'Abhishek Acharya' });

    const data = await call();

    expect(h.fetchHtml).toHaveBeenCalledTimes(10);
    expect(data).toMatchObject({ extracted: 10, failed: 0, remaining: 0 });
    expect(prismaMock.discoveredUrl.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', registrationName: null, registrationPersonId: null },
      data: { registrationName: '', lastPreflightError: PREFLIGHT_SKIPPED },
    });
  });

  it('reads no page once the name is already settled', async () => {
    const rows: Url[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `r${i}`,
        url: `https://r${i}.calicotab.com/t/privateurls/k/`,
        registrationName: 'Abhishek Acharya',
      })),
      ...unread(5),
    ];
    links(rows);
    const data = await call();
    expect(h.fetchHtml).not.toHaveBeenCalled();
    expect(data.remaining).toBe(0);
  });

  it('reads every link of a user with fewer than ten', async () => {
    links(unread(4));
    h.fetchHtml.mockResolvedValue({ ok: true, html: 'Abhishek Acharya' });
    const data = await call();
    expect(h.fetchHtml).toHaveBeenCalledTimes(4);
    expect(data).toMatchObject({ extracted: 4, remaining: 0 });
  });

  it('records a page that did not answer as failed, and keeps reading on the next call', async () => {
    const rows = unread(12);
    links(rows);
    h.fetchHtml.mockResolvedValue({ ok: false, status: 0, bodyPreview: 'fetch timeout' });
    const data = await call();
    expect(data).toMatchObject({ extracted: 0, failed: 10, remaining: 2 });
    expect(prismaMock.discoveredUrl.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastPreflightError: PREFLIGHT_SKIPPED }),
      }),
    );
  });

  it('paces every read through one session with the longer page limit', async () => {
    links(unread(2));
    h.fetchHtml.mockResolvedValue({ ok: true, html: 'Abhishek Acharya' });
    await call();
    const [first, second] = h.fetchHtml.mock.calls.map((c) => c[1]);
    expect(first.timeoutMs).toBe(30_000);
    expect(first.session).toBe(second.session);
  });
});
