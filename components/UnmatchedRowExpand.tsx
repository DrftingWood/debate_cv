'use client';

import { useState } from 'react';
import { CaretDown, UserFocus } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { ParticipantSearch } from '@/components/ParticipantSearch';

/**
 * Per-row "Find me" affordance for unmatched-status URLs on the dashboard.
 * Mirrors the per-row score-expand pattern from /cv: a ghost button that
 * toggles an inline ParticipantSearch panel. Keeps the table compact while
 * letting users claim themselves without leaving the page.
 */
export function UnmatchedRowExpand({
  tournamentId,
  tournamentName,
}: {
  tournamentId: string;
  tournamentName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        leftIcon={
          <CaretDown
            className={`h-3.5 w-3.5 transition-transform duration-180 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        }
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <UserFocus className="mr-1 h-3.5 w-3.5" aria-hidden />
        {open ? 'Hide search' : 'Find me'}
      </Button>
      {open ? (
        <div className="rounded-md border border-border bg-surface-2/20 p-3">
          <ParticipantSearch
            tournamentId={tournamentId}
            tournamentName={tournamentName}
            autoFocus
          />
        </div>
      ) : null}
    </div>
  );
}
