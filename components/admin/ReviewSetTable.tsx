'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type RefObject,
} from 'react';
import { useRouter } from 'next/navigation';
import { DownloadSimple } from '@/components/ui/icons';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Cols, Table, TableScroll, Td, Th, Tr } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { useFirstRows } from '@/components/ui/useFirstRows';
import { TabLink } from '@/components/admin/TabLink';
import { TabStatus } from '@/components/admin/TabStatus';
import {
  ActionStatus,
  CommentField,
  EMPTY_COMMENT,
  FormButtons,
  PrioritySelect,
} from '@/components/admin/AddToReviewSet';
import { reviewSetFailureMessage } from '@/lib/admin/actionMessage';
import type { TabState } from '@/lib/admin/tabStatus';
import { PRIORITY_LABEL, type FlagStatus, type Priority } from '@/lib/admin/reviewSetTypes';
import { patchJson } from '@/lib/utils/api';
import { singleFlight } from '@/lib/utils/singleFlight';

/** A flag as the server prepared it: public address only, times in words. */
export type ReviewRow = {
  id: string;
  priority: Priority;
  status: FlagStatus;
  comment: string;
  /** The tournament's name, else its short public address, else the item's kind and id. */
  name: string;
  /** What was flagged: "Failed import" (and, from Task 5d, "CV report", "Parser warning"). */
  kind: string;
  /** The public tab address, or null (the name shows without a link). */
  href: string | null;
  tab: TabState;
  flagged: { text: string; iso: string };
};

type Patch = { priority?: Priority; comment?: string; status?: FlagStatus };

/** The priority as a badge with its word; the word carries it, not the colour (UX-34). */
const PRIORITY_BADGE: Record<Priority, 'danger' | 'warning' | 'neutral'> = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
};

function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge variant={PRIORITY_BADGE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
}

/**
 * "Flagged for review": the review set as a ledger, high to low and then
 * the longest waiting first. Each row's priority and comment can be edited
 * in place and the row marked done; done rows wait behind "Show done".
 */
export function ReviewSetTable({ rows }: { rows: readonly ReviewRow[] }) {
  const [showDone, setShowDone] = useState(false);
  const patch = usePatchFlag();
  const open = rows.filter((r) => r.status === 'open');
  const visible = showDone ? rows : open;
  const { shown, more } = useFirstRows(visible);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing flagged yet"
        description="Tick failed imports, CV reports or parser warnings and press Add to review set. They wait here with their priority and comment."
        headingLevel={3}
      />
    );
  }

  return (
    <div className="space-y-tight">
      <ReviewSetBar
        showDone={showDone}
        onToggle={() => setShowDone((v) => !v)}
        done={rows.length - open.length}
      />
      <ActionStatus message={patch.message} error={patch.error} />
      {visible.length === 0 ? (
        <EmptyState
          title="Nothing open"
          description="Every flagged item is done. Press Show done to see them."
          headingLevel={3}
        />
      ) : (
        <div className="panel overflow-hidden">
          <TableScroll>
            <ReviewTable rows={shown} patch={patch} />
          </TableScroll>
          {more}
        </div>
      )}
    </div>
  );
}

/**
 * "Show done" and the two exports. The exports follow the toggle, so the
 * file downloaded holds what is on screen (every row, not only the first
 * page of it).
 */
function ReviewSetBar({
  showDone,
  onToggle,
  done,
}: {
  showDone: boolean;
  onToggle: () => void;
  done: number;
}) {
  const status = showDone ? 'all' : 'open';
  const exportLink = (format: 'json' | 'csv', label: string) => (
    <a
      href={`/api/admin/review-set?format=${format}&status=${status}`}
      className={buttonClasses({ variant: 'outline', size: 'sm' })}
    >
      <DownloadSimple className="h-4 w-4" aria-hidden /> {label}
    </a>
  );
  return (
    <div className="flex flex-wrap items-center gap-inline">
      {/* A toggle with a fixed label: its state is aria-pressed (UX-12). */}
      <Button type="button" variant="outline" size="sm" aria-pressed={showDone} onClick={onToggle}>
        Show done
      </Button>
      <span className="font-mono text-caption tabular-nums text-ink-soft">{done} done</span>
      {exportLink('json', 'Export JSON')}
      {exportLink('csv', 'Export CSV')}
    </div>
  );
}

/**
 * One edit at a time across the table (UX-17), whichever row started it.
 * The line above the table says what is saving (UX-19); success is a toast
 * (UX-20) and a refresh, so the ledger re-sorts from the server; a failure
 * stays on screen in words, naming the row (UX-23).
 */
function usePatchFlag() {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();
  const [flight] = useState(singleFlight);

  const run = (row: ReviewRow, body: Patch, then: { done: string; after?: () => void }) => {
    if (pending || flight.busy) return;
    setError(null);
    setMessage(`Saving ${row.name}…`);
    startTransition(async () => {
      const result = await flight.run(() =>
        patchJson<{ ok: true }>('/api/admin/review-set', { id: row.id, ...body }),
      );
      setMessage('');
      if (!result) return;
      if (!result.ok) {
        setError(`${row.name}: ${reviewSetFailureMessage(result)}`);
        return;
      }
      toast.show({ kind: 'success', title: then.done });
      then.after?.();
      startTransition(() => router.refresh());
    });
  };
  return { run, error, message, pending };
}

type PatchApi = ReturnType<typeof usePatchFlag>;

// Below md the priority, Tab status, comment and time fold into the name
// cell, so a phone shows two columns, the item and its actions (UX-30).
// Their <col>s are hidden with their cells, or every cell would land one
// column to the left (see FailedJobsTable). The actions keep 9rem: the
// priority select over two short buttons.
const REVIEW_COLUMNS = [
  { className: 'hidden md:table-column md:w-28' },
  { className: 'md:w-64' },
  { className: 'hidden md:table-column md:w-32' },
  { className: 'hidden md:table-column md:w-80' },
  { className: 'hidden md:table-column md:w-28' },
  { className: 'w-36 md:w-40' },
];

function ReviewTable({ rows, patch }: { rows: readonly ReviewRow[]; patch: PatchApi }) {
  return (
    <Table className="table-fixed md:min-w-max" label="Flagged for review">
      <Cols widths={REVIEW_COLUMNS} />
      <thead>
        <tr>
          <Th className="hidden pl-stack md:table-cell">Priority</Th>
          <Th className="max-md:pl-stack max-md:whitespace-normal!">Tournament or URL</Th>
          <Th className="hidden md:table-cell">Tab status</Th>
          <Th className="hidden md:table-cell">Comment</Th>
          <Th className="hidden md:table-cell">Flagged</Th>
          <Th className="pr-stack">Actions</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <ReviewRowView key={row.id} row={row} patch={patch} />
        ))}
      </tbody>
    </Table>
  );
}

function ReviewRowView({ row, patch }: { row: ReviewRow; patch: PatchApi }) {
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const editorId = useId();
  const comment = <span className="whitespace-pre-wrap wrap-break-word">{row.comment}</span>;
  const closeEditor = () => {
    setEditing(false);
    // Back to the control that opened it, not to <body> (UX-7).
    requestAnimationFrame(() => editButton.current?.focus());
  };

  return (
    <>
      <Tr className={row.status === 'done' ? 'text-ink-soft' : undefined}>
        <Td className="hidden pl-stack md:table-cell">
          <PriorityBadge priority={row.priority} />
        </Td>
        <Td rowHeader className="whitespace-normal wrap-break-word max-md:pl-stack">
          <NameCell row={row} comment={comment} />
        </Td>
        <Td className="hidden md:table-cell">
          <TabStatus tab={row.tab} name={row.name} />
        </Td>
        <Td className="hidden whitespace-normal md:table-cell">{comment}</Td>
        <Td className="hidden font-mono tabular-nums text-ink-soft md:table-cell">
          <time dateTime={row.flagged.iso}>{row.flagged.text}</time>
        </Td>
        <Td className="pr-stack align-top">
          <RowActions
            row={row}
            patch={patch}
            editing={editing}
            editorId={editorId}
            editButton={editButton}
            onEdit={() => (editing ? closeEditor() : setEditing(true))}
          />
        </Td>
      </Tr>
      {editing ? (
        <tr>
          <td colSpan={REVIEW_COLUMNS.length} className="px-stack pb-stack">
            <CommentEditor id={editorId} row={row} patch={patch} onClose={closeEditor} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** The item, with what a phone folds under it: priority, time, Tab status and comment. */
function NameCell({ row, comment }: { row: ReviewRow; comment: ReactNode }) {
  return (
    <>
      <TabLink url={row.href} text={row.name} />
      <span className="block text-caption text-ink-soft">
        {row.kind}
        {row.status === 'done' ? ' · Done' : ''}
      </span>
      <span className="mt-hair flex flex-wrap items-center gap-inline md:hidden">
        <PriorityBadge priority={row.priority} />
        <time dateTime={row.flagged.iso} className="font-mono text-caption text-ink-soft">
          {row.flagged.text}
        </time>
      </span>
      <div className="mt-hair md:hidden">
        <TabStatus tab={row.tab} name={row.name} />
      </div>
      <span className="mt-hair block text-caption md:hidden">{comment}</span>
    </>
  );
}

/**
 * Edit priority (applies on change), edit comment (opens the editor row
 * under this one) and Mark done, or Reopen for a done row. Each control's
 * name starts with its visible words and says which row (UX-11).
 */
function RowActions({
  row,
  patch,
  editing,
  editorId,
  editButton,
  onEdit,
}: {
  row: ReviewRow;
  patch: PatchApi;
  editing: boolean;
  editorId: string;
  editButton: RefObject<HTMLButtonElement | null>;
  onEdit: () => void;
}) {
  const isDone = row.status === 'done';
  return (
    <div className="flex flex-col items-start gap-hair">
      <PrioritySelect
        value={row.priority}
        label={`Priority for ${row.name}`}
        onChange={(priority) =>
          patch.run(row, { priority }, { done: `Priority set to ${PRIORITY_LABEL[priority]}` })
        }
        className="h-8 w-full coarse:min-h-11"
      />
      <Button
        ref={editButton}
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={editing}
        aria-controls={editing ? editorId : undefined}
        aria-label={`Edit comment for ${row.name}`}
        onClick={onEdit}
      >
        Edit comment
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`${isDone ? 'Reopen' : 'Mark done'}: ${row.name}`}
        onClick={() =>
          patch.run(
            row,
            { status: isDone ? 'open' : 'done' },
            { done: isDone ? 'Reopened' : 'Marked done' },
          )
        }
      >
        {isDone ? 'Reopen' : 'Mark done'}
      </Button>
    </div>
  );
}

/**
 * The inline comment editor, in a full-width row under its item so it has
 * room on a phone. Checked on Save, not by disabling it (UX-16): an empty
 * comment is said under the field, which takes focus (UX-15). Escape or
 * Cancel closes it and returns focus to "Edit comment".
 */
function CommentEditor({
  id,
  row,
  patch,
  onClose,
}: {
  id: string;
  row: ReviewRow;
  patch: PatchApi;
  onClose: () => void;
}) {
  const [text, setText] = useState(row.comment);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus(), []);

  const save = () => {
    if (!text.trim()) {
      setFieldError(EMPTY_COMMENT);
      field.current?.focus();
      return;
    }
    setFieldError(null);
    patch.run(row, { comment: text }, { done: 'Comment saved', after: onClose });
  };

  return (
    <form
      id={id}
      noValidate
      aria-label={`Comment for ${row.name}`}
      className="panel-inset space-y-tight rounded-md p-stack"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <CommentField
        label={`Comment for ${row.name}`}
        value={text}
        onChange={setText}
        error={fieldError}
        fieldRef={field}
        onEscape={onClose}
      />
      <FormButtons submit="Save comment" pending={patch.pending} onCancel={onClose} />
    </form>
  );
}
