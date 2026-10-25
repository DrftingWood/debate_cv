// Smoke test for the pre-scrape: from THIS machine (a GitHub Actions runner),
// can we read the tournament sites at all? No database, no secrets, no writes.
//
// Datacenter IPs are sometimes refused by sites behind Cloudflare. Vercel's
// are not (ingest works from there), but a GitHub runner is a different
// network, so check before committing hours of a load to it.
//
//   node scripts/prescrape/smoke.mjs [list-file]
//
// Exits 1 when half or more of the sampled sites refuse us.
import { readFileSync } from 'node:fs';

const list = process.argv[2] ?? 'scripts/prescrape/stage-a-2023-2025.txt';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const urls = readFileSync(list, 'utf8')
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

// 12 entries spread evenly over the list, one per host.
const seen = new Set();
const sample = [];
const step = Math.max(1, Math.floor(urls.length / 12));
for (let i = 0; i < urls.length && sample.length < 12; i += step) {
  const host = new URL(urls[i]).hostname;
  if (seen.has(host)) continue;
  seen.add(host);
  sample.push(urls[i]);
}

let refused = 0;
let ok = 0;
for (const raw of sample) {
  const u = new URL(raw);
  const slug = u.pathname.split('/').filter(Boolean)[0];
  const targets = [`${u.origin}/${slug ? slug + '/' : ''}`];
  if (slug) targets.push(`${u.origin}/api/v1/tournaments/${slug}`);
  for (const target of targets) {
    const t0 = Date.now();
    let status;
    try {
      const res = await fetch(target, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
      status = res.status;
    } catch (e) {
      status = `error: ${e.name}`;
    }
    const bad = status === 403 || status === 429 || status === 503 || typeof status === 'string';
    if (bad) refused += 1;
    else ok += 1;
    console.log(`${String(status).padEnd(14)} ${String(Date.now() - t0).padStart(5)} ms  ${target}`);
    await new Promise((r) => setTimeout(r, 800));
  }
}

const total = ok + refused;
console.log(`\n${ok} readable, ${refused} refused or failed, of ${total} requests to ${sample.length} sites`);
if (refused * 2 >= total) {
  console.log('SMOKE FAILED: this network is being refused by the tournament sites.');
  process.exit(1);
}
console.log('smoke ok');
