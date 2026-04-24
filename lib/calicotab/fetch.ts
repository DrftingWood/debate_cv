const USER_AGENT =
  'debate-cv/1.0 (+https://github.com/DrftingWood/debate_cv)';

const lastRequestByHost = new Map<string, number>();
const MIN_INTERVAL_MS = 750;

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchHtml(url: string): Promise<string> {
  const host = new URL(url).host;
  const last = lastRequestByHost.get(host) ?? 0;
  const gap = Date.now() - last;
  if (gap < MIN_INTERVAL_MS) await wait(MIN_INTERVAL_MS - gap);
  lastRequestByHost.set(host, Date.now());

  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`fetch ${url} returned ${res.status}`);
  return await res.text();
}
