'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

type TagProposalControlsProps = {
  kind: 'region' | 'motion_type' | 'motion_topic';
  tournamentId: string;
  motionId?: string;
  options: string[];
  /** Human-readable labels for each option value — used for motion_type. */
  optionLabels?: Record<string, string>;
  /** The value that an admin has approved and written to the canonical column. */
  approvedValue: string | null;
  /** The current user's own proposal for this (kind, target), any status. */
  myProposal: { value: string; status: string; adminNote: string | null } | null;
  /** Pre-computed inference for motion_type rows — passed from the server so
   *  the vocabulary module doesn't have to be bundled twice. */
  suggestedValue?: string | null;
};

type ProposeResponse = { id: string; status: 'pending' };

/**
 * A single picker row in the /cv/tags editor. Combines:
 *   - a <select> seeded from the approved value → the user's pending
 *     proposal → the inferred suggestion → blank
 *   - a "Propose" button enabled only when the selection differs from
 *     both the approved value and any live pending proposal
 *   - a status hint below the controls (approved / pending / rejected)
 *
 * POSTs to /api/tags/propose, refreshes the RSC layer on success so the
 * page re-fetches the user's proposals from the database.
 */
export function TagProposalControls({
  kind,
  tournamentId,
  motionId,
  options,
  optionLabels,
  approvedValue,
  myProposal,
  suggestedValue,
}: TagProposalControlsProps) {
  const router = useRouter();
  const toast = useToast();

  // Seed the picker: approved value wins, then the user's own pending
  // proposal (so they see what they last submitted), then the suggestion,
  // then empty.
  const defaultSelection =
    approvedValue ??
    (myProposal?.status === 'pending' ? myProposal.value : null) ??
    suggestedValue ??
    '';

  const [selected, setSelected] = useState(defaultSelection);
  const [isPending, startTransition] = useTransition();

  // Disable the button when nothing useful has changed: the selection
  // matches the approved value (re-proposing an approved tag is a no-op),
  // or matches the live pending proposal (duplicate submission), or nothing
  // is selected yet.
  const livePendingValue =
    myProposal?.status === 'pending' ? myProposal.value : null;
  const isUnchanged =
    !selected ||
    selected === approvedValue ||
    selected === livePendingValue;

  const handlePropose = () => {
    startTransition(async () => {
      const body: Record<string, string> = { kind, tournamentId, value: selected };
      if (motionId) body.motionId = motionId;

      const result = await postJson<ProposeResponse>('/api/tags/propose', body);
      if (!result.ok) {
        toast.show({
          kind: 'error',
          title: 'Proposal failed',
          description: result.error,
        });
        return;
      }
      toast.show({
        kind: 'success',
        title: 'Proposal submitted',
        description: 'It will go live once an admin approves it.',
      });
      // RSC re-fetch picks up the new TagProposal row.
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={!!approvedValue || isPending}
          className={
            'h-9 rounded-md border border-ink/15 bg-paper px-2.5 text-table text-ink ' +
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ' +
            'disabled:opacity-50 disabled:cursor-not-allowed'
          }
          aria-label={`Select ${kind.replace('_', ' ')}`}
        >
          <option value="">Select…</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {optionLabels?.[opt] ?? opt}
            </option>
          ))}
        </select>

        {/* Only show the propose button when the tag isn't already approved —
            once approved there's nothing to propose. */}
        {!approvedValue ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={isPending}
            disabled={isUnchanged}
            onClick={handlePropose}
          >
            Propose
          </Button>
        ) : null}
      </div>

      {/* Status hint — one of three states */}
      {approvedValue ? (
        <p className="text-caption text-ink-soft">
          Approved:{' '}
          <span className="font-medium text-ink">
            {optionLabels?.[approvedValue] ?? approvedValue}
          </span>
        </p>
      ) : myProposal?.status === 'pending' ? (
        <p className="text-caption text-ink-soft">
          Pending review:{' '}
          <span className="font-medium text-ink">
            {optionLabels?.[myProposal.value] ?? myProposal.value}
          </span>
        </p>
      ) : myProposal?.status === 'rejected' ? (
        <p className="text-caption text-oxblood">
          Rejected
          {myProposal.adminNote ? ` — ${myProposal.adminNote}` : ''}
        </p>
      ) : suggestedValue && !selected ? (
        // Surface the auto-inference hint only before the user has interacted
        // and only when nothing else is shown.
        <p className="text-caption text-ink-soft">
          Suggested:{' '}
          <span className="font-medium">{optionLabels?.[suggestedValue] ?? suggestedValue}</span>
        </p>
      ) : null}
    </div>
  );
}
