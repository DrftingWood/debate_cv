'use client';

import { useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowsClockwise, Trash, Warning } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { FieldError, fieldInputClass } from '@/components/FieldError';
import { useFocusAfterRender } from '@/components/useFocusAfterRender';
import { postJson } from '@/lib/utils/api';

type ClearResponse = {
  mode?: 'standard' | 'full';
  cleared: Record<string, number>;
};

type ReingestResponse = {
  queued: number;
  skippedLocked?: number;
};

/**
 * The inline confirmation the account page uses (UX-17, UX-69): the trigger
 * is quiet, the final button is the only `danger` one and names the
 * consequence, focus starts on Cancel (or on the typed field), and there is
 * no native confirm/prompt dialog that cannot say what will happen in-page.
 * `phrase` adds a typed confirmation for the irreversible actions.
 */
function ConfirmAction({
  triggerLabel,
  triggerIcon,
  triggerVariant = 'outline',
  summary,
  detail,
  confirmLabel,
  confirmVariant = 'danger',
  phrase,
  pending,
  onConfirm,
}: {
  triggerLabel: string;
  triggerIcon: ReactNode;
  triggerVariant?: 'outline' | 'secondary';
  summary: string;
  detail?: ReactNode;
  confirmLabel: string;
  confirmVariant?: 'danger' | 'primary';
  phrase?: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusAfterRender = useFocusAfterRender();
  const id = useId();

  if (!confirming) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant={triggerVariant}
        leftIcon={triggerIcon}
        onClick={() => {
          setConfirming(true);
          focusAfterRender(phrase ? inputRef : cancelRef);
        }}
      >
        {triggerLabel}
      </Button>
    );
  }

  const cancel = () => {
    setConfirming(false);
    setTyped('');
    setError(null);
    focusAfterRender(triggerRef);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (phrase && typed.trim() !== phrase) {
      setError(`Type ${phrase} exactly to confirm`);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    onConfirm();
    setConfirming(false);
    setTyped('');
    focusAfterRender(triggerRef);
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-labelledby={`${id}-summary`}
      className="space-y-3 rounded-card border border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.06)] p-4"
    >
      <div className="flex items-start gap-3">
        <Warning weight="light" className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
        <div className="space-y-1">
          <p id={`${id}-summary`} className="text-ui font-semibold text-destructive">
            {summary}
          </p>
          {detail ? <p className="text-caption text-ink-soft">{detail}</p> : null}
        </div>
      </div>
      {phrase ? (
        <div className="space-y-hair">
          <label htmlFor={`${id}-phrase`} className="block text-ui font-medium text-ink">
            Type <strong>{phrase}</strong> to confirm
          </label>
          {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
          <input
            ref={inputRef}
            id={`${id}-phrase`}
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className={fieldInputClass}
          />
        </div>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button ref={cancelRef} type="button" variant="ghost" size="sm" onClick={cancel}>
          Cancel
        </Button>
        <Button type="submit" variant={confirmVariant} size="sm" loading={pending}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}

export function ClearDataButton() {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  return (
    <ConfirmAction
      triggerLabel="Clear all data"
      triggerIcon={<Trash className="h-4 w-4" aria-hidden />}
      summary="This permanently deletes all scraped tournament data and resets ingest state."
      detail="User identity claims (Person records) are preserved."
      confirmLabel="Delete scraped tournament data"
      pending={isPending}
      onConfirm={() =>
        startTransition(async () => {
          const result = await postJson<ClearResponse>('/api/admin/clear-data');
          if (!result.ok) {
            toast.show({ kind: 'error', title: 'Clear failed', description: result.error });
            return;
          }
          const { cleared } = result.data;
          const summary = [
            cleared.tournaments && `${cleared.tournaments} tournaments`,
            cleared.tournamentParticipants && `${cleared.tournamentParticipants} participants`,
            cleared.ingestJobs && `${cleared.ingestJobs} jobs`,
          ]
            .filter(Boolean)
            .join(' · ');
          toast.show({
            kind: 'success',
            title: 'Data cleared',
            description: summary || 'Nothing to clear.',
          });
          router.refresh();
        })
      }
    />
  );
}

/**
 * "Full wipe" — also nukes DiscoveredUrl, PersonRejection, and Person rows
 * across the whole DB. Used to test the discovery + claim flow from zero.
 * The user account itself is preserved (Gmail token survives so the user
 * only needs to re-run the scan, not re-OAuth).
 *
 * Gate behind a typed confirmation because this trashes data for EVERY
 * user — losing claims they've manually made is irreversible without a
 * re-claim flow.
 */
export function FullWipeButton() {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  return (
    <ConfirmAction
      triggerLabel="Full wipe (incl. claims & URLs)"
      triggerIcon={<Warning className="h-4 w-4" aria-hidden />}
      summary="Full wipe is destructive across all users and cannot be undone."
      detail="This deletes scraped data plus every user's discovered URLs, claimed identities (Person rows) and rejections. User accounts and Gmail tokens are preserved, so users can re-scan."
      confirmLabel="Wipe all users' claims and URLs"
      phrase="FULL WIPE"
      pending={isPending}
      onConfirm={() =>
        startTransition(async () => {
          const result = await postJson<ClearResponse>('/api/admin/clear-data?full=1');
          if (!result.ok) {
            toast.show({ kind: 'error', title: 'Full wipe failed', description: result.error });
            return;
          }
          const c = result.data.cleared;
          const summary = [
            c.tournaments && `${c.tournaments} tournaments`,
            c.discoveredUrls && `${c.discoveredUrls} URLs`,
            c.persons && `${c.persons} persons`,
          ]
            .filter(Boolean)
            .join(' · ');
          toast.show({
            kind: 'success',
            title: 'Full wipe complete',
            description: summary || 'Nothing to wipe.',
          });
          router.refresh();
        })
      }
    />
  );
}

export function ReingestAllButton({ count }: { count?: number }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const what = count == null ? 'every discovered URL' : `${count} URL${count === 1 ? '' : 's'}`;

  return (
    <ConfirmAction
      triggerLabel="Re-ingest all"
      triggerIcon={<ArrowsClockwise className="h-4 w-4" aria-hidden />}
      triggerVariant="secondary"
      summary={`Queue ${what} for every user?`}
      detail="Locked URLs are skipped. Nothing is deleted; the queue is then processed with Ingest all."
      confirmLabel={`Queue ${what} for re-ingest`}
      confirmVariant="primary"
      pending={isPending}
      onConfirm={() =>
        startTransition(async () => {
          const result = await postJson<ReingestResponse>('/api/admin/reingest-all');
          if (!result.ok) {
            toast.show({ kind: 'error', title: 'Re-ingest failed', description: result.error });
            return;
          }
          toast.show({
            kind: 'success',
            title: 'Queued for re-ingest',
            description: `${result.data.queued} URLs queued — use "Ingest all" on the dashboard to process them.`,
          });
          if (result.data.skippedLocked) {
            toast.show({
              kind: 'success',
              title: 'Locked URLs skipped',
              description: `${result.data.skippedLocked} locked ${result.data.skippedLocked === 1 ? 'URL was' : 'URLs were'} left untouched.`,
            });
          }
          router.refresh();
        })
      }
    />
  );
}
