'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowsClockwise } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { Cols, Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { useFirstRows } from '@/components/ui/useFirstRows';
import { retryFailureMessage } from '@/lib/admin/actionMessage';
import { postJson } from '@/lib/utils/api';
import { singleFlight } from '@/lib/utils/singleFlight';

/** A failed import as the server prepared it: no raw error, no private key. */
export type FailedJobRow = {
  id: string;
  user: string | null;
  url: string;
  attempts: number;
  /** Plain-language summary of `lastError`; null when none was recorded. */
  error: string | null;
  when: { text: string; iso: string } | null;
};

type RetryResponse = { requeued: number; skippedLocked: number };
type Which = 'selected' | 'all';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "Failed imports": jobs that ran out of attempts, with a way to put them
 * back on the queue. Requeueing is not destructive (the worker just tries
 * the URL again), so neither action asks for confirmation.
 *
 * `total` is the database's count, not `rows.length`: the list is capped,
 * and "Retry all" retries every failed job, so its label must say how many
 * that really is.
 */
export function FailedJobsTable({ rows, total }: { rows: FailedJobRow[]; total: number }) {
  const [ticked, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Only ids still on the page count: after a refresh a requeued job leaves
  // the list, and "3 selected" must not keep counting (or sending) it.
  const selected = new Set(rows.filter((r) => ticked.has(r.id)).map((r) => r.id));
  const { shown, more } = useFirstRows(rows);
  const retry = useRetryJobs(selected, () => setSelected(new Set()));

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No failed imports"
        description="An import lands here when it fails on every attempt, so you can put it back on the queue."
        headingLevel={3}
      />
    );
  }

  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  return (
    <div className="space-y-tight">
      <RetryBar retry={retry} total={total} selectedCount={selected.size} />
      <div className="panel overflow-hidden">
        <TableScroll>
          <JobsTable rows={shown} selected={selected} onToggle={toggle} />
        </TableScroll>
        {more}
      </div>
    </div>
  );
}

/**
 * The two retry calls and their outcome. A success is passive news, so it
 * is a toast; a failure stays on screen as an alert (UX-20).
 */
function useRetryJobs(selected: ReadonlySet<string>, clear: () => void) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<Which | null>(null);
  const [pending, startTransition] = useTransition();
  const [flight] = useState(singleFlight);

  const run = (which: Which) => {
    // One retry at a time, whichever button started it (UX-17).
    if (pending || flight.busy) return;
    // Validated on press, not by disabling the button (UX-16): a disabled
    // button cannot say why it will not work.
    if (which === 'selected' && selected.size === 0) {
      setError('Tick at least one import to retry.');
      return;
    }
    setError(null);
    setRunning(which);
    startTransition(async () => {
      const body = which === 'all' ? { all: true } : { ids: [...selected] };
      const result = await flight.run(() => postJson<RetryResponse>('/api/admin/jobs/retry', body));
      if (!result) return;
      if (!result.ok) {
        setError(retryFailureMessage(result));
        return;
      }
      const { requeued, skippedLocked } = result.data;
      toast.show({
        kind: 'success',
        title: `${plural(requeued, 'import')} queued again`,
        description: skippedLocked
          ? `${plural(skippedLocked, 'locked URL was', 'locked URLs were')} left alone.`
          : 'They run with the next queue drain.',
      });
      clear();
      // Its own transition, so the buttons stay busy until the refreshed
      // list lands instead of offering the requeued rows again for a beat.
      startTransition(() => router.refresh());
    });
  };

  return {
    run,
    error,
    busy: (which: Which) => pending && running === which,
    /** The other button while one runs: focusable, announced as unavailable. */
    blocked: (which: Which) => pending && running !== which,
  };
}

function RetryBar({
  retry,
  total,
  selectedCount,
}: {
  retry: ReturnType<typeof useRetryJobs>;
  total: number;
  selectedCount: number;
}) {
  const errorId = useId();
  const icon = <ArrowsClockwise className="h-4 w-4" aria-hidden />;
  return (
    <>
      <div className="flex flex-wrap items-center gap-inline">
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={retry.busy('selected')}
          aria-disabled={retry.blocked('selected') || undefined}
          className={retry.blocked('selected') ? 'cursor-not-allowed opacity-50' : undefined}
          leftIcon={icon}
          aria-describedby={retry.error ? errorId : undefined}
          onClick={() => retry.run('selected')}
        >
          Retry selected
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={retry.busy('all')}
          aria-disabled={retry.blocked('all') || undefined}
          className={retry.blocked('all') ? 'cursor-not-allowed opacity-50' : undefined}
          leftIcon={icon}
          onClick={() => retry.run('all')}
        >
          Retry all {total.toLocaleString('en-GB')}
        </Button>
        <span className="font-mono text-caption tabular-nums text-ink-soft">
          {selectedCount} selected
        </span>
      </div>
      {retry.error ? (
        <p id={errorId} role="alert" className="text-caption text-destructive">
          {retry.error}
        </p>
      ) : null}
    </>
  );
}

// Below md the user, attempts and time fold into the URL and error cells, so
// a phone shows three columns, not six (UX-30). Their <col>s are hidden with
// their cells: a fixed-layout table assigns cells to columns by position, so
// a zero-width col left in the model while its cells are display:none puts
// the URL in the user's zero-width column and the error in the URL's. On a
// phone the URL and the error share the width left by the checkbox, so the
// table fits the panel and reads without scrolling sideways; from md they
// take their fixed widths and the table may scroll.
const JOB_COLUMNS = [
  '3rem',
  { className: 'hidden md:table-column md:w-56' },
  { className: 'md:w-64' },
  { className: 'hidden md:table-column md:w-24' },
  { className: 'md:w-80' },
  { className: 'hidden md:table-column md:w-28' },
];

function JobsTable({
  rows,
  selected,
  onToggle,
}: {
  rows: readonly FailedJobRow[];
  selected: ReadonlySet<string>;
  onToggle: (ids: string[], on: boolean) => void;
}) {
  // The header box covers the rows on screen, not the ones folded away
  // under "Show all": ticking it should never select what cannot be seen.
  const allShown = rows.length > 0 && rows.every((r) => selected.has(r.id));
  return (
    <Table className="table-fixed md:min-w-max" label="Failed imports">
      <Cols widths={JOB_COLUMNS} />
      <thead>
        <tr>
          <Th className="pl-stack">
            <input
              type="checkbox"
              className="h-6 w-6 accent-primary align-middle"
              checked={allShown}
              onChange={() =>
                onToggle(
                  rows.map((r) => r.id),
                  !allShown,
                )
              }
              aria-label={`Select the ${plural(rows.length, 'import')} shown`}
            />
          </Th>
          <Th className="hidden md:table-cell">User</Th>
          {/* On a phone the column is a third of the panel, narrower than
              its name: the name wraps there rather than run into "Error"
              (the ledger's nowrap is overridden, hence the `!`). */}
          <Th className="max-md:whitespace-normal!">Tournament URL</Th>
          <Th numeric className="hidden md:table-cell">
            Attempts
          </Th>
          <Th>Error</Th>
          <Th className="hidden pr-stack md:table-cell">When</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <JobRow
            key={row.id}
            row={row}
            checked={selected.has(row.id)}
            onToggle={() => onToggle([row.id], !selected.has(row.id))}
          />
        ))}
      </tbody>
    </Table>
  );
}

function JobRow({
  row,
  checked,
  onToggle,
}: {
  row: FailedJobRow;
  checked: boolean;
  onToggle: () => void;
}) {
  const user = row.user ?? 'No email';
  return (
    <Tr>
      <Td className="pl-stack align-top">
        <input
          type="checkbox"
          className="h-6 w-6 accent-primary align-middle"
          checked={checked}
          onChange={onToggle}
          // Names its row (UX-11): the URL is what the admin reads across
          // to, and the user tells two imports of one tab apart.
          aria-label={`Select ${row.url}${row.user ? ` for ${row.user}` : ''}`}
        />
      </Td>
      <Td className="hidden wrap-break-word md:table-cell">
        <span className={row.user ? undefined : 'text-ink-soft'}>{user}</span>
      </Td>
      <Td rowHeader className="wrap-break-word">
        <span className="font-mono text-caption">{row.url}</span>
        <span className="block text-caption text-ink-soft md:hidden">{user}</span>
      </Td>
      <Td numeric className="hidden md:table-cell">
        {row.attempts}
      </Td>
      <Td className="whitespace-normal">
        {row.error ?? <span className="text-ink-soft">No error recorded</span>}
        <span className="block font-mono text-caption tabular-nums text-ink-soft md:hidden">
          {plural(row.attempts, 'attempt')}
          {row.when ? ` · ${row.when.text}` : ''}
        </span>
      </Td>
      <Td className="hidden pr-stack font-mono tabular-nums text-ink-soft md:table-cell">
        {row.when ? <time dateTime={row.when.iso}>{row.when.text}</time> : 'Not finished'}
      </Td>
    </Tr>
  );
}
