import { vi } from 'vitest';

/**
 * Test utilities for API route tests. Routes are pure server functions
 * — we import the handler, hand it a Request, and assert on the
 * Response. Vitest's `vi.mock` swaps `@/lib/auth` and `@/lib/db` for
 * shared mocks below so handlers can be tested without a database or
 * an OAuth session.
 *
 * Usage in a test file:
 *   vi.mock('@/lib/auth', () => import('../setup/api-test-utils').then((m) => m.authMockModule));
 *   vi.mock('@/lib/db', () => import('../setup/api-test-utils').then((m) => m.dbMockModule));
 *
 *   import { authMock, prismaMock, jsonRequest } from '../setup/api-test-utils';
 *
 *   beforeEach(() => { vi.clearAllMocks(); });
 *
 *   it('handles unauthorized', async () => {
 *     authMock.mockResolvedValue(null);
 *     const res = await POST(jsonRequest('/api/foo', { body: {} }));
 *     expect(res.status).toBe(401);
 *   });
 */

// ── auth mock ───────────────────────────────────────────────────────
export const authMock = vi.fn();
export const authMockModule = { auth: authMock };

/** Build a fake session shape that matches what NextAuth returns. */
export function fakeSession(userId: string, email = 'test@example.com') {
  return { user: { id: userId, email, name: 'Test User', image: null } };
}

// ── prisma mock ─────────────────────────────────────────────────────
// Hand-rolled deep mock of the prisma client. Each model has the
// methods our handlers actually call. New methods can be added as
// tests need them — tests will fail loudly with a clear "is not a
// function" if a method is missing.
function makeModelMock() {
  return {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    aggregate: vi.fn(),
  };
}

export const prismaMock = {
  user: makeModelMock(),
  account: makeModelMock(),
  session: makeModelMock(),
  gmailToken: makeModelMock(),
  discoveredUrl: makeModelMock(),
  ingestJob: makeModelMock(),
  tournament: makeModelMock(),
  tournamentParticipant: makeModelMock(),
  participantRole: makeModelMock(),
  speakerRoundScore: makeModelMock(),
  teamResult: makeModelMock(),
  eliminationResult: makeModelMock(),
  judgeAssignment: makeModelMock(),
  person: makeModelMock(),
  personRejection: makeModelMock(),
  cvErrorReport: makeModelMock(),
  notification: makeModelMock(),
  sourceDocument: makeModelMock(),
  parserRun: makeModelMock(),
  $transaction: vi.fn(async (arg: unknown) => {
    // Two shapes:
    //   prisma.$transaction([...promises]) → resolves all in array
    //   prisma.$transaction(async (tx) => ...) → invokes callback with tx (we
    //     pass the same prismaMock so model methods proxy through)
    if (Array.isArray(arg)) return Promise.all(arg as unknown[]);
    if (typeof arg === 'function') {
      return (arg as (tx: typeof prismaMock) => unknown)(prismaMock);
    }
    return undefined;
  }),
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
};

export const dbMockModule = { prisma: prismaMock };

/** Reset every mocked method on every prisma model + $transaction. */
export function resetPrismaMock() {
  for (const key of Object.keys(prismaMock) as Array<keyof typeof prismaMock>) {
    const value = prismaMock[key];
    if (typeof value === 'function') {
      (value as ReturnType<typeof vi.fn>).mockReset();
    } else if (value && typeof value === 'object') {
      for (const m of Object.values(value)) {
        if (typeof m === 'function') (m as ReturnType<typeof vi.fn>).mockReset();
      }
    }
  }
  // Re-install the $transaction default behaviour after reset.
  prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as unknown[]);
    if (typeof arg === 'function') {
      return (arg as (tx: typeof prismaMock) => unknown)(prismaMock);
    }
    return undefined;
  });
}

// ── request helpers ─────────────────────────────────────────────────

/** Build a JSON Request the way Next route handlers expect. */
export function jsonRequest(
  url: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Request {
  return new Request(`http://test${url}`, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/** Read a Response body as JSON. */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  return text.length > 0 ? (JSON.parse(text) as T) : (undefined as unknown as T);
}
