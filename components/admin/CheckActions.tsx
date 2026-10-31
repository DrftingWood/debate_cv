'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { useAddToReviewSet } from '@/components/admin/AddToReviewSet';
import { PageFlightContext } from '@/components/admin/pageFlight';
import { useMarkChecked } from '@/components/admin/useMarkChecked';
import { singleFlight } from '@/lib/utils/singleFlight';

/**
 * The buttons on one check of a tournament's page: "Mark checked" and "Review
 * later" on a failing or warning check, "Checked by X on D · Undo" on one an
 * admin has vouched for. They are the Inbox row's own actions (the same hook,
 * the same route, the same toast with Undo), so marking here raises the
 * score the same way: the route re-audits before it answers and the page
 * refreshes with the new figure.
 *
 * One hook serves every check on the page (CheckActionsProvider), so one
 * press runs at a time whichever row it is on (UX-17): two marks of one
 * tournament would otherwise re-audit it twice at once.
 */

type Marking = ReturnType<typeof useMarkChecked>;
const MarkingContext = createContext<Marking | null>(null);

const noop = () => {};

export function CheckActionsProvider({ children }: { children: ReactNode }) {
  // One flight for the whole page: the marks, Undo, Fix, Review later and the
  // bulk retries all run through it (pageFlight.ts), so none overlaps another.
  const [flight] = useState(singleFlight);
  return (
    <PageFlightContext.Provider value={flight}>
      <MarkingScope>{children}</MarkingScope>
    </PageFlightContext.Provider>
  );
}

/** Below the flight, so useMarkChecked finds it. */
function MarkingScope({ children }: { children: ReactNode }) {
  // Nothing is ticked on this page, so there is no selection to clear.
  const marking = useMarkChecked(noop);
  return (
    <MarkingContext.Provider value={marking}>
      {children}
      {/* One progress line and one refusal for the whole list, because one
          press runs at a time: said here once, not under every row. The
          status element is there from the first render, empty, so its words
          are announced when they appear (UX-19); a refusal stays until the
          next press (UX-20). */}
      <p role="status" aria-live="polite" className="text-caption text-ink-soft empty:hidden">
        {marking.undoing}
      </p>
      {marking.error ? (
        <p role="alert" className="text-caption text-destructive">
          {marking.error}
        </p>
      ) : null}
    </MarkingContext.Provider>
  );
}

/** The page's one marking hook, for any row that marks something (MarkControls). */
export function useMarking(): Marking {
  const marking = useContext(MarkingContext);
  if (!marking) throw new Error('This row needs a CheckActionsProvider around it');
  return marking;
}

export type CheckActionsProps = {
  tournamentName: string;
  label: string;
  /** The AdminCheck subject, `<tournamentId>:<code>`; also the review-set id. */
  subject: string;
  /** What Mark checked stores; null when the check has nothing to mark. */
  fingerprint: string | null;
  /** "Checked by owner on 31 Oct 2026" when a mark vouches for the check. */
  checkedWords: string | null;
};

export function CheckActions(props: CheckActionsProps) {
  const marking = useMarking();
  if (props.checkedWords) return <CheckedLine {...props} marking={marking} />;
  if (props.fingerprint)
    return <OpenCheckButtons {...props} fingerprint={props.fingerprint} marking={marking} />;
  return null;
}

/** "Checked by X on D · Undo". */
function CheckedLine({
  tournamentName,
  label,
  subject,
  checkedWords,
  marking,
}: CheckActionsProps & { marking: Marking }) {
  return (
    <div>
      <p className="flex flex-wrap items-center gap-x-inline text-caption text-ink-soft">
        <span>{checkedWords}</span>
        <span aria-hidden>·</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // Busy only while this row's own undo runs (the progress line says so); blocked,
          // like Mark checked, while another press on the page is running.
          loading={marking.undoBusy(`check:${subject}`)}
          aria-disabled={marking.blocked(subject) || undefined}
          aria-label={`Undo the mark on ${label} of ${tournamentName}`}
          onClick={() => marking.undo([{ kind: 'check', subject }])}
        >
          Undo
        </Button>
      </p>
    </div>
  );
}

function OpenCheckButtons({
  tournamentName,
  label,
  subject,
  fingerprint,
  marking,
}: CheckActionsProps & { fingerprint: string; marking: Marking }) {
  const review = useAddToReviewSet([{ source: 'audit_check', sourceId: subject }], {
    noun: 'check',
    onAdded: noop,
    label: 'Review later',
  });
  return (
    <div className="space-y-tight">
      <div className="flex flex-wrap items-start gap-inline">
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={marking.busy(subject)}
          aria-disabled={marking.blocked(subject) || undefined}
          aria-label={`Mark checked: ${label} of ${tournamentName}`}
          onClick={() =>
            marking.mark({
              id: subject,
              items: [{ kind: 'check', subject, fingerprint }],
              keys: [subject],
              what: `${tournamentName} · ${label}`,
            })
          }
        >
          Mark checked
        </Button>
        {review.button}
      </div>
      {review.panel}
    </div>
  );
}
