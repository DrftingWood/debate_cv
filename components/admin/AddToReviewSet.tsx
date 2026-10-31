'use client';

import { useEffect, useId, useRef, useState, useTransition, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { Flag } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { reviewSetFailureMessage } from '@/lib/admin/actionMessage';
import {
  COMMENT_MAX,
  PRIORITIES,
  PRIORITY_LABEL,
  type FlagItem,
  type Priority,
} from '@/lib/admin/reviewSetTypes';
import { usePageFlight } from '@/components/admin/pageFlight';
import { postJson } from '@/lib/utils/api';
import { singleFlight } from '@/lib/utils/singleFlight';

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** A field's border reaches 3:1 (UX-18); the focus ring is full strength (UX-10). */
export const FIELD_CLASS =
  'rounded-md border border-input bg-paper px-2.5 text-table text-ink focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-1';

export const EMPTY_COMMENT = 'Write a comment: what should be checked?';

/** High / Medium / Low, in that order; named by a visible label or an aria-label. */
export function PrioritySelect({
  value,
  onChange,
  id,
  label,
  selectRef,
  className,
}: {
  value: Priority;
  onChange: (p: Priority) => void;
  id?: string;
  /** The accessible name when no visible <label> points at `id`. */
  label?: string;
  selectRef?: RefObject<HTMLSelectElement | null>;
  className?: string;
}) {
  return (
    <select
      id={id}
      ref={selectRef}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value as Priority)}
      className={`${FIELD_CLASS} ${className ?? ''}`}
    >
      {PRIORITIES.map((p) => (
        <option key={p} value={p}>
          {PRIORITY_LABEL[p]}
        </option>
      ))}
    </select>
  );
}

/**
 * The status line (present from the first render, so its words are
 * announced, UX-19) and, when there is one, the failure as an alert.
 */
export function ActionStatus({ message, error }: { message: string; error: string | null }) {
  return (
    <>
      <p role="status" aria-live="polite" className="text-caption text-ink-soft empty:hidden">
        {message}
      </p>
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}

/**
 * A review-set comment: a visible label, the 1,000-character cap, and its
 * error in text under the field, linked by aria-describedby (UX-13, UX-15).
 * Shared by "Add to review set" and the ledger's inline editor.
 */
export function CommentField({
  label,
  value,
  onChange,
  error,
  fieldRef,
  hint,
  onEscape,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  hint?: string;
  onEscape?: () => void;
}) {
  const id = useId();
  const errId = useId();
  const hintId = useId();
  const described = [error ? errId : null, hint ? hintId : null].filter(Boolean).join(' ');
  return (
    <div className="space-y-hair">
      <label htmlFor={id} className="block text-caption font-medium text-ink">
        {label}
      </label>
      <textarea
        id={id}
        ref={fieldRef}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && onEscape) onEscape();
        }}
        rows={3}
        maxLength={COMMENT_MAX}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        className={`${FIELD_CLASS} block w-full py-1.5`}
      />
      {error ? (
        <p id={errId} className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-caption text-ink-soft">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The POST and its outcome, one at a time (UX-17). A success is passive
 * news, so it is a toast (UX-20) and a refresh, which shows the rows'
 * "Flagged" badges; a failure stays on screen as an alert, in words (UX-23).
 */
function useSendFlags(noun: string) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [own] = useState(singleFlight);
  const flight = usePageFlight(own);

  const send = (
    body: { items: readonly FlagItem[]; priority: Priority; comment: string },
    onDone: () => void,
  ) => {
    if (pending || flight.busy) return;
    setError(null);
    startTransition(async () => {
      const result = await flight.run(() =>
        postJson<{ flagged: number }>('/api/admin/review-set', body),
      );
      if (!result) return;
      if (!result.ok) {
        setError(reviewSetFailureMessage(result));
        return;
      }
      toast.show({
        kind: 'success',
        title: `${plural(result.data.flagged, noun)} in the review set`,
        description: 'Find them under Flagged for review.',
      });
      onDone();
      startTransition(() => router.refresh());
    });
  };
  return { send, error, setError, pending, busy: () => pending || flight.busy };
}

/**
 * "Add to review set" for a table's ticked rows (owner, 2026-10-31:
 * "prioritize some errors and bring to a separate set ... prioritize and
 * add a comment"). The Failed imports table uses it now; the CV reports and
 * parser warnings tables join in Task 5d, each passing its own `items`.
 *
 * Returned as two pieces, as useFirstRows returns its control: the `button`
 * goes in the table's action bar beside Retry, and the `panel` (the inline
 * form, the status line and any error) goes under the bar, at full width.
 *
 * The form is checked on press, not by disabling its button (UX-16): no
 * ticked rows is said beside the button; an empty comment is said under the
 * field, which is marked invalid and takes focus (UX-15).
 */
type ReviewOptions = {
  noun: string;
  onAdded: () => void;
  /** The trigger's words; "Add to review set" unless the caller says how many. */
  label?: string;
};

export function useAddToReviewSet(
  items: readonly FlagItem[],
  { noun, onAdded, label = 'Add to review set' }: ReviewOptions,
) {
  const [open, setOpen] = useState(false);
  const form = useFlagForm();
  const req = useSendFlags(noun);
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  // Cancel, Escape and a sent form all close it; focus goes back to the
  // button that opened it, not to <body>, which the form's removal would
  // otherwise leave it on (UX-7).
  const close = () => closeAndRefocus(setOpen, trigger.current);

  const submit = () => {
    if (req.busy()) return;
    req.setError(null);
    form.comment.setError(null);
    if (items.length === 0) return req.setError(`Tick at least one ${noun} to add.`);
    if (!form.check()) return;
    req.send({ items, priority: form.priority.value, comment: form.comment.value }, () => {
      close();
      form.reset();
      onAdded();
    });
  };

  const button = (
    <Button
      ref={trigger}
      type="button"
      variant="outline"
      size="sm"
      leftIcon={<Flag className="h-4 w-4" aria-hidden />}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={() => {
        req.setError(null);
        form.comment.setError(null);
        setOpen((v) => !v);
      }}
    >
      {label}
    </Button>
  );

  const panel = (
    <div id={panelId} className="space-y-tight">
      {open ? (
        <AddForm
          n={items.length}
          priority={form.priority}
          comment={form.comment}
          pending={req.pending}
          onSubmit={submit}
          onCancel={close}
        />
      ) : null}
      <ActionStatus
        message={req.pending ? `Adding ${plural(items.length, noun)} to the review set…` : ''}
        error={req.error}
      />
    </div>
  );

  // `open` lets another control (a row's "Review later") bring the form up;
  // the form then takes focus itself, as it does when the button opens it.
  return { button, panel, open: () => setOpen(true) };
}

/** Closes a form and puts focus back on its trigger, once the form has gone. */
export function closeAndRefocus(
  setOpen: (open: boolean) => void,
  trigger: { focus: () => void } | null,
) {
  setOpen(false);
  requestAnimationFrame(() => trigger?.focus());
}

/** Escape from anywhere in a form closes it (WCAG 2.1.2: no keyboard trap). */
export function escapeCloses(onClose: () => void) {
  return (e: { key: string; preventDefault: () => void }) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    onClose();
  };
}

/** The form's two fields: priority (Medium to start) and the comment with its error. */
function useFlagForm() {
  const [priority, setPriority] = useState<Priority>('medium');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  return {
    priority: { value: priority, set: setPriority },
    comment: { value: comment, set: setComment, error, setError, ref },
    /** False, with the error said under the field and focus on it, for an empty comment. */
    check: () => {
      if (comment.trim()) return true;
      setError(EMPTY_COMMENT);
      ref.current?.focus();
      return false;
    },
    reset: () => {
      setComment('');
      setPriority('medium');
    },
  };
}

type AddFormProps = {
  n: number;
  priority: ReturnType<typeof useFlagForm>['priority'];
  comment: ReturnType<typeof useFlagForm>['comment'];
  pending: boolean;
  onSubmit: () => void;
  onCancel: () => void;
};

function AddForm({ n, priority, comment, pending, onSubmit, onCancel }: AddFormProps) {
  const priorityId = useId();
  const priorityRef = useRef<HTMLSelectElement>(null);
  // Opening moves focus to the form's first field, so a keyboard user lands
  // where the next step is instead of on a button that only toggles.
  useEffect(() => priorityRef.current?.focus(), []);
  return (
    <form
      noValidate
      aria-label="Add to review set"
      className="panel-inset space-y-tight rounded-md p-stack"
      onKeyDown={escapeCloses(onCancel)}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex flex-wrap items-start gap-stack">
        <div className="space-y-hair">
          <label htmlFor={priorityId} className="block text-caption font-medium text-ink">
            Priority
          </label>
          <PrioritySelect
            id={priorityId}
            selectRef={priorityRef}
            value={priority.value}
            onChange={priority.set}
            className="h-9 coarse:min-h-11"
          />
        </div>
        <div className="min-w-0 flex-1 basis-64">
          <CommentField
            label="Comment"
            value={comment.value}
            onChange={comment.set}
            error={comment.error}
            fieldRef={comment.ref}
            hint={`What to check, for whoever picks this up. Up to ${COMMENT_MAX.toLocaleString('en-GB')} characters.`}
          />
        </div>
      </div>
      <FormButtons submit={`Add ${n} to review set`} pending={pending} onCancel={onCancel} />
    </form>
  );
}

/** A form's submit and Cancel; a pending submit stays focusable and swallows presses. */
export function FormButtons({
  submit,
  pending,
  onCancel,
}: {
  submit: string;
  pending: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-inline">
      <Button type="submit" size="sm" loading={pending}>
        {submit}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
