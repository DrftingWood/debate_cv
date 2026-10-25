import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// B6: Tabbycat API responses are kept as SourceDocuments so API-sourced tabs
// stay in the re-derivation archive. The prisma upsert is the observable
// effect; the DB itself is not under test.
const upsert = vi.fn(async ({ create }) => ({ id: 'doc-1', ...create }));
vi.mock('@/lib/db', () => ({ prisma: { sourceDocument: { upsert: (a: unknown) => upsert(a as never) } } }));

const URL_TEAMS = 'https://wudc2024.calicotab.com/api/v1/tournaments/wudc/teams';

function respond(body: string, status = 200) {
  return vi.fn(async () => new Response(body, { status }));
}

describe('withApiSnapshots', () => {
  beforeEach(() => {
    upsert.mockClear();
  });

  test('a 200 JSON list is stored under its endpoint URL, body as received', async () => {
    const body = '[{"id":1,"url":"https://x/teams/1"}]';
    const { withApiSnapshots } = await import('@/lib/calicotab/fetch');
    const res = await withApiSnapshots(respond(body))(URL_TEAMS);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 1, url: 'https://x/teams/1' }]);
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0] as unknown as {
      where: { url_contentHash: { url: string; contentHash: string } };
      create: { status: number; contentLength: number; bodyGzip: Buffer };
    };
    expect(arg.where.url_contentHash.url).toBe(URL_TEAMS);
    expect(arg.create.status).toBe(200);
    expect(arg.create.contentLength).toBe(Buffer.byteLength(body));
    expect(gunzipSync(arg.create.bodyGzip).toString('utf8')).toBe(body);
  });

  test('identical bodies hash identically, so a re-fetch dedups onto one row', async () => {
    const { withApiSnapshots } = await import('@/lib/calicotab/fetch');
    await withApiSnapshots(respond('[1,2]'))(URL_TEAMS);
    await withApiSnapshots(respond('[1,2]'))(URL_TEAMS);
    const keys = upsert.mock.calls.map(
      (c) => (c[0] as unknown as { where: { url_contentHash: unknown } }).where.url_contentHash,
    );
    expect(keys[0]).toEqual(keys[1]);
  });

  test('non-200 responses are not stored and pass their status through', async () => {
    const { withApiSnapshots } = await import('@/lib/calicotab/fetch');
    const res = await withApiSnapshots(respond('{"detail":"no"}', 401))(URL_TEAMS);
    expect(res.status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });

  test('a 200 that is not JSON (Cloudflare challenge, 404 template) is not stored', async () => {
    const { withApiSnapshots } = await import('@/lib/calicotab/fetch');
    const res = await withApiSnapshots(respond('<html>Just a moment…</html>'))(URL_TEAMS);
    expect(upsert).not.toHaveBeenCalled();
    // getList in tabbycatApi.ts relies on json() rejecting to fall back to HTML.
    await expect(res.json()).rejects.toThrow();
  });

  test('a failed snapshot write does not fail the API read', async () => {
    upsert.mockRejectedValueOnce(new Error('connection reset'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { withApiSnapshots } = await import('@/lib/calicotab/fetch');
    const res = await withApiSnapshots(respond('[]'))(URL_TEAMS);
    expect(await res.json()).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('an opted-out speaker never has a real name in the stored body', async () => {
    // Tabbycat nulls these itself (WUDC 2024); an install that doesn't must
    // not leave more in storage than the public tab showed.
    const body = JSON.stringify([
      { url: 's/1', name: 'Visible Person', anonymous: false },
      { url: 's/2', name: 'Hidden Person', last_name: 'Person', anonymous: true },
      { url: 't/1', speakers: [{ url: 's/3', name: 'Also Hidden', anonymous: true }] },
    ]);
    const { withApiSnapshots } = await import('@/lib/calicotab/fetch');
    const res = await withApiSnapshots(respond(body))(URL_TEAMS);
    const stored = gunzipSync(
      (upsert.mock.calls[0][0] as unknown as { create: { bodyGzip: Buffer } }).create.bodyGzip,
    ).toString('utf8');
    expect(stored).toContain('Visible Person');
    expect(stored).not.toContain('Hidden');
    // What the mappers read is unchanged: speakerDisplayName ignores the name on anonymous rows.
    expect(await res.json()).toEqual(JSON.parse(body));
  });

  test('a body that is already redacted is stored byte-for-byte', async () => {
    const body = '[{"url":"s/2","name":null,"last_name":null,"anonymous":true}]';
    const { withApiSnapshots } = await import('@/lib/calicotab/fetch');
    await withApiSnapshots(respond(body))(URL_TEAMS);
    const create = (upsert.mock.calls[0][0] as unknown as { create: { bodyGzip: Buffer } }).create;
    expect(gunzipSync(create.bodyGzip).toString('utf8')).toBe(body);
  });

  test('a body read that fails surfaces through json(), as res.json() did before', async () => {
    const { withApiSnapshots } = await import('@/lib/calicotab/fetch');
    const broken = {
      status: 200,
      text: () => Promise.reject(new Error('The operation was aborted due to timeout')),
    } as unknown as Response;
    const res = await withApiSnapshots(async () => broken)(URL_TEAMS);
    expect(res.status).toBe(200);
    await expect(res.json()).rejects.toThrow('timeout');
    expect(upsert).not.toHaveBeenCalled();
  });

  test('a hung snapshot write holds the API read for at most the write budget', async () => {
    vi.useFakeTimers();
    try {
      upsert.mockImplementationOnce(() => new Promise(() => {}));
      const { withApiSnapshots } = await import('@/lib/calicotab/fetch');
      let done = false;
      const pending = withApiSnapshots(respond('[]'))(URL_TEAMS).then((r) => {
        done = true;
        return r;
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1_500);
      expect(done).toBe(true);
      expect(await (await pending).json()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test('through fetchTabsFromApi, every endpoint read is snapshotted', async () => {
    // A tournament whose preferences keep both tabs private: one request,
    // one snapshot — the release settings themselves are worth keeping.
    const prefs = JSON.stringify([
      { identifier: 'tab_release__team_tab_released', value: false },
      { identifier: 'tab_release__speaker_tab_released', value: false },
    ]);
    const { withApiSnapshots } = await import('@/lib/calicotab/fetch');
    const { fetchTabsFromApi } = await import('@/lib/calicotab/tabbycatApi');
    const result = await fetchTabsFromApi(
      'https://wudc2024.calicotab.com/wudc/privateurls/abc/',
      withApiSnapshots(respond(prefs)),
    );
    expect(result.teams.source).toBe('private');
    expect(upsert).toHaveBeenCalledTimes(1);
    const url = (upsert.mock.calls[0][0] as unknown as { where: { url_contentHash: { url: string } } }).where
      .url_contentHash.url;
    expect(url).toBe('https://wudc2024.calicotab.com/api/v1/tournaments/wudc/preferences');
  });
});
