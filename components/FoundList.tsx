'use client';

import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Button } from '@/components/ui/Button';
import { FoundBulkDialog } from '@/components/FoundBulkDialog';
import { FoundRows, type RowState } from '@/components/FoundRows';
import { decisionError, decisionNote, type DecisionKind } from '@/lib/discovery/messages';
import { rowLabel, type FoundView, type RowView } from '@/lib/discovery/view';

type Item = { tournamentId: string; personId: string; decision: DecisionKind };
type SendResult = { ok: true } | { ok: false; message: string };

async function send(items: Item[]): Promise<SendResult> {
  try {
    const res = await fetch('/api/discovery/decisions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
    return { ok: false, message: decisionError(res.status, data.error, data.reason) };
  } catch (err) {
    // A network failure: the decision was not saved, and the message says so.
    console.error('[found] decision request failed', err);
    return { ok: false, message: decisionError(0, undefined) };
  }
}

const TIERS = [
  {
    key: 'strong',
    title: 'Strong matches',
    blurb: 'Your name, and one of your teammates was there.',
  },
  {
    key: 'possible',
    title: 'Possible matches',
    blurb: 'Your name or a close spelling, with nothing else to back it up. Check each one.',
  },
  {
    key: 'ambiguous',
    title: 'Names that could be someone else’s',
    blurb: 'One-word names and double surnames. Only you can tell.',
  },
  {
    key: 'blocked',
    title: 'Cannot be you',
    blurb: 'These clash, in the same round, with a tournament you marked as you.',
  },
] as const;

const NEXT_DECISION: Record<DecisionKind, RowState['decision']> = {
  confirm: 'confirmed',
  reject: 'rejected',
  restore: null,
};

/**
 * The Found tab's list and its decisions. Read-only as far as the CV goes:
 * every button records a decision and nothing else.
 *
 * One polite live region, present from the first render, carries every
 * result (UX-19); errors render inline as an alert and stay until the next
 * action (UX-20). After a decision, focus moves to the next row's first
 * button, or to the row's own Undo when it was the last (UX-7).
 */
export function FoundList({ view }: { view: FoundView }) {
  const [local, setLocal] = useState<Record<string, RowState>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const bulkTriggerRef = useRef<HTMLButtonElement | null>(null);
  const focusAfter = useRef<string | null>(null);

  const stateOf = useCallback(
    (row: RowView): RowState => local[row.key] ?? { decision: row.decision, note: null },
    [local],
  );

  // Applied after the render that follows a decision, once the row's new
  // controls exist. Only rows that are displayed count (the table and the
  // cards both carry each row; one of them is hidden by breakpoint).
  useEffect(() => {
    const key = focusAfter.current;
    const root = rootRef.current;
    if (!key || !root) return;
    focusAfter.current = null;
    const rows = [...root.querySelectorAll<HTMLElement>('[data-row-key]')].filter(
      (el) => el.offsetParent !== null,
    );
    const at = rows.findIndex((el) => el.dataset.rowKey === key);
    for (const el of rows.slice(at + 1)) {
      const next = el.querySelector<HTMLElement>('[data-first-action]');
      if (next) {
        next.focus();
        return;
      }
    }
    rows[at]?.querySelector<HTMLElement>('[data-undo-for]')?.focus();
  });

  const decide = useCallback(async (row: RowView, kind: DecisionKind) => {
    setPendingKey(row.key);
    setError(null);
    const result = await send([
      { tournamentId: row.tournamentId, personId: row.personId, decision: kind },
    ]);
    setPendingKey(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const note = decisionNote(kind, rowLabel(row));
    setLocal((prev) => ({
      ...prev,
      [row.key]: { decision: NEXT_DECISION[kind], note: kind === 'restore' ? null : note },
    }));
    setStatus(note);
    if (kind !== 'restore') focusAfter.current = row.key;
  }, []);

  const strongOpen = view.strong.filter((r) => stateOf(r).decision == null);
  const closeBulk = useCallback(() => {
    setBulkOpen(false);
    setBulkError(null);
    bulkTriggerRef.current?.focus();
  }, []);

  const confirmBulk = useCallback(async () => {
    setBulkPending(true);
    const items = strongOpen.map((r) => ({
      tournamentId: r.tournamentId,
      personId: r.personId,
      decision: 'confirm' as const,
    }));
    const result = await send(items);
    setBulkPending(false);
    if (!result.ok) {
      setBulkError(result.message);
      return;
    }
    setLocal((prev) => {
      const next = { ...prev };
      for (const r of strongOpen) {
        next[r.key] = { decision: 'confirmed', note: decisionNote('confirm', rowLabel(r)) };
      }
      return next;
    });
    setStatus(`Marked ${items.length} tournaments as you. Nothing is added to your record yet.`);
    setBulkOpen(false);
    document.getElementById('found-strong')?.focus();
  }, [strongOpen]);

  const rowsProps = { stateOf, pendingKey, onDecide: decide };
  const undecided = TIERS.some((t) => view[t.key].some((r) => stateOf(r).decision == null));

  return (
    <div ref={rootRef} className="space-y-8">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {error ? (
        <p role="alert" className="panel border-destructive px-4 py-3 text-ui text-ink">
          {error}
        </p>
      ) : null}
      {view.truncated ? (
        <p className="text-caption text-ink-soft">
          Your name is shared by many people on the tabs we store, so this list stops at the first
          few hundred. Mark the ones you know and come back for more.
        </p>
      ) : null}

      {strongOpen.length > 0 ? (
        <div className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-ui text-ink">
            {strongOpen.length} strong {strongOpen.length === 1 ? 'match has' : 'matches have'} your
            name and one of your teammates.
          </p>
          <Button
            ref={bulkTriggerRef}
            type="button"
            className="w-full sm:w-auto"
            onClick={() => setBulkOpen(true)}
          >
            Review all {strongOpen.length} strong matches
          </Button>
        </div>
      ) : null}

      {!undecided ? (
        <p className="panel px-4 py-3 text-ui text-ink">
          You have answered every match we found. Anything you hid or marked is listed below.
        </p>
      ) : null}

      {TIERS.map((tier) =>
        view[tier.key].length > 0 ? (
          <section key={tier.key} aria-labelledby={`found-${tier.key}`} className="space-y-3">
            <div>
              <h2
                id={`found-${tier.key}`}
                tabIndex={-1}
                className="font-display text-h3 font-medium text-ink"
              >
                {tier.title} ({view[tier.key].length})
              </h2>
              <p className="mt-1 text-ui text-ink-soft">{tier.blurb}</p>
            </div>
            <FoundRows rows={view[tier.key]} label={tier.title} {...rowsProps} />
          </section>
        ) : null,
      )}

      <DecidedSection
        title="Marked as you"
        blurb="Nothing is added to your record yet. Adding these is the next step we build."
        rows={view.confirmed}
        rowsProps={rowsProps}
      />
      <DecidedSection
        title="Hidden"
        blurb="Tournaments you said are not you. They stay hidden until you show them again."
        rows={view.hidden}
        rowsProps={rowsProps}
      />

      {bulkOpen ? (
        <FoundBulkDialog
          rows={strongOpen}
          pending={bulkPending}
          error={bulkError}
          onConfirm={confirmBulk}
          onClose={closeBulk}
        />
      ) : null}
    </div>
  );
}

/** Earlier decisions, collapsed so the undecided list leads the page. */
function DecidedSection({
  title,
  blurb,
  rows,
  rowsProps,
}: {
  title: string;
  blurb: string;
  rows: readonly RowView[];
  rowsProps: Omit<ComponentProps<typeof FoundRows>, 'rows' | 'label'>;
}) {
  if (rows.length === 0) return null;
  return (
    <details className="panel p-4">
      <summary className="min-h-6 cursor-pointer font-display text-h4 font-medium text-ink">
        {title} ({rows.length})
      </summary>
      <p className="mt-2 text-ui text-ink-soft">{blurb}</p>
      <div className="mt-3">
        <FoundRows rows={rows} label={title} {...rowsProps} />
      </div>
    </details>
  );
}
