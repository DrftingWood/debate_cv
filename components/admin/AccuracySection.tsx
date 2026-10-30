import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { BarList } from '@/components/ui/BarList';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatRow, StatTile } from '@/components/ui/StatTile';
import { AccuracyTable, type AccuracyTableRow } from '@/components/admin/AccuracyTable';
import { AuditNowButton } from '@/components/admin/AuditNowButton';
import { TabLink } from '@/components/admin/TabLink';
import type { AccuracyOverview, OpenQuestion } from '@/lib/admin/accuracy';
import { relativeTime } from '@/lib/utils/relativeTime';

const count = (n: number) => n.toLocaleString('en-GB');
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

/** The ledger rows, with every time in words against the page's clock. */
export function toAccuracyRows(lowest: AccuracyOverview['lowest'], now: Date): AccuracyTableRow[] {
  return lowest.map((r) => ({
    id: r.id,
    name: r.name,
    tabUrl: r.tabUrl,
    score: r.score,
    band: r.band,
    failed: r.failed.map((f) => f.label),
    suggested: r.suggested,
    usersAffected: r.usersAffected,
    audited: { text: relativeTime(r.computedAt, now), iso: r.computedAt.toISOString() },
  }));
}

/**
 * "Data accuracy": how far the stored tabs can be trusted, as hints for
 * partial re-scrapes (spec, "Admin view"). A server component: the read
 * model comes with the rest of the page, and the client parts (the table's
 * fold, the two buttons) get rows that are ready to show.
 */
export function AccuracySection({ overview, now }: { overview: AccuracyOverview; now: Date }) {
  const o = overview;
  return (
    <section aria-labelledby="data-accuracy" className="space-y-stack rounded-lg border p-panel">
      <div className="flex flex-wrap items-start justify-between gap-tight">
        <div>
          <h2 id="data-accuracy" className="font-display text-h3 font-medium text-ink">
            Data accuracy
          </h2>
          <p className="mt-hair max-w-prose text-body text-ink-soft">
            Logic checks over each tournament&rsquo;s rounds, outrounds and panels, less points for
            open user reports. A low score is a hint that part of the tab needs re-scraping.
          </p>
        </div>
        {o.n > 0 ? <AuditNowButton /> : null}
      </div>

      {o.n === 0 ? (
        <EmptyState
          title="No tournaments audited yet"
          description="The cron audits tournaments in batches. Audit now checks the next batch straight away."
          action={<AuditNowButton />}
          headingLevel={3}
        />
      ) : (
        <>
          <AccuracyTiles overview={o} />
          <OpenQuestions questions={o.openQuestions} audited={o.n} />
          <FailingChecks overview={o} />
          <div className="space-y-inline">
            <h3 className="font-display text-h4 font-medium text-ink">Lowest scores</h3>
            {o.n > o.lowest.length ? (
              <p className="text-caption text-ink-soft">
                The {count(o.lowest.length)} lowest of {plural(o.n, 'audited tournament')}.
              </p>
            ) : null}
            <AccuracyTable rows={toAccuracyRows(o.lowest, now)} />
          </div>
        </>
      )}
    </section>
  );
}

function AccuracyTiles({ overview: o }: { overview: AccuracyOverview }) {
  return (
    <StatRow columns={4}>
      <StatTile
        label="Accuracy score"
        value={o.weighted ?? 0}
        hint={`across ${plural(o.n, 'tournament')} · ${count(o.onCvs)} on users' CVs`}
      />
      <StatTile label="Unweighted" value={o.unweighted ?? 0} hint="every tournament counts once" />
      <StatTile
        label="Good / Check / Re-scrape"
        value={`${count(o.bands.good)} / ${count(o.bands.check)} / ${count(o.bands.rescrape)}`}
        hint="90 and above · 70–89 · below 70"
      />
      <StatTile
        label="Not audited in 24 h"
        value={count(o.stale)}
        hint={`of ${plural(o.tournaments, 'tournament')}`}
      />
    </StatRow>
  );
}

function FailingChecks({ overview: o }: { overview: AccuracyOverview }) {
  const items = o.failingByCheck.map((c) => ({ label: c.label, value: c.count }));
  return (
    <div className="space-y-tight">
      <h3 className="font-display text-h4 font-medium text-ink">Tournaments failing each check</h3>
      {items.length === 0 ? (
        <p className="text-ui text-ink-soft">
          None of the {plural(o.n, 'audited tournament')} fails a check.
        </p>
      ) : (
        <>
          {/* The sample beside the bars (UX-35). */}
          <p className="text-caption text-ink-soft">Out of {plural(o.n, 'audited tournament')}</p>
          <BarList items={items} labelWidth="9rem" className="max-w-prose" />
        </>
      )}
    </div>
  );
}

/**
 * Rules the checks rely on that the owner has not settled (ruling 9), each
 * with the tournaments it decided, so the cost of either answer is visible
 * before the ruling.
 */
function OpenQuestions({ questions, audited }: { questions: OpenQuestion[]; audited: number }) {
  return (
    // The id is the target of the "Open question" links on each tournament's
    // accuracy checks (/admin#open-questions).
    <div id="open-questions" className="scroll-mt-group space-y-tight">
      <h3 className="font-display text-h4 font-medium text-ink">Open questions</h3>
      {questions.length === 0 ? (
        <p className="text-ui text-ink-soft">Every rule the checks use is settled.</p>
      ) : (
        <ul className="space-y-tight">
          {questions.map((q) => (
            <li key={q.code} className="panel space-y-inline p-stack">
              <div className="flex flex-wrap items-baseline justify-between gap-inline">
                <h4 className="text-ui font-medium text-ink">{q.title}</h4>
                <Badge variant="warning">{q.status}</Badge>
              </div>
              <p className="max-w-prose text-body text-ink-soft">{q.rule}</p>
              <QuestionTournaments question={q} audited={audited} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuestionTournaments({
  question: q,
  audited,
}: {
  question: OpenQuestion;
  audited: number;
}) {
  if (q.count === 0) {
    return (
      <p className="text-caption text-ink-soft">
        It has not decided any of the {plural(audited, 'audited tournament')} yet.
      </p>
    );
  }
  return (
    <>
      <p className="text-caption text-ink-soft">
        Decided <span className="num text-ink">{count(q.count)}</span> of{' '}
        {plural(audited, 'audited tournament')}
        {q.count > q.tournaments.length
          ? `; the ${count(q.tournaments.length)} lowest-scoring are listed`
          : ''}
        .
      </p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {q.tournaments.map((t) => (
          <li
            key={t.id}
            className="flex items-baseline justify-between gap-tight px-tight py-inline"
          >
            <Link
              href={`/admin/tournaments/${t.id}`}
              className="min-w-0 wrap-break-word text-ui text-ink underline-offset-4 hover:underline"
            >
              {t.name}
            </Link>
            <TabLink
              url={t.tabUrl}
              text="Tab"
              of={t.name}
              missing="No tab"
              className="shrink-0 text-caption"
            />
          </li>
        ))}
      </ul>
    </>
  );
}
