import { describe, expect, it, vi } from 'vitest';

const list = vi.fn();
const get = vi.fn();
vi.mock('googleapis', () => ({
  google: { gmail: () => ({ users: { messages: { list, get } } }) },
}));

const { extractAllFromGmail } = await import('@/lib/gmail/run');

describe('extractAllFromGmail bounds', () => {
  it('adds after: only when asked, and skips already-read messages', async () => {
    list.mockResolvedValue({ data: { messages: [{ id: 'a' }, { id: 'b' }] } });
    get.mockResolvedValue({ data: { id: 'b', payload: {} } });

    await extractAllFromGmail({} as never, {});
    expect(list.mock.calls[0]![0].q).not.toContain('after:');

    await extractAllFromGmail({} as never, { after: new Date(2026, 0, 5) });
    expect(list.mock.calls[1]![0].q).toContain('after:2026/01/05');

    get.mockClear();
    const res = await extractAllFromGmail({} as never, { skipMessageIds: new Set(['a']) });
    expect(get).toHaveBeenCalledTimes(1);
    expect(res.scanned).toBe(1);
    expect(res.truncated).toBe(false);
  });

  it('reports truncated when the fetch cap or deadline stops it', async () => {
    list.mockResolvedValue({ data: { messages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } });
    get.mockResolvedValue({ data: { id: 'x', payload: {} } });
    expect((await extractAllFromGmail({} as never, { maxFetch: 2 })).truncated).toBe(true);
    expect((await extractAllFromGmail({} as never, { deadline: Date.now() - 1 })).truncated).toBe(
      true,
    );
  });
});
