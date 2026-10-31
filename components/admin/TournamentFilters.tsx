import { useId } from 'react';
import Link from 'next/link';
import { buttonClasses } from '@/components/ui/Button';
import { AuditNowButton } from '@/components/admin/AuditNowButton';
import { BAND_BADGE } from '@/components/admin/bandBadge';
import { cn } from '@/lib/utils/cn';
import { adminTabHref } from '@/lib/admin/adminTabs';
import type { AccuracyOverview } from '@/lib/admin/accuracy';
import { filterParams, type TournamentFilters } from '@/lib/admin/tournamentFilters';
import type { AssumptionCode } from '@/lib/audit/types';

const count = (n: number) => n.toLocaleString('en-GB');

/** The one-line wording of each open question's chip ("Open question: ..."). */
const QUESTION_CHIP: Record<AssumptionCode, string> = {
  no_open_bracket_champion: 'champion when no Open bracket',
};

const BANDS = ['good', 'check', 'rescrape'] as const;

/**
 * The Tournaments tab's filters, as chips: score band, failing check (one per
 * check, the most-failed first), tournaments with marks and the open
 * question. Each chip is a link that toggles its filter in the address, keeps
 * the name search and drops the page, with the chosen ones marked
 * (`aria-current`). The counts are the overview's own, so a chip's number is
 * the length of the list it opens. A server component: nothing here keeps
 * state.
 */
export function TournamentFilterChips({
  overview,
  filters,
  q,
}: {
  overview: AccuracyOverview;
  filters: TournamentFilters;
  q: string;
}) {
  const href = chipHref(filters, q);
  const question = overview.openQuestions[0];
  return (
    <div className="space-y-tight">
      <ChipsIntro stale={overview.stale} of={overview.tournaments} />
      <ChipGroup label="Score band">
        <Chip label="Any band" to={href({ band: null })} on={!filters.band} />
        {BANDS.map((b) => (
          <Chip
            key={b}
            label={BAND_BADGE[b].text}
            n={overview.bands[b]}
            to={href({ band: b })}
            on={filters.band === b}
          />
        ))}
      </ChipGroup>
      {overview.failingByCheck.length > 0 ? (
        <ChipGroup label="Failing check">
          {overview.failingByCheck.map((c) => (
            <Chip
              key={c.code}
              label={c.label}
              n={c.count}
              to={href({ check: c.code })}
              on={filters.check === c.code}
            />
          ))}
        </ChipGroup>
      ) : null}
      <MarksAndRules overview={overview} filters={filters} href={href} />
      {question ? <QuestionRule rule={question.rule} status={question.status} /> : null}
    </div>
  );
}

/** The marks, ignored and open-question chips, one group. */
function MarksAndRules({
  overview,
  filters,
  href,
}: {
  overview: AccuracyOverview;
  filters: TournamentFilters;
  href: ReturnType<typeof chipHref>;
}) {
  const question = overview.openQuestions[0];
  return (
    <ChipGroup label="Marks and rules">
      <Chip
        label="Checked by an admin"
        n={overview.checked}
        to={href({ checked: '1' })}
        on={Boolean(filters.checked)}
      />
      {/* Test and demo tournaments an admin set to ignored: out of the list
            and every score until this chip is chosen. */}
      <Chip
        label="Ignored in admin stats"
        n={overview.ignored}
        to={href({ ignored: '1' })}
        on={Boolean(filters.ignored)}
      />
      {question ? (
        <Chip
          label={`Open question: ${QUESTION_CHIP[question.code]}`}
          n={question.count}
          wrap
          to={href({ question: question.code })}
          on={filters.question === question.code}
        />
      ) : null}
    </ChipGroup>
  );
}

/** What the chips do, with Audit now beside it (it is what fills the counts). */
function ChipsIntro({ stale, of }: { stale: number; of: number }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-tight">
      <div className="space-y-hair">
        <p className="max-w-prose text-body text-ink-soft">
          Lowest score first. Choose a chip to see only those tournaments; choose it again to clear
          it.
        </p>
        {/* The stale-audit signal the old tiles carried: how many are due. */}
        <p className="text-caption text-ink-soft">
          {stale === 0
            ? 'All audited in the last 24 h'
            : `${stale.toLocaleString('en-GB')} of ${of.toLocaleString('en-GB')} not audited in 24 h`}
        </p>
      </div>
      <AuditNowButton />
    </div>
  );
}

/**
 * The address a chip leads to. Choosing the chosen chip again clears it;
 * choosing another of the same group replaces it, so a group never holds two.
 */
function chipHref(filters: TournamentFilters, q: string) {
  return (change: Partial<Record<keyof TournamentFilters, string | null>>) => {
    const params: Record<string, string> = { ...filterParams(filters) };
    for (const [k, v] of Object.entries(change)) {
      if (v == null || params[k] === v) delete params[k];
      else params[k] = v;
    }
    return adminTabHref('tournaments', { ...(q ? { q } : {}), ...params });
  };
}

/**
 * One chip. `wrap` lets a long label (the open question's) break over lines
 * and grow in height instead of running past a 390 px screen; the short chips
 * keep the button's single line.
 */
function Chip({
  label,
  n,
  to,
  on,
  wrap = false,
}: {
  label: string;
  n?: number;
  to: string;
  on: boolean;
  wrap?: boolean;
}) {
  return (
    <li className={wrap ? 'max-w-full' : undefined}>
      <Link
        href={to}
        aria-current={on ? 'true' : undefined}
        className={cn(
          buttonClasses({ variant: on ? 'primary' : 'outline', size: 'sm' }),
          wrap && 'h-auto min-h-8 py-1 text-left whitespace-normal',
        )}
      >
        {label}
        {n == null ? null : (
          <>
            {' '}
            <span className="font-mono tabular-nums">{count(n)}</span>
          </>
        )}
      </Link>
    </li>
  );
}

/** The open question's rule, folded away so the chip stays one line. */
function QuestionRule({ rule, status }: { rule: string; status: string }) {
  return (
    <details className="max-w-prose text-body text-ink-soft">
      <summary className="cursor-pointer text-ui text-ink">
        The rule behind the open question
      </summary>
      <p className="mt-hair">{rule}</p>
      <p className="mt-hair text-caption">{status}</p>
    </details>
  );
}

/** One labelled row of chips. */
function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  // A group named by its visible label, not a navigation landmark: three
  // landmarks of chips would crowd a screen reader's landmark list.
  return (
    <div role="group" aria-labelledby={id} className="space-y-hair">
      <p id={id} className="data-label">
        {label}
      </p>
      <ul className="flex flex-wrap gap-inline">{children}</ul>
    </div>
  );
}
