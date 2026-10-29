import Link from 'next/link';
import type { ReactNode, RefObject } from 'react';
import {
  ArrowsClockwise,
  CheckCircle,
  MagnifyingGlass,
  SignOut,
  Warning,
} from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { FieldError } from '@/components/FieldError';
import { signOutAction } from '@/lib/auth/signOutAction';

/*
 * The stateless pieces of the onboarding wizard. They live apart from
 * OnboardingFlow so the flow stays readable and so each can be
 * server-rendered in a test without driving the state machine.
 */

export type Phase = 'scan' | 'preflight' | 'pick' | 'done';

export type NameRow = {
  displayName: string;
  normalizedName: string;
  urlCount: number;
  isMine: boolean;
  /** How close the name is to the user's Google name or a name they already claimed. */
  proximity: 'match' | 'close' | 'different' | 'unknown';
};

/** "12 of 40 tournament links read", the one live line for the read step. */
export function preflightProgressText(p: {
  extracted: number;
  failed: number;
  remaining: number;
}): string {
  const read = p.extracted + p.failed;
  const total = read + p.remaining;
  return `${read} of ${total} tournament ${total === 1 ? 'link' : 'links'} read`;
}

const STEPS: { key: Phase; label: string }[] = [
  { key: 'scan', label: 'Scan Gmail' },
  { key: 'preflight', label: 'Read names' },
  { key: 'pick', label: 'Pick yourself' },
];

/**
 * The step list, marked up as progress (FORM-9): a named list,
 * `aria-current="step"` on the item itself, a word for "completed" rather
 * than an icon alone, and upcoming numbers in full ink (the old
 * `text-ink-soft` on `bg-ink/10` measured about 4:1 at 12.5 px).
 */
export function ProgressSteps({ phase }: { phase: Phase }) {
  const current = phase === 'done' ? STEPS.length : STEPS.findIndex((s) => s.key === phase);
  return (
    <ol
      aria-label="Setup progress"
      className="flex items-center justify-between gap-2 rounded-card border border-border bg-card/60 p-3"
    >
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={s.key}
            aria-current={active ? 'step' : undefined}
            className="flex flex-1 items-center gap-2"
          >
            <span
              aria-hidden
              className={
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold ' +
                (done
                  ? 'bg-primary text-primary-foreground'
                  : active
                    ? 'bg-primary-soft text-primary ring-2 ring-primary'
                    : 'bg-surface-3 text-ink')
              }
            >
              {done ? <CheckCircle className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span
              className={
                'truncate text-caption ' + (active ? 'font-medium text-ink' : 'text-ink-soft')
              }
            >
              <span className="sr-only">Step {i + 1}: </span>
              {s.label}
              {done ? <span className="sr-only"> (completed)</span> : null}
            </span>
            {i < STEPS.length - 1 ? (
              <span
                aria-hidden
                className="hidden flex-1 border-t border-dashed border-border md:block"
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** The §10 privacy facts, stated where the user grants the scan (FORM-11). */
export function PrivacyFacts() {
  return (
    <p className="data-label">
      Read-only · email bodies never stored · disconnect in Settings · private until you share
    </p>
  );
}

/**
 * A step that went wrong, in place of the spinner or toast it used to be
 * (FORM-3, FORM-10). `role="alert"` so it is announced when it appears; the
 * actions are the ways forward, never a dead end.
 */
export function StepError({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="space-y-3 rounded-md border border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.06)] p-4"
    >
      <p className="inline-flex items-center gap-hair text-ui font-medium text-destructive">
        <Warning className="h-4 w-4 shrink-0" aria-hidden />
        {title}
      </p>
      {detail ? <p className="text-caption text-ink-soft">{detail}</p> : null}
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function RetryButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      leftIcon={<ArrowsClockwise className="h-3.5 w-3.5" aria-hidden />}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/**
 * A scan that found nothing (FORM-2). It used to leave the user on the same
 * card with a five-second toast; now it says what happened and gives the
 * three ways on: scan again, paste a link by hand, or switch account.
 */
export function ScanEmpty({
  scanned,
  scanning,
  cooldownLabel,
  onScanAgain,
}: {
  scanned: number;
  scanning: boolean;
  /** Set while the scan cooldown runs: the button shows it and is disabled. */
  cooldownLabel?: string;
  onScanAgain: () => void;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-paper p-4">
      <p role="status" className="text-ui font-medium text-ink">
        No tournament links found in this Gmail account
        {scanned > 0 ? ` (${scanned} ${scanned === 1 ? 'email' : 'emails'} checked)` : ''}.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-caption text-ink-soft">
        <li>
          Have a private link from a tournament?{' '}
          <Link
            href="/dashboard"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Paste it on Imports
          </Link>
          .
        </li>
        <li>
          Your invitations went to a different Google account? Sign out and sign in with that one.
        </li>
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={scanning}
          disabled={!!cooldownLabel}
          leftIcon={!scanning ? <MagnifyingGlass className="h-3.5 w-3.5" aria-hidden /> : undefined}
          onClick={onScanAgain}
        >
          {cooldownLabel ?? 'Scan again'}
        </Button>
        <form action={signOutAction}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            leftIcon={<SignOut className="h-3.5 w-3.5" aria-hidden />}
          >
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}

export function FailureWarning() {
  return (
    <div className="rounded-md border border-warning/30 bg-warning/5 p-4 text-table">
      <div className="mb-hair inline-flex items-center gap-hair font-medium text-warning">
        <Warning className="h-4 w-4" aria-hidden />
        We couldn&apos;t read most of your links
      </div>
      <p className="text-ink-soft">
        This usually means a Gmail connection issue or that the tournament sites are blocking us.
        Links that keep failing will appear on{' '}
        <Link href="/dashboard" className="text-primary hover:underline">
          Imports
        </Link>{' '}
        once this step finishes, where you can retry them, or check your{' '}
        <Link href="/settings/account" className="text-primary hover:underline">
          Gmail connection
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * The name checkboxes as one named group, with the "tick at least one"
 * error inside it in the GOV.UK position (after the legend, before the
 * options) and linked to the group. The match/close/different badges keep
 * the meaning PR #156 gave them.
 */
export function NamePicker({
  names,
  selected,
  error,
  firstCheckboxRef,
  onToggle,
}: {
  names: NameRow[];
  selected: Set<string>;
  error: string | null;
  firstCheckboxRef?: RefObject<HTMLInputElement | null>;
  onToggle: (normalizedName: string) => void;
}) {
  const tickedUnlike = names.some(
    (n) => selected.has(n.normalizedName) && !n.isMine && n.proximity === 'different',
  );
  return (
    <>
      <fieldset
        aria-describedby={error ? 'onboarding-names-error' : undefined}
        className="space-y-2"
      >
        <legend className="sr-only">Names that are you</legend>
        {error ? <FieldError id="onboarding-names-error">{error}</FieldError> : null}
        <ul className="divide-y divide-border rounded-card border border-border bg-card">
          {names.map((n, i) => (
            <li key={n.normalizedName}>
              <label className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
                <span className="flex min-w-0 items-center gap-3">
                  <input
                    ref={i === 0 ? firstCheckboxRef : undefined}
                    type="checkbox"
                    className="h-6 w-6 shrink-0 accent-primary"
                    checked={selected.has(n.normalizedName)}
                    onChange={() => onToggle(n.normalizedName)}
                  />
                  <span className="font-medium text-ink">{n.displayName}</span>
                  {n.isMine ? (
                    <Badge variant="success">Already mine</Badge>
                  ) : n.proximity === 'close' ? (
                    <Badge variant="neutral">Close to your Google name</Badge>
                  ) : n.proximity === 'different' ? (
                    <Badge variant="warning">Not like your Google name</Badge>
                  ) : null}
                </span>
                <span className="whitespace-nowrap text-caption text-ink-soft">
                  {n.urlCount} {n.urlCount === 1 ? 'link' : 'links'}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {tickedUnlike ? (
        <p role="status" className="text-caption text-warning">
          You ticked a name that does not look like your Google name. A private link is personal, so
          tick it only if it really is you.
        </p>
      ) : null}
    </>
  );
}
