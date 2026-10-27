'use client';

import { useEffect, useRef, useState, useTransition, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useFocusAfterRender } from '@/components/useFocusAfterRender';
import { postJson } from '@/lib/utils/api';
import { userMessage } from '@/lib/ingest/userMessage';

type NameOption = {
  displayName: string;
  normalizedName: string;
  urlCount: number;
  isMine: boolean;
};

type NamesResponse = {
  names: NameOption[];
  totals: { urls: number; named: number; unknown: number; failed: number };
};

/**
 * What a save would take off the record: the names that were claimed and
 * are now unticked, and how many tournament links sit under them.
 */
export function pendingRemovals(names: NameOption[], selected: Set<string>) {
  const removed = names.filter((n) => n.isMine && !selected.has(n.normalizedName));
  return {
    removed,
    links: removed.reduce((sum, n) => sum + n.urlCount, 0),
    removesEverything: removed.length > 0 && !names.some((n) => selected.has(n.normalizedName)),
  };
}

/**
 * Settings-page panel for managing which registration names the user claims
 * as theirs. Reuses the onboarding picker plumbing — `/api/onboarding/names`
 * lists every distinct registration name from the user's URLs (with
 * "already claimed" marker), and `/api/onboarding/confirm` accepts the new
 * set of ticked names and adds/removes claims to match.
 *
 * Lives outside the onboarding flow because users frequently need to
 * un-claim a wrong-identity row well after onboarding (e.g. when a
 * teammate's forwarded URL was auto-claimed by an earlier ingest).
 */
export function IdentityManager() {
  const router = useRouter();
  const [names, setNames] = useState<NameOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initialSelected, setInitialSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [isSaving, startSave] = useTransition();
  const saveRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const savedRef = useRef<HTMLParagraphElement>(null);
  const focusAfterRender = useFocusAfterRender();

  // `quiet` refetches after a save without swapping the list for a spinner,
  // so focus (on Save) survives and the list does not jump (SET-10).
  const load = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch('/api/onboarding/names');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: NamesResponse = await res.json();
      const items = data.names ?? [];
      setNames(items);
      const claimed = new Set(items.filter((n) => n.isMine).map((n) => n.normalizedName));
      setSelected(claimed);
      setInitialSelected(new Set(claimed));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = (norm: string) => {
    setSavedMessage(null);
    setConfirmingRemoval(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(norm)) next.delete(norm);
      else next.add(norm);
      return next;
    });
  };

  const dirty = (() => {
    if (selected.size !== initialSelected.size) return true;
    for (const n of selected) if (!initialSelected.has(n)) return true;
    return false;
  })();

  const removal = pendingRemovals(names, selected);

  const save = () => {
    setConfirmingRemoval(false);
    setSaveError(null);
    startSave(async () => {
      const picked = names.filter((n) => selected.has(n.normalizedName));
      const res = await postJson<{ claimed: number; unclaimed: number }>(
        '/api/onboarding/confirm',
        { names: picked.map((n) => n.displayName) },
      );
      if (!res.ok) {
        setSaveError(`Your names were not saved. ${userMessage(res).description}`);
        focusAfterRender(saveRef);
        return;
      }
      const { claimed, unclaimed } = res.data;
      const parts: string[] = [];
      if (claimed > 0) parts.push(`${claimed} ${claimed === 1 ? 'name' : 'names'} added`);
      if (unclaimed > 0) parts.push(`${unclaimed} ${unclaimed === 1 ? 'name' : 'names'} removed`);
      setSavedMessage(`Saved: ${parts.length > 0 ? parts.join(', ') : 'no changes'}.`);
      // Refresh the page server data (claim count stat, CV rows) and reload
      // the panel so initialSelected matches the new server state.
      router.refresh();
      await load({ quiet: true });
      // Save is disabled again now that nothing is unsaved, and a disabled
      // button cannot take focus (it would fall to <body>). The saved line
      // is the next thing to read.
      focusAfterRender(savedRef);
    });
  };

  // Unticking a claimed name takes its tournaments off the record. That is
  // reversible (tick it again) but easy to do by accident, and unticking
  // everything used to empty the whole record without a word (SET-6, UX-17).
  const onSave = () => {
    if (removal.removed.length > 0) {
      setConfirmingRemoval(true);
      focusAfterRender(keepRef);
      return;
    }
    save();
  };

  if (loading) {
    return (
      <div role="status" className="flex items-center gap-2 text-ui text-ink-soft">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading your names…
      </div>
    );
  }

  if (loadError) {
    return (
      <div role="alert" className="space-y-2">
        <p className="text-ui text-destructive">Your names did not load.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
          onClick={() => void load()}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (names.length === 0) {
    return (
      <p className="rounded-md border border-border bg-paper p-4 text-caption text-ink-soft">
        No names found on your tournament links yet. Scan Gmail from Imports to fill this list.
      </p>
    );
  }

  return (
    <div className="space-y-4" aria-busy={isSaving || undefined}>
      <p className="text-ui text-ink-soft">
        Tick every spelling that's you — we'll merge them into one identity on your CV. Untick a
        name to remove it (e.g. a teammate's link that was matched to you by mistake).
      </p>

      <fieldset>
        <legend className="sr-only">Names that are you</legend>

        <ul className="divide-y divide-border rounded-card border border-border bg-card">
          {names.map((n) => {
            const checked = selected.has(n.normalizedName);
            const wasMine = initialSelected.has(n.normalizedName);
            return (
              <li key={n.normalizedName}>
                <label className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
                  <span className="flex min-w-0 items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-primary"
                      checked={checked}
                      onChange={() => toggle(n.normalizedName)}
                    />
                    <span className="font-medium text-ink">{n.displayName}</span>
                    {wasMine ? (
                      <Badge variant={checked ? 'success' : 'warning'}>
                        {checked ? 'Claimed' : 'Will be removed'}
                      </Badge>
                    ) : checked ? (
                      <Badge variant="info">Will be claimed</Badge>
                    ) : null}
                  </span>
                  <span className="whitespace-nowrap text-caption text-ink-soft">
                    {n.urlCount} {n.urlCount === 1 ? 'link' : 'links'}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {confirmingRemoval ? (
        <RemovalConfirm
          removal={removal}
          keepRef={keepRef}
          pending={isSaving}
          onConfirm={save}
          onKeep={() => {
            setConfirmingRemoval(false);
            focusAfterRender(saveRef);
          }}
        />
      ) : null}

      {saveError ? (
        <p role="alert" className="text-caption font-medium text-destructive">
          {saveError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-caption text-ink-soft">
          {selected.size} of {names.length} selected
        </p>
        <Button
          ref={saveRef}
          type="button"
          variant="primary"
          size="sm"
          loading={isSaving}
          disabled={!dirty || isSaving}
          leftIcon={!isSaving ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : undefined}
          onClick={onSave}
        >
          {isSaving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
      <p
        ref={savedRef}
        tabIndex={-1}
        role="status"
        className="text-caption text-ink-soft outline-none"
      >
        {savedMessage ?? ''}
      </p>
    </div>
  );
}

/** The inline "this removes N tournaments" step. Stateless for the test. */
export function RemovalConfirm({
  removal,
  keepRef,
  pending,
  onConfirm,
  onKeep,
}: {
  removal: ReturnType<typeof pendingRemovals>;
  keepRef?: RefObject<HTMLButtonElement | null>;
  pending: boolean;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  const count = removal.removed.length;
  const list = removal.removed.map((n) => n.displayName).join(', ');
  return (
    <div
      role="group"
      aria-labelledby="identity-remove-heading"
      className="space-y-3 rounded-card border border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.06)] p-4"
    >
      <p id="identity-remove-heading" className="text-ui font-semibold text-destructive">
        {removal.removesEverything
          ? 'This removes every name, so your Record will be empty.'
          : `Remove ${count} ${count === 1 ? 'name' : 'names'} from your Record?`}
      </p>
      <p className="text-caption text-ink-soft">
        {list}: the tournaments on {removal.links} {removal.links === 1 ? 'link' : 'links'} leave
        your Record. You can tick {count === 1 ? 'it' : 'them'} again later to bring them back.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="danger" size="sm" loading={pending} onClick={onConfirm}>
          Remove and save
        </Button>
        <Button
          ref={keepRef}
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={onKeep}
        >
          {count === 1 ? 'Keep it' : 'Keep them'}
        </Button>
      </div>
    </div>
  );
}
