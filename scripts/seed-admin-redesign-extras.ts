/**
 * The second half of scripts/seed-admin-redesign.ts, apart from it for the
 * 800-line cap: failed imports (unstored, partly loaded, ambiguous, and one
 * whose tournament is stored), CV reports in several states, and parser
 * warnings, both informational notes and real problems. It receives the
 * Prisma client the main script made AFTER its localhost check, and imports
 * nothing that connects to a database.
 */
import type { PrismaClient } from '@prisma/client';

const MIN = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN);

export async function seedImportsReportsWarnings(
  prisma: PrismaClient,
  userId: string,
  ids: Record<string, bigint>,
  CURRENT: string,
): Promise<{ jobIds: string[]; reportIds: string[] }> {
  // ── Failed imports: unstored, partly loaded, covered by a stored copy ──
  const jobs: Array<[string, string, number, 'failed' | 'abandoned']> = [
    [
      'https://brokenopen2025.calicotab.com/b/privateurls/br0kenK3y/',
      'HTTP 404 from the tournament nav',
      3,
      'failed',
    ],
    [
      'https://delhi2025.calicotab.com/t/privateurls/d3lh1K3y/',
      'HTTP 504 from the draw page',
      3,
      'failed',
    ],
    [
      'https://twinopen2024.calicotab.com/twin/privateurls/m1neK3y/',
      'Tournament nav could not be read (HTTP 502)',
      3,
      'failed',
    ],
    [
      'https://bare.calicotab.com/privateurls/n0slugK3y/',
      'Timed out after 15000ms',
      2,
      'abandoned',
    ],
    // The stored-tournament import failure: Seedville is stored, so this is "covered".
    [
      'https://seedville2026.calicotab.com/seedville2026/privateurls/ownK3y/',
      'HTTP 503 from the speaker tab',
      4,
      'failed',
    ],
  ];
  const jobIds: string[] = [];
  for (const [i, [url, lastError, attempts, status]] of jobs.entries()) {
    const j = await prisma.ingestJob.create({
      data: {
        userId: userId,
        url,
        status,
        attempts,
        lastError,
        scheduledAt: ago(240 + i * 10),
        finishedAt: ago(120 + i * 10),
      },
    });
    jobIds.push(j.id);
  }

  // ── CV reports in several states ───────────────────────────────────────
  const reportPlan: Array<[string, string[], string, 'open' | 'acknowledged' | 'fixed']> = [
    ['midlands2025', ['wrong_team_result'], 'Our R3 result is missing from the ledger.', 'open'],
    [
      'harthouse2023',
      ['wrong_speaker_rank', 'wrong_speaker_average'],
      'Speaker tab is empty, see https://harthouse2023.calicotab.com/t/privateurls/h4rtK3y/',
      'open',
    ],
    ['harbour2025', ['wrong_teammate'], 'My partner is listed wrongly.', 'acknowledged'],
    ['lakeside2024', ['other'], 'Looks fine now.', 'fixed'],
  ];
  const reportIds: string[] = [];
  for (const [i, [slug, categories, comment, status]] of reportPlan.entries()) {
    const r = await prisma.cvErrorReport.create({
      data: {
        userId: userId,
        tournamentIds: [String(ids[slug])],
        categories,
        comment,
        status,
        createdAt: ago(300 + i * 90),
        resolvedAt: status === 'fixed' ? ago(30) : null,
      },
    });
    reportIds.push(r.id);
  }

  // ── Parser warnings: informational notes and real problems ─────────────
  const headlines: Array<[string, string, string]> = [
    ['parseNav', 'timing: competition likely finished', 'seedville2026'],
    ['parseNav', 'nav: breakTabs not found (optional)', 'harbour2025'],
    ['parseTabs', 'parse: round 3 → 0 results', 'midlands2025'],
    ['parseTabs', 'fetch: speaker HTTP 503', 'harthouse2023'],
    ['parseNav', 'nav: resultsRounds not found', 'lakeside2024'],
  ];
  let n = 0;
  for (const [parserName, headline, slug] of headlines) {
    for (let k = 0; k < (headline.startsWith('parse:') ? 3 : 1); k++) {
      n += 1;
      const url = `https://${slug}.calicotab.com/${slug}/tab/speaker/?p=${n}`;
      const doc = await prisma.sourceDocument.create({
        data: { url, status: 200, contentHash: `r7-${n}`, contentLength: 1000 + n },
      });
      await prisma.parserRun.create({
        data: {
          sourceDocumentId: doc.id,
          parserName,
          parserVersion: CURRENT,
          success: true,
          warnings: [`${headline} - at ${url}`],
          createdAt: ago(60 * n),
        },
      });
    }
  }

  return { jobIds, reportIds };
}
