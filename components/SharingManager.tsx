'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowSquareOut, ArrowsClockwise, Copy } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { FieldError, describedBy, fieldInputClass } from '@/components/FieldError';
import { postJson } from '@/lib/utils/api';
import { userMessage } from '@/lib/ingest/userMessage';
import { cn } from '@/lib/utils/cn';
import { PublicTournamentVisibility, type SharableTournament } from './PublicTournamentVisibility';

type SharingState = {
  enabled: boolean;
  slug: string | null;
  avatarEnabled: boolean;
  proAmPublic: boolean;
  hiddenTournamentIds: string[];
  /** Only the GET carries the picker list; POST responses omit it. */
  tournaments?: SharableTournament[];
};

const SLUG_CODES = new Set(['too_short', 'too_long', 'invalid_chars', 'reserved', 'slug_taken']);

/**
 * What to say under the address field for each refusal from /api/sharing.
 * The route sends a code; the codes were shown raw in a five-second toast,
 * which said neither what was wrong nor how to fix it (SET-4, UX-15).
 */
export function slugErrorMessage(code: string, attempted: string): string {
  switch (code) {
    case 'too_short':
      return 'Use at least 3 characters';
    case 'too_long':
      return 'Use 30 characters or fewer';
    case 'invalid_chars':
      return 'Use only lowercase letters, digits and single hyphens, starting and ending with a letter or digit';
    case 'reserved':
      return 'That address is reserved for the site. Try another';
    case 'slug_taken':
      return `That address is taken. Try ${attempted.toLowerCase()}-2 or another variation`;
    default:
      return 'Your address was not saved. Try again';
  }
}

/**
 * Settings → Public sharing UI. Loads current state from /api/sharing and
 * exposes:
 *   - Public sharing on/off switch
 *   - Public URL display + copy button (when enabled)
 *   - Optional custom address (a form, so Enter saves it)
 *   - Avatar switch
 */
export function SharingManager() {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<SharingState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [customSlugInput, setCustomSlugInput] = useState('');
  const [slugError, setSlugError] = useState<string | null>(null);
  const slugInputRef = useRef<HTMLInputElement>(null);
  const [pendingToggle, startToggle] = useTransition();
  const [pendingSlug, startSlug] = useTransition();
  const [pendingAvatar, startAvatar] = useTransition();
  const [pendingProAm, startProAm] = useTransition();
  const [pendingHidden, startHidden] = useTransition();

  const load = async () => {
    setLoadError(false);
    try {
      const res = await fetch('/api/sharing');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SharingState = await res.json();
      setState(data);
      setCustomSlugInput(data.slug ?? '');
    } catch {
      // The status code means nothing to the reader; the Retry does.
      setLoadError(true);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time fetch of the sharing state; its error state is set by the loader
    void load();
  }, []);

  const setEnabled = (next: boolean) => {
    startToggle(async () => {
      const res = await postJson<SharingState>('/api/sharing', { enabled: next });
      if (!res.ok) {
        toast.show({
          kind: 'error',
          title: 'Sharing not changed',
          description: userMessage(res).description,
        });
        return;
      }
      setState((s) => ({ ...res.data, tournaments: s?.tournaments }));
      setCustomSlugInput(res.data.slug ?? '');
      setSlugError(null);
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
        toast.show({
          kind: 'error',
          title: 'Photo setting not changed',
          description: userMessage(res).description,
        });
        return;
      }
      setState((s) => ({ ...res.data, tournaments: s?.tournaments }));
      router.refresh();
    });
  };

  const setProAmPublic = (next: boolean) => {
    startProAm(async () => {
      const res = await postJson<SharingState>('/api/sharing', { proAmPublic: next });
      if (!res.ok) {
        toast.show({
          kind: 'error',
          title: 'Pro-am setting not changed',
          description: userMessage(res).description,
        });
        return;
      }
      setState((s) => ({ ...res.data, tournaments: s?.tournaments }));
      router.refresh();
    });
  };

  const setTournamentShown = (id: string, shown: boolean) => {
    if (!state) return;
    const hidden = new Set(state.hiddenTournamentIds);
    if (shown) hidden.delete(id);
    else hidden.add(id);
    startHidden(async () => {
      const res = await postJson<SharingState>('/api/sharing', {
        hiddenTournamentIds: Array.from(hidden),
      });
      if (!res.ok) {
        toast.show({
          kind: 'error',
          title: 'Tournament visibility not changed',
          description: userMessage(res).description,
        });
        return;
      }
      // Keep the picker list, which POST responses do not repeat.
      setState({ ...res.data, tournaments: state.tournaments });
      router.refresh();
    });
  };

  const saveSlug = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = customSlugInput.trim();
    startSlug(async () => {
      const res = await postJson<SharingState>('/api/sharing', {
        customSlug: trimmed.length > 0 ? trimmed : null,
      });
      if (!res.ok) {
        const slugCode = SLUG_CODES.has(res.error);
        setSlugError(
          slugCode
            ? slugErrorMessage(res.error, trimmed)
            : `Your address was not saved. ${userMessage(res).description}`,
        );
        slugInputRef.current?.focus();
        return;
      }
      setSlugError(null);
      setState((s) => ({ ...res.data, tournaments: s?.tournaments }));
      setCustomSlugInput(res.data.slug ?? '');
      toast.show({ kind: 'success', title: 'Address saved' });
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
    return (
      <div role="alert" className="space-y-2">
        <p className="text-ui text-destructive">Your sharing settings did not load.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          leftIcon={<ArrowsClockwise className="h-3.5 w-3.5" aria-hidden />}
          onClick={() => void load()}
        >
          Retry
        </Button>
      </div>
    );
  }
  if (!state) {
    return (
      <p role="status" className="text-ui text-ink-soft">
        Loading sharing settings…
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p id="share-public-label" className="text-ui font-medium text-ink">
            Public CV link
          </p>
          <p id="share-public-hint" className="text-caption text-ink-soft">
            Anyone with the link can view your CV. Search engines won&apos;t index it.
          </p>
        </div>
        <Toggle
          checked={state.enabled}
          onChange={setEnabled}
          disabled={pendingToggle}
          labelledBy="share-public-label"
          describedBy="share-public-hint"
        />
      </div>

      {state.enabled && fullUrl ? (
        <div className="space-y-3 rounded-md border border-border bg-paper p-4">
          <div className="flex items-center gap-2">
            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 truncate py-0.5 font-mono text-table text-primary hover:underline"
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
                void navigator.clipboard
                  .writeText(fullUrl)
                  .then(() => toast.show({ kind: 'success', title: 'Link copied' }))
                  .catch(() =>
                    toast.show({
                      kind: 'info',
                      title: 'Could not copy',
                      description: 'Select the link and press Ctrl+C to copy it.',
                    }),
                  );
              }}
            >
              Copy
            </Button>
            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink coarse:h-11 coarse:w-11"
              aria-label="Open public CV in new tab"
            >
              <ArrowSquareOut className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>
          <SlugField
            value={customSlugInput}
            onChange={(next) => setCustomSlugInput(next)}
            error={slugError}
            pending={pendingSlug}
            inputRef={slugInputRef}
            onSubmit={saveSlug}
          />
          <div className="flex items-center justify-between border-t border-border pt-3">
            <div>
              <p id="share-avatar-label" className="text-table font-medium text-ink">
                Show profile photo
              </p>
              <p id="share-avatar-hint" className="text-caption text-ink-soft">
                Shows your Google avatar on the public page.
              </p>
            </div>
            <Toggle
              checked={state.avatarEnabled}
              onChange={setAvatarEnabled}
              disabled={pendingAvatar}
              labelledBy="share-avatar-label"
              describedBy="share-avatar-hint"
            />
          </div>
          <div className="flex items-center justify-between border-t border-border pt-3">
            <div>
              <p id="share-proam-label" className="text-table font-medium text-ink">
                Show pro-am marks on my public CV
              </p>
              <p id="share-proam-hint" className="text-caption text-ink-soft">
                The partners you marked pro-am on Record, under Partners. Off by default.
              </p>
            </div>
            <Toggle
              checked={state.proAmPublic}
              onChange={setProAmPublic}
              disabled={pendingProAm}
              labelledBy="share-proam-label"
              describedBy="share-proam-hint"
            />
          </div>
          <PublicTournamentVisibility
            tournaments={state.tournaments ?? []}
            hiddenIds={state.hiddenTournamentIds}
            onToggle={setTournamentShown}
            disabled={pendingHidden}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The custom-address field. A real <form> so Enter saves (SET-8); the error
 * is text under the field, linked to it and announced when focus returns to
 * it (SET-4). Stateless so it can be server-rendered in a test.
 */
export function SlugField({
  value,
  onChange,
  error,
  pending,
  inputRef,
  onSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  error: string | null;
  pending: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onSubmit: (e: FormEvent) => void;
}) {
  return (
    <form noValidate onSubmit={onSubmit} className="space-y-1.5">
      <label htmlFor="custom-slug" className="block text-caption font-medium text-ink">
        Custom address after /u/ (optional)
      </label>
      <p id="custom-slug-hint" className="text-byline text-ink-soft">
        3–30 characters: lowercase letters, digits and hyphens. Leave it empty for a random address.
      </p>
      {error ? <FieldError id="custom-slug-error">{error}</FieldError> : null}
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="text-caption text-ink-soft">
          /u/
        </span>
        <input
          ref={inputRef}
          id="custom-slug"
          name="slug"
          type="text"
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          maxLength={30}
          placeholder="your-name"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy('custom-slug-hint', error && 'custom-slug-error')}
          className={cn(fieldInputClass, 'w-auto min-w-0 flex-1 font-mono md:text-table')}
        />
        <Button type="submit" size="sm" variant="outline" loading={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}

/**
 * An APG switch. Named by the visible label beside it (SC 2.5.3: "Toggle
 * public sharing" did not contain the visible "Public CV link"). The off
 * track used to be `bg-ink/10` with a background-coloured thumb, about 1.2:1
 * and 1.1:1, so "off" was all but invisible (SET-5, SC 1.4.11); both now
 * carry an ink-soft edge. On a touch screen the global 44 px button floor
 * would stretch the 24 px track into a lozenge, so it is lifted here; the
 * track still clears the 24 px target minimum of SC 2.5.8.
 */
function Toggle({
  checked,
  onChange,
  disabled,
  labelledBy,
  describedBy: hintId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  labelledBy: string;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={hintId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 transition-colors disabled:opacity-50 before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-[""]',
        checked ? 'border-primary bg-primary' : 'border-ink-soft bg-ink-soft/40',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block h-4 w-4 transform rounded-full border border-ink-soft/60 bg-background shadow-sm transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
