'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

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
  }, [filter]);

  const [, startTransition] = useTransition();

  const handleAction = (id: string, action: 'approve' | 'reject') => {
    const adminNote = action === 'reject' ? (rejectNotes[id] ?? '') : undefined;

    startTransition(async () => {
      const result = await postJson<ActionResponse>(
        `/api/admin/tag-proposals/${id}`,
        { action, adminNote: adminNote || undefined },
      );
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
            className={
              'h-8 rounded-md border px-3 text-ui font-medium transition-colors ' +
              (filter === s
                ? 'border-ink/30 bg-ink text-paper'
                : 'border-ink/15 bg-paper text-ink hover:bg-ink/[0.04]')
            }
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

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
              <tr className="border-y border-ink/15 text-left uppercase tracking-[0.14em] text-kicker font-semibold text-ink-soft">
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
                <tr key={p.id} className="align-top border-b border-ink/10 hover:bg-ink/[0.02]">
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
                            onClick={() => handleAction(p.id, 'approve')}
                          >
                            Approve
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
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
                          value={rejectNotes[p.id] ?? ''}
                          onChange={(e) =>
                            setRejectNotes((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                          className={
                            'h-7 w-48 rounded border border-ink/15 bg-paper px-2 text-caption ' +
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
