/**
 * POST /api/cv/pro-am: the Record's Partners toggle (redesign owner decision
 * 17). The pure overview behind the tab is covered in tests/cv.proAm.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authMock,
  prismaMock,
  resetPrismaMock,
  fakeSession,
  expectUnauthorized,
  jsonRequest,
  readJson,
} from '../setup/api-test-utils';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => ({ auth: m.authMock })));
vi.mock('@/lib/db', () =>
  import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })),
);

const { POST } = await import('@/app/api/cv/pro-am/route');

const body = { tournamentId: '7', partner: 'Priya Raman', marked: true };
const post = (b: unknown) => POST(jsonRequest('/api/cv/pro-am', { body: b }));

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
});

describe('POST /api/cv/pro-am', () => {
  it('returns 401 when unauthenticated', () => expectUnauthorized(() => post(body)));

  it('refuses a tournament that is not on the user record', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.discoveredUrl.findFirst.mockResolvedValue(null);
    const res = await post(body);
    expect(res.status).toBe(404);
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
  });

  it('refuses a bad body or a partner name with no letters', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    expect((await post({ ...body, tournamentId: 'x' })).status).toBe(400);
    expect((await post({ ...body, partner: '—' })).status).toBe(400);
  });

  it('adds the mark under the partner name key, atomically', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.discoveredUrl.findFirst.mockResolvedValue({ id: 'u' });
    prismaMock.$executeRaw.mockResolvedValue(1);
    const res = await post({ ...body, partner: 'PRIYA  Ramán' });
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ marked: true });
    const [sql, ...values] = prismaMock.$executeRaw.mock.calls[0];
    expect((sql as TemplateStringsArray).join('?')).toContain('array_append');
    expect(values).toContain('7|priya raman');
  });

  it('treats an existing mark as success, and the cap as a 409', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.discoveredUrl.findFirst.mockResolvedValue({ id: 'u' });
    prismaMock.$executeRaw.mockResolvedValue(0);
    prismaMock.user.findUnique.mockResolvedValueOnce({ proAmMarks: ['7|priya raman'] });
    expect((await post(body)).status).toBe(200);
    prismaMock.user.findUnique.mockResolvedValueOnce({ proAmMarks: [] });
    expect((await post(body)).status).toBe(409);
  });

  it('removes a mark', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.discoveredUrl.findFirst.mockResolvedValue({ id: 'u' });
    const res = await post({ ...body, marked: false });
    expect(res.status).toBe(200);
    const [sql] = prismaMock.$executeRaw.mock.calls[0];
    expect((sql as TemplateStringsArray).join('?')).toContain('array_remove');
  });
});
