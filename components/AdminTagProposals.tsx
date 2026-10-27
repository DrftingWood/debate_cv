'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson, type ApiResult } from '@/lib/utils/api';

type ProposalRow = {
  id: string;
  kind: string;
  value: string;
  status: string;
  adminNote: string | null;
  createdAt: string;
  userEmail: string | null;
  tournamentId: string;
  tournamentName: string;
  motionId: string | null;
  motionText: string | null;
  currentValue: string | null;
};

type ListResponse = { proposals: ProposalRow[] };
type ActionResponse = { id: string; status: string };

type StatusFilter = 'pending' | 'approved' | 'rejected';

const STATUS_LABELS: Record<StatusFilter, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

const MAX_APPROVE_ALL_PASSES = 40;

export type ApproveAllOutcome = {
  approved: number;
  /** True only when the endpoint reported an empty queue. */
  complete: boolean;
  error: string | null;
};

/**
 * Drives the bounded approve-all endpoint until it reports nothing left.
 *
 * `complete` is the point of this helper. The list used to be cleared after
 * the loop whatever happened, so a pass that failed half-way (or a queue
 * still non-empty after the pass cap) left the page saying "No pending
 * proposals" while some were still pending: a false status on the one
 * screen whose job is to show what is left. The caller now clears the list
 * only on `complete` and refetches otherwise.
 */
export async function approveAllInPasses(
  post: () => Promise<ApiResult<{ approved: number }>>,
  maxPasses = MAX_APPROVE_ALL_PASSES,
): Promise<ApproveAllOutcome> {
  let approved = 0;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const res = await post();
    if (!res.ok) return { approved, complete: false, error: res.error };
    approved += res.data.approved;
    if (res.data.approved === 0) return { approved, complete: true, error: null };
  }
  return { approved, complete: false, error: null };
}

/**
 * Client component that loads and manages the admin tag-proposal queue.
 * Fetches from GET /api/admin/tag-proposals?status=<filter> on mount and
 * whenever the status filter changes. Approve / Reject actions POST to
 * /api/admin/tag-proposals/<id> and optimistically remove the row from the
 * current list on success so the admin doesn't have to page-reload between
 * decisions.
 */
export function AdminTagProposals() {
  const toast = useToast();

  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [proposals, setProposals] = useState<ProposalRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline reject-note state: keyed by proposal id so multiple rows can
  // each have their own note field open at once.
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});

  // Bumped to refetch the current filter without changing it (after an
  // approve-all that did not finish).
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setProposals(null);

    void (async () => {
      try {
        const res = await fetch(`/api/admin/tag-proposals?status=${filter}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: ListResponse = await res.json();
        setProposals(data.proposals);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load proposals');
      } finally {
        setLoading(false);
      }
    })();
  }, [filter, reloadKey]);

  const [, startTransition] = useTransition();

  // Approve-all is two clicks on purpose: the first arms it, the second
  // does it. The list above is what the admin skims first, rejecting the odd
  // wrong row, so the button is the "everything else is fine" step.
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);

  const approveAll = async () => {
    setApprovingAll(true);
    try {
      // The endpoint approves a bounded chunk per call; keep asking until it
      // reports nothing left (bounded, so a stuck queue cannot loop forever).
      const outcome = await approveAllInPasses(() =>
        postJson<{ approved: number }>('/api/admin/tag-proposals/approve-all', {}),
      );
      const n = outcome.approved;
      if (n > 0) toast.show({ kind: 'success', title: `Approved ${n} tag${n === 1 ? '' : 's'}` });
      if (outcome.error) {
        toast.show({ kind: 'error', title: 'Approve all stopped', description: outcome.error });
      }
      if (outcome.complete) setProposals([]);
      else setReloadKey((k) => k + 1);
    } finally {
      setApprovingAll(false);
      setConfirmingAll(false);
    }
  };

  // Rows with a request in flight: stops a double click posting twice.
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const handleAction = (id: string, action: 'approve' | 'reject') => {
    if (busyIds.has(id)) return;
    setBusyIds((prev) => new Set(prev).add(id));
    const adminNote = action === 'reject' ? (rejectNotes[id] ?? '') : undefined;

    startTransition(async () => {
      const result = await postJson<ActionResponse>(
        `/api/admin/tag-proposals/${id}`,
        { action, adminNote: adminNote || undefined },
      );
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (!result.ok) {
        toast.show({ kind: 'error', title: `${action === 'approve' ? 'Approve' : 'Reject'} failed`, description: result.error });
        return;
      }
      toast.show({
        kind: 'success',
        title: action === 'approve' ? 'Approved' : 'Rejected',
      });
      // Optimistic removal: the row has moved to a different status, so it
      // no longer belongs in the current filter view.
      setProposals((prev) => prev?.filter((p) => p.id !== id) ?? null);
      // Clean up any stored reject note for this row.
      setRejectNotes((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  const kindLabel = (kind: string) =>
    kind === 'region'
      ? 'Region'
      : kind === 'motion_type'
        ? 'Motion type'
        : kind === 'motion_topic'
          ? 'Topic'
          : kind;

  return (
    <div className="space-y-6">
      {/* Status filter tabs */}
      <div className="flex gap-2" role="group" aria-label="Filter by status">
        {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            aria-pressed={filter === s}
            className={
              'h-8 rounded-md border px-3 text-ui font-medium transition-colors ' +
              (filter === s
                ? 'border-ink/30 bg-ink text-paper'
                : 'border-border bg-paper text-ink hover:bg-surface-2')
            }
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {filter === 'pending' && proposals && proposals.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant={confirmingAll ? 'primary' : 'outline'}
            loading={approvingAll}
            onClick={() => (confirmingAll ? void approveAll() : setConfirmingAll(true))}
          >
            {confirmingAll
              ? `Yes, approve all ${proposals.length} as shown`
              : `Approve all ${proposals.length} pending`}
          </Button>
          {confirmingAll && !approvingAll ? (
            <button
              type="button"
              className="text-caption text-ink-soft underline underline-offset-2 hover:text-ink"
              onClick={() => setConfirmingAll(false)}
            >
              Cancel
            </button>
          ) : (
            <span className="text-caption text-ink-soft">
              Reject any that look wrong first; this approves the rest.
            </span>
          )}
        </div>
      ) : null}

      {loading ? (
        <p className="text-body text-ink-soft italic">Loading…</p>
      ) : error ? (
        <p className="text-body text-destructive">{error}</p>
      ) : !proposals || proposals.length === 0 ? (
        <p className="text-body text-ink-soft italic">
          No {filter} proposals.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-max text-table">
            <thead>
              <tr className="border-y border-border text-left uppercase tracking-[0.14em] text-kicker font-semibold text-ink-soft">
                <th className="whitespace-nowrap px-4 py-2.5 font-medium">Kind</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium">Proposed value</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium">Current value</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium">Tournament</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium">Motion</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium">Proposer</th>
                <th className="whitespace-nowrap px-3 py-2.5 font-medium">Date</th>
                {filter === 'pending' ? (
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Actions</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => (
                <tr key={p.id} className="align-top border-b border-border hover:bg-surface-2">
                  <td className="whitespace-nowrap px-4 py-2.5">{kindLabel(p.kind)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-medium text-ink">{p.value}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-ink-soft">
                    {p.currentValue ?? <span className="italic">none</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="block max-w-[14rem] truncate" title={p.tournamentName}>
                      {p.tournamentName}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {p.motionText ? (
                      <span
                        className="block max-w-[18rem] truncate text-ink-soft"
                        title={p.motionText}
                      >
                        {p.motionText}
                      </span>
                    ) : (
                      <span className="text-ink-soft italic">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-ink-soft">
                    {p.userEmail ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-ink-soft">
                    {formatDate(p.createdAt)}
                  </td>
                  {filter === 'pending' ? (
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="primary"
                            aria-label={`Approve ${kindLabel(p.kind).toLowerCase()} ${p.value} for ${p.tournamentName}`}
                            disabled={busyIds.has(p.id)}
                            onClick={() => handleAction(p.id, 'approve')}
                          >
                            Approve
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            aria-label={`Reject ${kindLabel(p.kind).toLowerCase()} ${p.value} for ${p.tournamentName}`}
                            disabled={busyIds.has(p.id)}
                            onClick={() => handleAction(p.id, 'reject')}
                          >
                            Reject
                          </Button>
                        </div>
                        {/* Inline optional reject-note field. Only rendered
                            after admin types into it — doesn't expand until
                            focused, keeping the table tidy for pure approvals. */}
                        <input
                          type="text"
                          placeholder="Rejection note (optional)"
                          aria-label={`Rejection note for ${p.value}, ${p.tournamentName} (optional)`}
                          value={rejectNotes[p.id] ?? ''}
                          onChange={(e) =>
                            setRejectNotes((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                          className={
                            'h-7 w-48 rounded border border-border bg-paper px-2 text-caption ' +
                            'text-ink placeholder:text-ink-soft focus:outline-none ' +
                            'focus:ring-1 focus:ring-ring'
                          }
                        />
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
