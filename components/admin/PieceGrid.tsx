'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowClockwise } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { rescrapeFailureMessage } from '@/lib/admin/actionMessage';
import {
  piecesPayload,
  rescrapePieces,
  resultLine,
  selectFailed,
  validateSelection,
  type PieceCard,
} from '@/lib/admin/pieceGrid';
import { singleFlight } from '@/lib/utils/singleFlight';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The picker on /admin/tournaments/[id]: tick any tab or round, then
 * re-scrape just those pages. Re-scraping is not destructive (a piece that
 * fails again keeps the rows it had), so there is no confirmation.
 *
 * The request runs the scrape inline and can take most of a minute, so the
 * button holds its spinner and the status line says what is happening until
 * the refreshed grid lands.
 */
export function PieceGrid({
  tournamentId,
  tabs,
  rounds,
}: {
  tournamentId: string;
  tabs: PieceCard[];
  rounds: PieceCard[];
}) {
  const all = [...tabs, ...rounds];
  const picker = usePiecePicker(tournamentId, all);
  return <PieceGridView tabs={tabs} rounds={rounds} {...picker} />;
}

/** The selection, the request and its outcome, as the view's props. */
function usePiecePicker(tournamentId: string, all: PieceCard[]) {
  const router = useRouter();
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  // Only ids still on the page count: after a refresh a piece the tab no
  // longer lists is gone, and the button must not keep counting it.
  const selected = new Set(all.filter((p) => ticked.has(p.id)).map((p) => p.id));
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [flight] = useState(singleFlight);

  const onSubmit = () => {
    // One request at a time (UX-17): `pending` turns true a render late, the
    // flight flag at once.
    if (pending || flight.busy) return;
    const invalid = validateSelection(selected.size);
    if (invalid) {
      setError(invalid);
      return;
    }
    const body = piecesPayload(all, selected);
    setError(null);
    setResult(null);
    setRunning(body.pieces.length);
    startTransition(async () => {
      const response = await flight.run(() => rescrapePieces(tournamentId, body));
      if (!response) return;
      if (!response.ok) {
        setError(rescrapeFailureMessage(response));
        return;
      }
      setResult(resultLine(response.data));
      setTicked(new Set());
      // Its own transition, so the spinner holds until the refreshed cards
      // arrive instead of the old statuses flashing back for a beat.
      startTransition(() => router.refresh());
    });
  };

  return {
    selected,
    running: pending ? running : null,
    error,
    result,
    onSubmit,
    onToggle: (id: string) =>
      setTicked((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    onSelectFailed: () => {
      setError(null);
      setTicked((prev) => new Set([...prev, ...selectFailed(all)]));
    },
    onClear: () => {
      setError(null);
      setTicked(new Set());
    },
  };
}

type ViewProps = {
  tabs: PieceCard[];
  rounds: PieceCard[];
  selected: ReadonlySet<string>;
  /** Pieces in flight, or null when idle. */
  running: number | null;
  error: string | null;
  result: string | null;
  onToggle: (id: string) => void;
  onSelectFailed: () => void;
  onClear: () => void;
  onSubmit: () => void;
};

/**
 * The grid and its actions, apart from the state so a server render can
 * show any moment of it. A form, so Enter on a focused checkbox submits
 * like the button does.
 */
export function PieceGridView({ tabs, rounds, selected, onToggle, ...actions }: ViewProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    actions.onSubmit();
  };
  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-group">
      <ActionBar count={selected.size} {...actions} />
      {tabs.length > 0 ? (
        <PieceGroup legend="Tabs" pieces={tabs} selected={selected} onToggle={onToggle} />
      ) : null}
      {rounds.length > 0 ? (
        <PieceGroup legend="Rounds" pieces={rounds} selected={selected} onToggle={onToggle} />
      ) : null}
    </form>
  );
}

/**
 * The three actions, the status line and the error.
 *
 * The status line is the page's one polite live region (UX-19): rendered,
 * empty, from the first paint (not `display: none`, which some screen
 * readers treat as absent), so what is written into it is announced. It
 * carries the progress sentence while a request runs (UX-22: a spinner
 * alone for most of a minute looks hung) and the outcome after. A refusal
 * is an alert instead, because it asks the admin to act.
 */
function ActionBar({
  count,
  running,
  error,
  result,
  onSelectFailed,
  onClear,
}: Pick<ViewProps, 'running' | 'error' | 'result' | 'onSelectFailed' | 'onClear'> & {
  count: number;
}) {
  const errorId = useId();
  const statusId = useId();
  const busy = running != null;
  return (
    <div className="space-y-tight">
      <div className="flex flex-wrap items-center gap-inline">
        <Button
          type="submit"
          size="sm"
          loading={busy}
          leftIcon={<ArrowClockwise className="h-4 w-4" aria-hidden />}
          aria-describedby={error ? errorId : busy ? statusId : undefined}
        >
          Re-scrape selected ({count})
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onSelectFailed}>
          Select failed
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>
      <p id={statusId} role="status" className="font-mono text-caption tabular-nums text-ink-soft">
        {busy ? `Re-scraping ${plural(running, 'piece')}… This can take up to a minute.` : result}
      </p>
      {error ? (
        <p id={errorId} role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PieceGroup({
  legend,
  pieces,
  selected,
  onToggle,
}: {
  legend: string;
  pieces: PieceCard[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const failed = pieces.filter((p) => p.status === 'failed').length;
  return (
    <fieldset className="space-y-tight">
      {/* A heading inside the legend: the group keeps its name for the
          checkboxes, and heading navigation still finds "Tabs" and
          "Rounds" under the tournament's h1 (UX-3). */}
      <legend className="w-full">
        <h2 className="font-display text-h3 font-medium text-ink">
          {legend}
          <span className="ml-inline font-mono text-caption font-normal tabular-nums text-ink-soft">
            {plural(pieces.length, 'piece')}
            {failed ? ` · ${failed} failed` : ''}
          </span>
        </h2>
      </legend>
      {/* Columns that fill the content width at every step, so the outer
          card edges sit on the page's 20px gutter from a 390px phone (one
          column) to 1280px (four). The gap is the same 12px both ways. */}
      <ul className="grid grid-cols-1 gap-tight sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {pieces.map((p) => (
          <li key={p.id}>
            <PieceCardView piece={p} checked={selected.has(p.id)} onToggle={onToggle} />
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/**
 * One piece: a label wrapping the whole card, so the card is the target
 * (well past 44px tall) and not just the 24px box (UX-8). The checkbox is
 * named by the piece alone ("R2"), the words the admin sees and would say
 * (UX-11); the status and time are its description. Selection shows as the
 * tick itself, and failure as an icon and words, never colour alone (UX-34).
 */
function PieceCardView({
  piece,
  checked,
  onToggle,
}: {
  piece: PieceCard;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  const detailId = useId();
  return (
    <label className="panel flex h-full cursor-pointer items-start gap-tight p-tight transition-colors hover:bg-surface-2 has-checked:border-primary has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background">
      <input
        type="checkbox"
        className="h-6 w-6 shrink-0 accent-primary"
        checked={checked}
        onChange={() => onToggle(piece.id)}
        aria-label={piece.label}
        aria-describedby={detailId}
      />
      <span className="min-w-0 flex-1 space-y-hair">
        <span className="block leading-6 font-medium wrap-break-word text-ink">{piece.label}</span>
        <span id={detailId} className="block space-y-hair">
          <StatusPill
            status={piece.status === 'ok' ? 'done' : 'failed'}
            label={piece.pill}
            className="flex"
          />
          <span className="block font-mono text-caption tabular-nums text-ink-soft">
            {piece.timeLabel} <time dateTime={piece.time.iso}>{piece.time.text}</time>
            {piece.attempts > 0 ? ` · ${plural(piece.attempts, 'attempt')}` : ''}
          </span>
        </span>
      </span>
    </label>
  );
}
