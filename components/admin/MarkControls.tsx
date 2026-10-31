'use client';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useMarking } from '@/components/admin/CheckActions';
import type { MarkCell } from '@/lib/admin/markCell';

/**
 * "Mark checked" for a row of the Imports, Reports and Parser tabs, and
 * "Checked by X on D · Undo" once a mark holds. The same hook, route and
 * fingerprint as the Inbox row's own button (lib/admin/inbox.ts defines each
 * kind's fingerprint), so a mark made here also clears the item from the
 * Inbox, and one made there clears it here.
 *
 * It takes its hook from the page's one provider (CheckActionsProvider), so
 * one press runs at a time whichever row it is on (UX-17), and the progress
 * line and any refusal are said once for the table, not under every row.
 * "Changed since you checked it" labels a row that came back because the data
 * moved after the last mark.
 */
export function MarkControls({ cell, name }: { cell: MarkCell; name: string }) {
  const marking = useMarking();
  const id = `${cell.kind}:${cell.subject}`;
  if (cell.checkedWords) {
    return (
      <p className="flex flex-wrap items-center gap-x-inline text-caption text-ink-soft">
        <span>{cell.checkedWords}</span>
        <span aria-hidden>·</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // Busy while its own undo runs (the shared status line says so);
          // blocked, like Mark checked, while another press is running.
          loading={marking.undoing !== ''}
          aria-disabled={marking.blocked(id) || undefined}
          aria-label={`Undo the mark on ${name}`}
          onClick={() => marking.undo([{ kind: cell.kind, subject: cell.subject }])}
        >
          Undo
        </Button>
      </p>
    );
  }
  return (
    <div className="flex flex-col items-start gap-hair">
      {cell.changed ? (
        <Badge variant="warning" className="whitespace-normal">
          Changed since you checked it
        </Badge>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={marking.busy(id)}
        aria-disabled={marking.blocked(id) || undefined}
        aria-label={`Mark checked: ${name}`}
        onClick={() =>
          marking.mark({
            id,
            items: [{ kind: cell.kind, subject: cell.subject, fingerprint: cell.fingerprint }],
            keys: [id],
            what: name,
          })
        }
      >
        Mark checked
      </Button>
    </div>
  );
}
