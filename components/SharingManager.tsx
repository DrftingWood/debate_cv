'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

type SharingState = {
  enabled: boolean;
  slug: string | null;
  avatarEnabled: boolean;
};

/**
 * Settings → Public sharing UI. Loads current state from /api/sharing and
 * exposes:
 *   - Public sharing on/off toggle
 *   - Public URL display + copy button (when enabled)
 *   - Optional custom slug input (claim with "Save")
 *   - Avatar toggle
 *
 * Reused (visually compact) by the /cv Share popover via SharingPopover.
 */
export function SharingManager() {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<SharingState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [customSlugInput, setCustomSlugInput] = useState('');
  const [pendingToggle, startToggle] = useTransition();
  const [pendingSlug, startSlug] = useTransition();
  const [pendingAvatar, startAvatar] = useTransition();

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    try {
      const res = await fetch('/api/sharing');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SharingState = await res.json();
      setState(data);
      setCustomSlugInput(data.slug ?? '');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load');
    }
  };

  const setEnabled = (next: boolean) => {
    startToggle(async () => {
      const res = await postJson<SharingState>('/api/sharing', { enabled: next });
      if (!res.ok) {
        toast.show({ kind: 'error', title: 'Save failed', description: res.error });
        return;
      }
      setState(res.data);
      setCustomSlugInput(res.data.slug ?? '');
      toast.show({
        kind: 'success',
        title: next ? 'Public sharing on' : 'Public sharing off',
      });
      router.refresh();
    });
  };

  const setAvatarEnabled = (next: boolean) => {
    startAvatar(async () => {
      const res = await postJson<SharingState>('/api/sharing', { avatarEnabled: next });
      if (!res.ok) {
        toast.show({ kind: 'error', title: 'Save failed', description: res.error });
        return;
      }
      setState(res.data);
      router.refresh();
    });
  };

  const saveSlug = () => {
    const trimmed = customSlugInput.trim();
    startSlug(async () => {
      const res = await postJson<SharingState>('/api/sharing', {
        customSlug: trimmed.length > 0 ? trimmed : null,
      });
      if (!res.ok) {
        toast.show({ kind: 'error', title: 'Could not save slug', description: res.error });
        return;
      }
      setState(res.data);
      setCustomSlugInput(res.data.slug ?? '');
      toast.show({ kind: 'success', title: 'Slug saved' });
      router.refresh();
    });
  };

  const fullUrl =
    state?.slug && typeof window !== 'undefined'
      ? `${window.location.origin}/u/${state.slug}`
      : state?.slug
        ? `/u/${state.slug}`
        : null;

  if (loadError) {
    return <p className="text-[14px] text-destructive">{loadError}</p>;
  }
  if (!state) {
    return <p className="text-[14px] text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[14px] font-medium text-foreground">Public CV link</p>
          <p className="text-caption text-muted-foreground">
            Anyone with the link can view your CV. Search engines won&apos;t index it.
          </p>
        </div>
        <Toggle
          checked={state.enabled}
          onChange={setEnabled}
          disabled={pendingToggle}
          label="Toggle public sharing"
        />
      </div>

      {state.enabled && fullUrl ? (
        <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
          <div className="flex items-center gap-2">
            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 truncate font-mono text-[13px] text-primary hover:underline"
            >
              {fullUrl}
            </a>
            <Button
              type="button"
              size="sm"
              variant="outline"
              leftIcon={<Copy className="h-3.5 w-3.5" aria-hidden />}
              onClick={() => {
                if (!fullUrl) return;
                void navigator.clipboard.writeText(fullUrl).then(() =>
                  toast.show({ kind: 'success', title: 'Link copied' }),
                );
              }}
            >
              Copy
            </Button>
            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Open public CV in new tab"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="custom-slug"
              className="block text-caption font-medium text-foreground"
            >
              Custom slug (optional)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-caption text-muted-foreground">/u/</span>
              <input
                id="custom-slug"
                type="text"
                value={customSlugInput}
                onChange={(e) => setCustomSlugInput(e.currentTarget.value)}
                maxLength={30}
                placeholder="your-name"
                className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[13px] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={pendingSlug}
                disabled={pendingSlug || customSlugInput.trim() === (state.slug ?? '')}
                onClick={saveSlug}
              >
                Save
              </Button>
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              3–30 chars · lowercase letters, digits, hyphens. Leave empty to use a random slug.
            </p>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-3">
            <div>
              <p className="text-[13px] font-medium text-foreground">Show profile photo</p>
              <p className="text-caption text-muted-foreground">
                Shows your Google avatar on the public page.
              </p>
            </div>
            <Toggle
              checked={state.avatarEnabled}
              onChange={setAvatarEnabled}
              disabled={pendingAvatar}
              label="Toggle avatar visibility"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ' +
        (checked ? 'bg-primary' : 'bg-muted')
      }
    >
      <span
        className={
          'inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ' +
          (checked ? 'translate-x-5' : 'translate-x-0.5')
        }
      />
    </button>
  );
}
