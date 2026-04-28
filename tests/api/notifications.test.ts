import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authMock,
  prismaMock,
  resetPrismaMock,
  fakeSession,
  expectUnauthorized,
  readJson,
} from '../setup/api-test-utils';

vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => ({ auth: m.authMock })));
vi.mock('@/lib/db', () => import('../setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { GET } = await import('@/app/api/notifications/route');
const { POST: markRead } = await import('@/app/api/notifications/mark-read/route');

beforeEach(() => {
  authMock.mockReset();
  resetPrismaMock();
});

describe('GET /api/notifications', () => {
  it('returns 401 when unauthenticated', () => expectUnauthorized(() => GET()));

  it('returns the user notifications list with unread count', async () => {
    authMock.mockResolvedValue(fakeSession('user-1'));
    prismaMock.notification.findMany.mockResolvedValue([
      {
        id: 'n1',
        kind: 'ingest_done',
        title: 'Your CV is ready',
        body: null,
        href: '/cv',
        readAt: null,
        createdAt: new Date('2026-04-29T10:00:00Z'),
      },
    ]);
    prismaMock.notification.count.mockResolvedValue(1);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await readJson<{
      unreadCount: number;
      notifications: Array<{ id: string; readAt: string | null }>;
    }>(res);
    expect(data.unreadCount).toBe(1);
    expect(data.notifications).toHaveLength(1);
    expect(data.notifications[0]!.id).toBe('n1');
    expect(data.notifications[0]!.readAt).toBeNull();
  });

  it('scopes the notifications query to the current user', async () => {
    authMock.mockResolvedValue(fakeSession('user-2'));
    prismaMock.notification.findMany.mockResolvedValue([]);
    prismaMock.notification.count.mockResolvedValue(0);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(prismaMock.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-2' } }),
    );
    expect(prismaMock.notification.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-2', readAt: null } }),
    );
    // Response shape sanity: scoping is the security guarantee, but the
    // payload also has to match the contract the bell expects.
    const data = await readJson<{
      unreadCount: number;
      notifications: unknown[];
    }>(res);
    expect(data.unreadCount).toBe(0);
    expect(Array.isArray(data.notifications)).toBe(true);
    expect(data.notifications).toHaveLength(0);
  });
});

describe('POST /api/notifications/mark-read', () => {
  it('returns 401 when unauthenticated', () => expectUnauthorized(() => markRead()));

  it('marks every unread notification as read for the current user', async () => {
    authMock.mockResolvedValue(fakeSession('user-3'));
    prismaMock.notification.updateMany.mockResolvedValue({ count: 4 });

    const res = await markRead();
    expect(res.status).toBe(200);
    const data = await readJson<{ markedRead: number }>(res);
    expect(data.markedRead).toBe(4);
    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-3', readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
});
