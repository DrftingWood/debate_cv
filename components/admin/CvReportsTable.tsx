'use client';

import { useId, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Cols, Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import { TabLink } from '@/components/admin/TabLink';
import { TabStatus } from '@/components/admin/TabStatus';
import { ActionStatus, FIELD_CLASS, useAddToReviewSet } from '@/components/admin/AddToReviewSet';
import { RescrapeSuggestedButton } from '@/components/admin/RescrapeSuggestedButton';
import type { SuggestedPiece } from '@/lib/admin/accuracyActions';
import { cvReportFailureMessage } from '@/lib/admin/actionMessage';
import { REPORT_STATUS_LABEL, REPORT_STATUSES, type ReportStatus } from '@/lib/admin/cvReportTypes';
import type { TabState } from '@/lib/admin/tabStatus';
import { patchJson } from '@/lib/utils/api';
import { singleFlight } from '@/lib/utils/singleFlight';

/** A CV report as the server prepared it: public tab addresses, scrubbed comment, time in words. */
export type CvReportRow = {
  id: string;
  reported: { text: string; iso: string };
  /** The reporter's name, else email, else "Unknown user". */
  reporter: string;
  /** Shown under the name when it is not already the name. */
  reporterEmail: string | null;
  tournaments: Array<{
    id: string;
    name: string;
    stored: boolean;
    tabUrl: string | null;
    tab: TabState;
    suggested: SuggestedPiece[];
  }>;
  categories: Array<{ code: string; label: string }>;
  comment: string;
  status: ReportStatus;
};

type Tournament = CvReportRow['tournaments'][number];

/** Past this a comment is clamped to three lines with "Show more". */
const LONG_COMMENT = 180;

/**
 * "CV error reports" as a ledger (Task 5d): one page of reports, each with
 * its tournaments (Tab status and a public "Tab ↗"), its categories in
 * words, the user's comment, a Status select that saves on change, and
 * "Re-scrape suggested (n)" for each tournament the categories point at.
 * Ticked reports go to the review set with a priority and a comment, as
 * failed imports do.
 *
 * The pager and the status filter are links the server section renders
 * around this table; this component holds only what needs the browser.
 */
export function CvReportsTable({ rows }: { rows: readonly CvReportRow[] }) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const selected = rows.filter((r) => ticked.has(r.id)).map((r) => r.id);
  const status = useReportStatus();
  const review = useAddToReviewSet(
    selected.map((sourceId) => ({ source: 'cv_report' as const, sourceId })),
    { noun: 'report', onAdded: () => setTicked(new Set()) },
  );
  const toggle = (ids: string[], on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  return (
    <div className="space-y-tight">
      <div className="flex flex-wrap items-center gap-inline">
        {review.button}
        <span className="font-mono text-caption tabular-nums text-ink-soft">
          {selected.length} selected
        </span>
      </div>
      {review.panel}
      <ActionStatus message={status.message} error={status.error} />
      <div className="panel overflow-hidden">
        <TableScroll>
          <ReportsTable rows={rows} ticked={ticked} onToggle={toggle} status={status} />
        </TableScroll>
      </div>
    </div>
  );
}

/** What the status line says when a Status change arrives during a save. */
export const BUSY_MESSAGE = 'Wait for the last save to finish.';

/** Null when a Status change may be sent; else the words for the status line. */
export function statusSaveBlocked(pending: boolean, busy: boolean): string | null {
  return pending || busy ? BUSY_MESSAGE : null;
}

/**
 * The Status select's PATCH, one at a time across the table (UX-17). The
 * select shows the new value at once; a failure puts it back and says why
 * in words, naming the report (UX-23); a success is a toast (UX-20) and a
 * refresh, so a report that no longer matches the filter leaves the page.
 */
function useReportStatus() {
  const router = useRouter();
  const toast = useToast();
  const [shown, setShown] = useState<Record<string, ReportStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();
  const [flight] = useState(singleFlight);

  const save = (row: CvReportRow, next: ReportStatus) => {
    // A change while the last save or its refresh is still running is not
    // sent; the select snaps back, and the status line says why rather than
    // dropping it in silence.
    const blocked = statusSaveBlocked(pending, flight.busy);
    if (blocked) {
      setMessage(blocked);
      return;
    }
    setError(null);
    setShown((s) => ({ ...s, [row.id]: next }));
    setMessage(`Saving the report from ${row.reporter}…`);
    startTransition(async () => {
      const result = await flight.run(() =>
        patchJson<{ ok: true }>(`/api/admin/cv-reports/${row.id}`, { status: next }),
      );
      setMessage('');
      if (!result) return;
      if (!result.ok) {
        setShown(({ [row.id]: _dropped, ...rest }) => rest);
        setError(`Report from ${row.reporter}: ${cvReportFailureMessage(result)}`);
        return;
      }
      toast.show({ kind: 'success', title: `Report marked ${REPORT_STATUS_LABEL[next]}` });
      startTransition(() => router.refresh());
    });
  };
  return { save, error, message, value: (row: CvReportRow) => shown[row.id] ?? row.status };
}

type StatusApi = ReturnType<typeof useReportStatus>;

// Below md everything but the checkbox folds into the Tournament cell, so a
// phone shows a card per report (UX-30), with nothing cut away. The hidden
// <col>s are hidden with their cells: a fixed-layout table places cells by
// position, so a col left in while its cells are display:none would shift
// every cell one column to the left (see FailedJobsTable).
const REPORT_COLUMNS = [
  '3rem',
  { className: 'hidden md:table-column md:w-24' },
  { className: 'hidden md:table-column md:w-44' },
  { className: 'md:w-64' },
  { className: 'hidden md:table-column md:w-44' },
  { className: 'hidden md:table-column md:w-72' },
  { className: 'hidden md:table-column md:w-40' },
  { className: 'hidden md:table-column md:w-56' },
];

function ReportsTable({
  rows,
  ticked,
  onToggle,
  status,
}: {
  rows: readonly CvReportRow[];
  ticked: ReadonlySet<string>;
  onToggle: (ids: string[], on: boolean) => void;
  status: StatusApi;
}) {
  const all = rows.length > 0 && rows.every((r) => ticked.has(r.id));
  const n = rows.length;
  return (
    <Table className="table-fixed md:min-w-max" label="CV error reports">
      <Cols widths={REPORT_COLUMNS} />
      <thead>
        <tr>
          <Th className="pl-stack">
            <input
              type="checkbox"
              className="h-6 w-6 accent-primary align-middle"
              checked={all}
              onChange={() =>
                onToggle(
                  rows.map((r) => r.id),
                  !all,
                )
              }
              aria-label={`Select the ${n} ${n === 1 ? 'report' : 'reports'} on this page`}
            />
          </Th>
          <Th className="hidden md:table-cell">Reported</Th>
          <Th className="hidden md:table-cell">Reporter</Th>
          <Th className="max-md:whitespace-normal!">Tournament</Th>
          <Th className="hidden md:table-cell">Categories</Th>
          <Th className="hidden md:table-cell">Comment</Th>
          <Th className="hidden md:table-cell">Status</Th>
          <Th className="hidden pr-stack md:table-cell">Actions</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <ReportRow
            key={row.id}
            row={row}
            checked={ticked.has(row.id)}
            onToggle={() => onToggle([row.id], !ticked.has(row.id))}
            status={status}
          />
        ))}
      </tbody>
    </Table>
  );
}

function ReportRow({
  row,
  checked,
  onToggle,
  status,
}: {
  row: CvReportRow;
  checked: boolean;
  onToggle: () => void;
  status: StatusApi;
}) {
  const select = <StatusSelect row={row} status={status} />;
  return (
    <Tr>
      <Td className="pl-stack align-top">
        <input
          type="checkbox"
          className="h-6 w-6 accent-primary align-middle"
          checked={checked}
          onChange={onToggle}
          aria-label={`Select the report from ${row.reporter}, ${row.reported.text}`}
        />
      </Td>
      <Td className="hidden align-top font-mono tabular-nums text-ink-soft md:table-cell">
        <time dateTime={row.reported.iso}>{row.reported.text}</time>
      </Td>
      <Td className="hidden align-top whitespace-normal wrap-break-word md:table-cell">
        <Reporter row={row} />
      </Td>
      <Td rowHeader className="align-top whitespace-normal wrap-break-word">
        <Tournaments tournaments={row.tournaments} />
        <PhoneFold row={row} select={select} />
      </Td>
      <Td className="hidden align-top whitespace-normal md:table-cell">
        <Categories categories={row.categories} />
      </Td>
      <Td className="hidden align-top whitespace-normal md:table-cell">
        <Comment text={row.comment} />
      </Td>
      <Td className="hidden align-top md:table-cell">{select}</Td>
      <Td className="hidden pr-stack align-top md:table-cell">
        <Actions tournaments={row.tournaments} />
      </Td>
    </Tr>
  );
}

/** What a phone shows under the tournaments: the other columns, labelled where a value alone is unclear. */
function PhoneFold({ row, select }: { row: CvReportRow; select: ReactNode }) {
  return (
    <div className="mt-tight space-y-tight md:hidden">
      <p className="text-caption text-ink-soft">
        <Reporter row={row} /> ·{' '}
        <time dateTime={row.reported.iso} className="font-mono">
          {row.reported.text}
        </time>
      </p>
      <Categories categories={row.categories} />
      <Comment text={row.comment} />
      {select}
      <Actions tournaments={row.tournaments} />
    </div>
  );
}

function Reporter({ row }: { row: CvReportRow }) {
  return (
    <>
      <span className="text-ink">{row.reporter}</span>
      {row.reporterEmail ? (
        <span className="block text-caption text-ink-soft">{row.reporterEmail}</span>
      ) : null}
    </>
  );
}

/** Each tournament: its name (to its admin page when stored), Tab status and "Tab ↗"; several stack. */
function Tournaments({ tournaments }: { tournaments: readonly Tournament[] }) {
  if (tournaments.length === 0) return <span className="text-ink-soft">No tournament named</span>;
  return (
    <ul className="space-y-tight">
      {tournaments.map((t) => (
        <li key={t.id} className="space-y-hair">
          {t.stored ? (
            <Link
              href={`/admin/tournaments/${t.id}`}
              className="text-ink underline underline-offset-4 hover:text-primary"
            >
              {t.name}
            </Link>
          ) : (
            <span className="text-ink-soft">{t.name}</span>
          )}
          <div className="flex flex-wrap items-baseline gap-x-tight gap-y-hair text-caption">
            <TabStatus tab={t.tab} name={t.name} open={false} />
            <TabLink url={t.tabUrl} text="Tab" of={t.name} missing="No public tab" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Categories({ categories }: { categories: CvReportRow['categories'] }) {
  if (categories.length === 0) return <span className="text-ink-soft">No category</span>;
  return (
    <span className="flex flex-wrap gap-hair">
      {categories.map((c) => (
        <Badge key={c.code} variant="warning" className="whitespace-normal">
          {c.label}
        </Badge>
      ))}
    </span>
  );
}

/** The user's comment, wrapped; a long one is clamped to three lines behind "Show more". */
function Comment({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!text) return <span className="text-ink-soft">No comment</span>;
  const long = text.length > LONG_COMMENT || text.split('\n').length > 3;
  return (
    <div>
      <p
        id={id}
        className={`whitespace-pre-wrap wrap-break-word text-ink ${long && !open ? 'line-clamp-3' : ''}`}
      >
        {text}
      </p>
      {long ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-6 items-center text-caption text-ink underline underline-offset-4 hover:text-primary"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}

function StatusSelect({ row, status }: { row: CvReportRow; status: StatusApi }) {
  return (
    <select
      value={status.value(row)}
      aria-label={`Status of the report from ${row.reporter}`}
      onChange={(e) => status.save(row, e.target.value as ReportStatus)}
      className={`${FIELD_CLASS} h-8 w-full max-w-48 coarse:min-h-11`}
    >
      {REPORT_STATUSES.map((s) => (
        <option key={s} value={s}>
          {REPORT_STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

/**
 * "Re-scrape suggested (n)" for each stored tournament the categories point
 * at. A report about identity points at no page, and an unstored
 * tournament has nothing to re-scrape: each says so in words (UX-27).
 */
function Actions({ tournaments }: { tournaments: readonly Tournament[] }) {
  const stored = tournaments.filter((t) => t.stored);
  if (stored.length === 0) return <span className="text-caption text-ink-soft">Not stored</span>;
  return (
    <ul className="space-y-tight">
      {stored.map((t) => (
        <li key={t.id} className="flex flex-col items-start gap-hair">
          {tournaments.length > 1 ? (
            <span className="text-caption text-ink-soft">{t.name}</span>
          ) : null}
          {t.suggested.length > 0 ? (
            <RescrapeSuggestedButton
              tournamentId={t.id}
              tournamentName={t.name}
              suggested={t.suggested}
            />
          ) : (
            <span className="text-caption text-ink-soft">No pages suggested</span>
          )}
        </li>
      ))}
    </ul>
  );
}
