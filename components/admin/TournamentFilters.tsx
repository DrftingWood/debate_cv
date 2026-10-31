import Link from 'next/link';
import { buttonClasses } from '@/components/ui/Button';
import { AuditNowButton } from '@/components/admin/AuditNowButton';
import { BAND_BADGE } from '@/components/admin/bandBadge';
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
      <ChipsIntro />
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
      <ChipGroup label="Marks and rules">
        <Chip
          label="Checked by an admin"
          n={overview.checked}
          to={href({ checked: '1' })}
          on={Boolean(filters.checked)}
        />
        {question ? (
          <Chip
            label={`Open question: ${QUESTION_CHIP[question.code]}`}
            n={question.count}
            to={href({ question: question.code })}
            on={filters.question === question.code}
          />
        ) : null}
      </ChipGroup>
      {question ? <QuestionRule rule={question.rule} status={question.status} /> : null}
    </div>
  );
}

/** What the chips do, with Audit now beside it (it is what fills the counts). */
function ChipsIntro() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-tight">
      <p className="max-w-prose text-body text-ink-soft">
        Lowest score first. Choose a chip to see only those tournaments; choose it again to clear
        it.
      </p>
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

function Chip({ label, n, to, on }: { label: string; n?: number; to: string; on: boolean }) {
  return (
    <li>
      <Link
        href={to}
        aria-current={on ? 'true' : undefined}
        className={buttonClasses({ variant: on ? 'primary' : 'outline', size: 'sm' })}
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

/** One labelled row of chips; the label names the group for a screen reader too. */
function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <nav aria-label={`Show tournaments by ${label.toLowerCase()}`} className="space-y-hair">
      <p className="data-label">{label}</p>
      <ul className="flex flex-wrap gap-inline">{children}</ul>
    </nav>
  );
}
