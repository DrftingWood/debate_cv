import { beforeEach, describe, expect, it, vi } from 'vitest';

// Review of a00d4c0: without JavaScript the search box posts its text, and
// this answers 303 to the list page with a q safe to put in an address.

const requireAdminMock = vi.fn();
vi.mock('@/lib/admin', () => ({ requireAdmin: requireAdminMock }));

const { POST } = await import('@/app/api/admin/lookup/search/route');

const KEY = 'k3yS3cr3t';

const submit = (q?: string) => {
  const body = new URLSearchParams();
  if (q !== undefined) body.set('q', q);
  return POST(
    new Request('http://x/api/admin/lookup/search', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }),
  );
};

const target = (res: Response) => {
  const loc = new URL(res.headers.get('location')!);
  return `${loc.pathname}${loc.search}`;
};

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue('admin@example.com');
});

describe('POST /api/admin/lookup/search', () => {
  it('303s a private URL to its public form, with or without its scheme', async () => {
    const PUBLIC_Q = `/admin/tournaments?q=${encodeURIComponent('https://oxiv.calicotab.com/oxiv2025/')}`;
    for (const q of [
      `https://oxiv.calicotab.com/oxiv2025/privateurls/${KEY}/`,
      `oxiv.calicotab.com/oxiv2025/privateurls/${KEY}/`,
    ]) {
      const res = await submit(q);
      expect(res.status).toBe(303);
      expect(target(res)).toBe(PUBLIC_Q);
      expect(res.headers.get('location')).not.toContain(KEY);
    }
  });

  it('303s a name or a public URL as typed, and nothing to the bare list', async () => {
    expect(target(await submit(' Oxford IV '))).toBe('/admin/tournaments?q=Oxford%20IV');
    expect(target(await submit(''))).toBe('/admin/tournaments');
    expect(target(await submit())).toBe('/admin/tournaments');
  });

  it('sends anyone but an admin home', async () => {
    requireAdminMock.mockRejectedValue(Object.assign(new Error('x'), { status: 403 }));
    const res = await submit(`https://oxiv.calicotab.com/oxiv2025/privateurls/${KEY}/`);
    expect(res.status).toBe(303);
    expect(target(res)).toBe('/');
  });
});
