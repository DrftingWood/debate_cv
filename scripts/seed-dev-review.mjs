// Dev data for the part-2 admin ledgers (data accuracy, Tasks 5c and 5d):
// failed imports in every Tab state, the review set, CV reports and parser
// warnings. Called from seed-dev-scrape-health.mjs once the tournaments and
// their scrape pieces exist, against the LOCAL database the main seed has
// already checked. seed-dev-data.mjs is at the 800-line cap, so this lives
// apart from it.
//
// The tournament audits are not written here: they are computed by the app
// (POST /api/admin/audit { stale: true }, or "Audit now" on /admin), so the
// scores shown are the engine's, not numbers made up for the seed.

const MIN = 60 * 1000;
const ago = (minutes) => new Date(Date.now() - minutes * MIN);

/**
 * One failed import per Tab state. Delhi stored every page (✓ Loaded); Hart
 * House lost its speaker tab and R2 (? Partly, the two pages listed);
 * brokenopen2025 is seeded by the scrape-health module and has no row (✗ Not
 * loaded); twinopen2024 has two stored rows on one host and slug, and
 * bare.calicotab.com names no slug at all (both ? Check). Each URL is a
 * private one, as a user's import would be, so the pages show none of them.
 */
async function seedFailedImports(prisma, userId) {
  // Two stored rows that share an address: what makes "? Check".
  for (const [i, url] of [
    'https://twinopen2024.calicotab.com/twin/',
    'https://twinopen2024.calicotab.com/twin/privateurls/tw1nK3y/',
  ].entries()) {
    await prisma.tournament.create({
      data: {
        name: i === 0 ? 'Twin Open 2024' : 'Twin Open 2024 (second import)',
        year: 2024,
        format: 'British Parliamentary',
        sourceUrlRaw: url,
        fingerprint: `seed-twinopen2024-${i}`,
        scrapedAt: ago(600),
      },
    });
  }
  const jobs = [
    ['https://delhi2025.calicotab.com/t/privateurls/d3lh1K3y/', 'HTTP 504 from the draw page', 3],
    [
      'https://harthouse2023.calicotab.com/t/privateurls/h4rtK3y/',
      'HTTP 503 from the speaker tab',
      4,
    ],
    [
      'https://twinopen2024.calicotab.com/twin/privateurls/m1neK3y/',
      'Tournament nav could not be read (HTTP 502)',
      3,
    ],
    ['https://bare.calicotab.com/privateurls/n0slugK3y/', 'Timed out after 15000ms', 2],
  ];
  const ids = [];
  for (const [i, [url, lastError, attempts]] of jobs.entries()) {
    const job = await prisma.ingestJob.create({
      data: {
        userId,
        url,
        status: i === 3 ? 'abandoned' : 'failed',
        attempts,
        lastError,
        scheduledAt: ago(240 + i * 10),
        finishedAt: ago(120 + i * 10),
      },
    });
    ids.push(job.id);
  }
  return ids;
}

const REPORT_COMMENTS = [
  'My R2 speaks are missing from the round ledger.',
  'Partner is wrong in the semi. It was Priya, not Arjun.',
  `I pasted my link to help: https://harthouse2023.calicotab.com/t/privateurls/h4rtK3y/ — the speaker tab is empty.`,
  '=HYPERLINK("http://example.com","click") came from a spreadsheet, please ignore the formula.',
  'The speaker average on this tournament reads 74.2, but the tab shows 76.1. '.repeat(4).trim(),
];

/**
 * Twenty-seven CV reports from the seeded user, so the open filter has two
 * pages: categories in every combination the suggestion logic reads, a
 * comment with a pasted private URL (scrubbed on the page), one that starts
 * with "=" (kept as text in the CSV) and one long enough for "Show more".
 */
async function seedCvReports(prisma, userId) {
  const stored = await prisma.tournament.findMany({
    where: { fingerprint: { in: ['seed-harthouse2023', 'seed-delhi2025', 'seed-wudc2024'] } },
    select: { id: true, fingerprint: true },
  });
  const byFp = Object.fromEntries(stored.map((t) => [t.fingerprint, t.id.toString()]));
  const plan = [
    ['seed-harthouse2023', ['wrong_speaker_rank', 'wrong_speaker_average']],
    ['seed-delhi2025', ['wrong_teammate']],
    ['seed-wudc2024', ['wrong_outround', 'wrong_team_result']],
    ['seed-harthouse2023', ['other']],
    ['seed-delhi2025', ['wrong_identity']],
  ];
  const statuses = [
    ...Array(22).fill('open'),
    'acknowledged',
    'acknowledged',
    'fixed',
    'fixed',
    'wont_fix',
  ];
  const ids = [];
  for (const [i, status] of statuses.entries()) {
    const [fp, categories] = plan[i % plan.length];
    const resolved = status === 'fixed' || status === 'wont_fix';
    const report = await prisma.cvErrorReport.create({
      data: {
        userId,
        tournamentIds: byFp[fp] ? [byFp[fp]] : [],
        categories,
        comment: REPORT_COMMENTS[i % REPORT_COMMENTS.length],
        status,
        createdAt: ago(30 + i * 45),
        resolvedAt: resolved ? ago(20 + i) : null,
      },
    });
    ids.push(report.id);
  }
  return ids;
}

/**
 * Parser runs with warnings over the last few days: 23 headlines, so the
 * ledger has two pages, the busiest raised by three tournaments' pages. The
 * page URLs are private ones and one warning quotes its URL, as real
 * diagnostics do; neither may reach the page.
 */
async function seedParserWarnings(prisma) {
  const hosts = ['harthouse2023', 'delhi2025', 'wudc2024', 'twinopen2024'];
  const pageUrl = (host, i) =>
    host === 'twinopen2024'
      ? `https://twinopen2024.calicotab.com/twin/privateurls/w4rnK3y/tab/speaker/?p=${i}`
      : `https://${host}.calicotab.com/t/privateurls/w4rnK3y${i}/tab/speaker/`;
  const headlines = Array.from({ length: 23 }, (_, i) =>
    i === 0
      ? 'Speaker tab has no totals column'
      : i === 1
        ? 'Round results table had an unexpected column'
        : `Seed warning ${String(i + 1).padStart(2, '0')}: unmatched row in the team tab`,
  );
  let n = 0;
  for (const [i, headline] of headlines.entries()) {
    // The two busiest groups come from several tournaments' pages.
    const runHosts = i === 0 ? hosts : i === 1 ? hosts.slice(0, 2) : [hosts[i % 3]];
    for (const host of runHosts) {
      n += 1;
      const url = pageUrl(host, n);
      const doc = await prisma.sourceDocument.create({
        data: { url, status: 200, contentHash: `seed-${n}`, contentLength: 1000 + n },
      });
      await prisma.parserRun.create({
        data: {
          sourceDocumentId: doc.id,
          parserName: i % 2 === 0 ? 'parseTabs' : 'parseRounds',
          parserVersion: 'seed',
          success: true,
          warnings: [`${headline} — at ${url}`],
          createdAt: ago(60 * (i + 1) + n),
        },
      });
    }
  }
}

/**
 * The review set: one flag of each source and each priority, and one done,
 * so "Show done", Mark done, Reopen and both exports have rows to act on.
 */
async function seedReviewFlags(prisma, { jobIds, reportIds }) {
  const hart = await prisma.tournament.findFirst({
    where: { fingerprint: 'seed-harthouse2023' },
    select: { id: true },
  });
  const flags = [
    {
      source: 'import',
      sourceId: jobIds[1],
      url: 'https://harthouse2023.calicotab.com/t/',
      tournamentId: hart?.id ?? null,
      priority: 'high',
      comment: 'Speaker tab and R2 keep failing; check the 503s.',
    },
    {
      source: 'cv_report',
      sourceId: reportIds[0],
      url: 'https://harthouse2023.calicotab.com/t/',
      tournamentId: hart?.id ?? null,
      priority: 'medium',
      comment: 'Same tournament as the failed import: re-scrape R2 first.',
    },
    {
      source: 'parser_warning',
      sourceId: 'parseTabs|Speaker tab has no totals column',
      url: '',
      tournamentId: null,
      priority: 'low',
      comment: 'Four tabs say this; probably a Tabbycat version without totals.',
    },
    {
      source: 'import',
      sourceId: jobIds[2],
      url: 'https://twinopen2024.calicotab.com/twin/',
      tournamentId: null,
      priority: 'medium',
      comment: 'Two stored rows share this address; merge them.',
      status: 'done',
    },
  ];
  for (const [i, f] of flags.entries()) {
    await prisma.reviewFlag.create({
      data: { ...f, createdBy: 'maya@example.com', createdAt: ago(90 - i * 10) },
    });
  }
}

/** Everything above, after clearing what an earlier run of this module wrote. */
export async function seedReview(prisma, userId) {
  await prisma.reviewFlag.deleteMany({});
  await prisma.parserRun.deleteMany({});
  await prisma.sourceDocument.deleteMany({});
  const jobIds = await seedFailedImports(prisma, userId);
  const reportIds = await seedCvReports(prisma, userId);
  await seedParserWarnings(prisma);
  await seedReviewFlags(prisma, { jobIds, reportIds });
}
