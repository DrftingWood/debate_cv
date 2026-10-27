'use client';

import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
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

const NEXT_DECISION: Record<DecisionKind, RowState['decision']> = {
  confirm: 'confirmed',
  reject: 'rejected',
  restore: null,
};

const LIST_TITLE = 'Tournaments listing your name';

/**
 * The Found tab's list and its decisions. Read-only as far as the CV goes:
 * every button records a decision and nothing else. Exact matches only, so
 * there are no tiers: every row is answered on its own ("This is me" / "Not
 * me"), never in bulk.
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
  const rootRef = useRef<HTMLDivElement | null>(null);
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

  const rowsProps = { stateOf, pendingKey, onDecide: decide };
  const undecided = view.candidates.some((r) => stateOf(r).decision == null);

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
      {view.capped.map((c) => (
        <p key={c.name} className="text-caption text-ink-soft">
          Too many matches for &ldquo;{c.name}&rdquo;: {c.total} on the tabs we store, showing the
          first {c.shown}, newest first. Mark the ones you know and come back for more.
        </p>
      ))}
      {view.overLimit > 0 ? (
        <p className="text-caption text-ink-soft">
          You have claimed more names than we search at once; {view.overLimit} of them{' '}
          {view.overLimit === 1 ? 'was' : 'were'} not searched this time.
        </p>
      ) : null}

      {!undecided ? (
        <p className="panel px-4 py-3 text-ui text-ink">
          You have answered every match we found. Anything you hid or marked is listed below.
        </p>
      ) : null}

      {view.candidates.length > 0 ? (
        <section aria-labelledby="found-candidates" className="space-y-3">
          <div>
            <h2
              id="found-candidates"
              tabIndex={-1}
              className="font-display text-h3 font-medium text-ink"
            >
              {LIST_TITLE} ({view.candidates.length})
            </h2>
            <p className="mt-1 text-ui text-ink-soft">
              Each lists a name you have claimed, spelled exactly the same, alone or with other
              words around it. The same name can belong to someone else, so answer each one.
            </p>
          </div>
          <FoundRows rows={view.candidates} label={LIST_TITLE} {...rowsProps} />
        </section>
      ) : null}

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
