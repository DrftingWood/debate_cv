import { prisma } from '@/lib/db';
import { FailedImportsSection } from '@/components/admin/FailedImportsSection';
import { LoadFailed } from '@/components/admin/LoadFailed';
import { getScrapeHealth } from '@/lib/admin/scrapeHealth';
import { loadReviewSet, type Priority } from '@/lib/admin/reviewSet';
import { orNull } from '@/lib/admin/orNull';

/**
 * Failed import jobs. Counted apart from the health read model, whose list is
 * capped at 200: "Retry all n" must state the real number. The review set is
 * read here only for the rows' "Flagged" badge.
 */
export async function ImportsTab({ now }: { now: Date }) {
  const [health, total, reviewSet] = await Promise.all([
    getScrapeHealth().catch(orNull('scrape health')),
    prisma.ingestJob
      .count({ where: { status: { in: ['failed', 'abandoned'] } } })
      .catch(orNull('failed import count')),
    loadReviewSet({ status: 'all' }).catch(orNull('review set')),
  ]);
  if (!health || total === null) {
    return (
      <section aria-labelledby="failed-imports" className="space-y-stack rounded-lg border p-panel">
        <h2 id="failed-imports" className="font-display text-h3 font-medium text-ink">
          Failed imports
        </h2>
        <LoadFailed what="the failed imports" />
      </section>
    );
  }
  const flagged = new Map<string, Priority>(
    (reviewSet ?? [])
      .filter((f) => f.source === 'import' && f.status === 'open')
      .map((f) => [f.sourceId, f.priority]),
  );
  return (
    <FailedImportsSection jobs={health.failedJobs} total={total} now={now} flagged={flagged} />
  );
}
