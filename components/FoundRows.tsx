'use client';

import { Button } from '@/components/ui/Button';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';
import { TournamentLink } from '@/components/TournamentCard';
import { rowLabel, type RowView } from '@/lib/discovery/view';
import type { DecisionKind } from '@/lib/discovery/messages';

export type RowState = {
  /** The decision as it stands now, including ones made on this visit. */
  decision: 'confirmed' | 'rejected' | null;
  /** The inline note left after a decision on this visit. */
  note: string | null;
};

export type RowsProps = {
  rows: readonly RowView[];
  label: string;
  stateOf: (row: RowView) => RowState;
  pendingKey: string | null;
  onDecide: (row: RowView, kind: DecisionKind) => void;
};

/**
 * Per-row controls. Always visible, never on hover (UX-36); outline, because
 * the page's one primary action is the bulk confirm (or nothing). Each name
 * says which tournament it is for (UX-11) and starts with the visible words.
 * After a decision the row stays where it is with the note and an Undo
 * (inline, not a toast: UX-20).
 */
function RowActions({
  row,
  stateOf,
  pendingKey,
  onDecide,
}: Omit<RowsProps, 'rows' | 'label'> & { row: RowView }) {
  const state = stateOf(row);
  const label = rowLabel(row);
  const busy = pendingKey === row.key;
  if (state.decision) {
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="text-caption text-ink">
          {state.note ?? (state.decision === 'confirmed' ? 'Marked as you.' : 'Hidden.')}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          loading={busy}
          data-undo-for={row.key}
          aria-label={`${state.decision === 'confirmed' ? 'Undo' : 'Show again'}: ${label}`}
          onClick={() => onDecide(row, 'restore')}
          className="w-full sm:w-auto"
        >
          {state.decision === 'confirmed' ? 'Undo' : 'Show again'}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {row.tier !== 'blocked' ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          loading={busy}
          data-first-action="true"
          aria-label={`This is me: ${label}`}
          onClick={() => onDecide(row, 'confirm')}
          className="w-full sm:w-auto"
        >
          This is me
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        loading={busy}
        data-first-action={row.tier === 'blocked' ? 'true' : undefined}
        aria-label={`Not me: ${label}`}
        onClick={() => onDecide(row, 'reject')}
        className="w-full sm:w-auto"
      >
        Not me
      </Button>
    </div>
  );
}

/** The "Why this match" line, any warnings, and the block reason, all visible. */
function Why({ row }: { row: RowView }) {
  return (
    <div className="space-y-1">
      <p className="text-ink">
        <span className="font-medium">Why this match: </span>
        {row.evidence}
      </p>
      {row.blockText ? <p className="text-ink">{row.blockText}</p> : null}
      {row.warnings.length > 0 ? (
        <ul className="space-y-0.5 text-caption text-ink">
          {row.warnings.map((w) => (
            <li key={w}>
              <span className="font-semibold">Check: </span>
              {w}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function roleAndTeam(row: RowView): string {
  return [row.role, row.team].filter(Boolean).join(' · ') || 'Not listed';
}

/**
 * One tier as a ledger table at `md` and up, and as cards below it (UX-30):
 * the table has five columns of long text, which a phone cannot hold. Only
 * one of the two is displayed, so only one is in the tab order.
 */
export function FoundRows(props: RowsProps) {
  const { rows, label } = props;
  return (
    <>
      <div className="hidden md:block">
        <TableScroll>
          <Table label={label}>
            <thead>
              <tr>
                <Th>Tournament</Th>
                <Th>Listed as</Th>
                <Th>Role and team</Th>
                <Th>Why this match</Th>
                <Th>Your answer</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.key} data-row-key={row.key}>
                  <Td rowHeader className="align-top">
                    <TournamentLink name={rowLabel(row)} href={row.publicUrl} />
                  </Td>
                  <Td className="align-top">{row.listedName}</Td>
                  <Td className="align-top">{roleAndTeam(row)}</Td>
                  <Td className="max-w-md align-top">
                    <Why row={row} />
                  </Td>
                  <Td className="align-top">
                    <RowActions row={row} {...props} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </div>
      <ul className="space-y-3 md:hidden" aria-label={label}>
        {rows.map((row) => (
          <li key={row.key} data-row-key={row.key} className="panel space-y-3 p-4">
            <h3 className="text-body">
              <TournamentLink name={rowLabel(row)} href={row.publicUrl} />
            </h3>
            <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-table">
              <dt className="data-label">Listed as</dt>
              <dd className="text-ink">{row.listedName}</dd>
              <dt className="data-label">Role</dt>
              <dd className="text-ink">{roleAndTeam(row)}</dd>
            </dl>
            <div className="text-table">
              <Why row={row} />
            </div>
            <RowActions row={row} {...props} />
          </li>
        ))}
      </ul>
    </>
  );
}
