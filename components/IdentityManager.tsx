'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

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
  const toast = useToast();
  const [names, setNames] = useState<NameOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initialSelected, setInitialSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/onboarding/names');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: NamesResponse = await res.json();
      const items = data.names ?? [];
      setNames(items);
      const claimed = new Set(items.filter((n) => n.isMine).map((n) => n.normalizedName));
      setSelected(claimed);
      setInitialSelected(new Set(claimed));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load identities');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = (norm: string) => {
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

  const onSave = () => {
    startSave(async () => {
      const picked = names.filter((n) => selected.has(n.normalizedName));
      const res = await postJson<{ claimed: number; unclaimed: number }>(
        '/api/onboarding/confirm',
        { names: picked.map((n) => n.displayName) },
      );
      if (!res.ok) {
        toast.show({ kind: 'error', title: 'Save failed', description: res.error });
        return;
      }
      const { claimed, unclaimed } = res.data;
      const parts: string[] = [];
      if (claimed > 0) parts.push(`${claimed} ${claimed === 1 ? 'name' : 'names'} claimed`);
      if (unclaimed > 0) parts.push(`${unclaimed} ${unclaimed === 1 ? 'name' : 'names'} removed`);
      toast.show({
        kind: 'success',
        title: 'Identities updated',
        description: parts.length > 0 ? parts.join(', ') : 'No changes',
      });
      // Refresh the page server data (claim count stat, CV rows) and reload
      // the panel so initialSelected matches the new server state.
      router.refresh();
      await load();
    });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[14px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading identities…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-2">
        <p className="text-[14px] text-destructive">{loadError}</p>
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
      <p className="rounded-md border border-border bg-muted/40 p-4 text-caption text-muted-foreground">
        No registration names extracted from your URLs yet. Run a Gmail scan
        from the dashboard to populate this list.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[14px] text-muted-foreground">
        Tick every spelling that's you — we'll merge them into one identity on
        your CV. Untick a name to remove it (e.g. a teammate's URL that was
        auto-linked to you by an earlier ingest).
      </p>

      <ul className="divide-y divide-border rounded-card border border-border bg-card">
        {names.map((n) => {
          const checked = selected.has(n.normalizedName);
          const wasMine = initialSelected.has(n.normalizedName);
          return (
            <li key={n.normalizedName}>
              <label className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30">
                <span className="flex min-w-0 items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-2 focus:ring-primary/40"
                    checked={checked}
                    onChange={() => toggle(n.normalizedName)}
                  />
                  <span className="font-medium text-foreground">{n.displayName}</span>
                  {wasMine ? (
                    <Badge variant={checked ? 'success' : 'warning'}>
                      {checked ? 'Claimed' : 'Will be removed'}
                    </Badge>
                  ) : checked ? (
                    <Badge variant="info">Will be claimed</Badge>
                  ) : null}
                </span>
                <span className="whitespace-nowrap text-caption text-muted-foreground">
                  {n.urlCount} {n.urlCount === 1 ? 'URL' : 'URLs'}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-caption text-muted-foreground">
          {selected.size} of {names.length} selected
        </p>
        <Button
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
    </div>
  );
}
