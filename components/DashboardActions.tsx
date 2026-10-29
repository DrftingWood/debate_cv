'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowsClockwise,
  Clock,
  DownloadSimple,
  Lock,
  LockOpen,
  MagnifyingGlass,
  Play,
  Stop,
  Tray,
  UploadSimple,
} from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';
import { drainUntilEmpty, summariseDrain } from '@/lib/ingest/drainUntilEmpty';
import { scanErrorMessage, formatCountdown } from '@/lib/ingest/scanErrorMessage';
import { failureToast, thrownToast } from '@/lib/ingest/userMessage';
import {
  FULL_SCAN_CONFIRM_ACTION,
  FULL_SCAN_CONFIRM_TEXT,
  FULL_SCAN_LABEL,
  fullScanResultText,
  fullScanUnavailableText,
} from '@/lib/ingest/fullScanCopy';
import { useFocusAfterRender } from '@/components/useFocusAfterRender';
import { refreshNow, useNow } from '@/components/useNow';
import { ScanCooldownNotice, useScanCooldown, type ScanCooldown } from '@/components/ScanCooldown';

type ScanResponse = { scanned: number; found: number };
type IngestUrlResponse = {
  tournamentId: string;
  fingerprint: string;
  cached: boolean;
  claimedPersonId: string | null;
  claimedPersonName: string | null;
  linkedTournamentsCount: number;
  totalTeams: number | null;
  totalParticipants: number | null;
  warnings?: string[];
};

function formatMetrics(totalTeams: number | null, totalParticipants: number | null): string {
  const parts: string[] = [];
  if (totalTeams != null && totalTeams > 0) parts.push(`${totalTeams} teams`);
  if (totalParticipants != null && totalParticipants > 0)
    parts.push(`${totalParticipants} participants`);
  return parts.join(' · ');
}

/**
 * `disconnected` is why this takes a prop at all. With the Gmail grant
 * revoked, the page showed a warning banner telling the user to reconnect
 * and, six inches above it, a fully-enabled green "Scan Gmail" — two
 * primary buttons competing, one of which could only ever 400. The scan
 * button now steps back to a disabled secondary and says why, leaving
 * "Reconnect Gmail" as the single live action on the screen.
 */
export function ScanButton({ disconnected = false }: { disconnected?: boolean }) {
  const cooldown = useScanCooldown();
  const { isPending, phase, run } = useScanRun(cooldown);
  const noticeId = useId();

  const label = cooldown.active
    ? `Scan again in ${formatCountdown(cooldown.remainingSec)}`
    : phase === 'scanning'
      ? 'Scanning Gmail…'
      : phase === 'ingesting'
        ? 'Ingesting URLs…'
        : 'Scan Gmail';

  return (
    <div className="flex max-w-xs flex-col sm:items-end">
      <Button
        type="button"
        variant={disconnected ? 'outline' : 'primary'}
        disabled={disconnected || cooldown.active}
        title={disconnected ? 'Reconnect Gmail before scanning' : undefined}
        aria-describedby={cooldown.notice ? noticeId : undefined}
        loading={isPending}
        leftIcon={
          isPending ? undefined : cooldown.active ? (
            <Clock className="h-4 w-4" aria-hidden />
          ) : (
            <MagnifyingGlass className="h-4 w-4" aria-hidden />
          )
        }
        onClick={run}
      >
        {label}
      </Button>
      <ScanCooldownNotice cooldown={cooldown} id={noticeId} />
      {/* The button label changes during the run; this line says it (DASH-9). */}
      <p role="status" className="sr-only">
        {phase === 'scanning'
          ? 'Scanning Gmail.'
          : phase === 'ingesting'
            ? 'Scan done. Ingesting the URLs it found.'
            : ''}
      </p>
    </div>
  );
}

/**
 * Secondary action beside Scan Gmail: re-read the whole mailbox, for mail that
 * arrived or was forwarded later than the newest URL already found. Allowed
 * once per 24 hours; the server enforces it (POST /api/ingest/gmail/full) and
 * the page passes `availableAt` so the button is already unavailable on load.
 * While unavailable it is aria-disabled (stays focusable) with the reason
 * and time written beside it, not only greyed out. A short inline confirm
 * comes first because the scan is slow and uses the day's one go.
 */
export function FullScanButton({
  disconnected = false,
  availableAt = null,
}: {
  disconnected?: boolean;
  /** ISO time the next full scan is allowed; null when allowed now. */
  availableAt?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [until, setUntil] = useState<number | null>(availableAt ? Date.parse(availableAt) : null);
  // null until mounted, so server and first client render agree.
  const now = useNow();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const focusAfterRender = useFocusAfterRender();
  const reasonId = useId();

  const locked = until !== null && (now === null || until > now);
  const reason = disconnected
    ? 'Reconnect Gmail before scanning.'
    : until !== null && locked
      ? fullScanUnavailableText(until, now ?? until - 86_400_000)
      : null;
  const blocked = disconnected || locked;

  const run = () =>
    startTransition(async () => {
      try {
        const scan = await postJson<ScanResponse & { truncated?: boolean }>(
          '/api/ingest/gmail/full',
        );
        if (!scan.ok) {
          setConfirming(false);
          if (scan.status === 429 && scan.retryAfterSec) {
            setUntil(Date.now() + scan.retryAfterSec * 1000);
            refreshNow();
            return;
          }
          const notice = scanErrorMessage(scan);
          toast.show({
            kind: notice.kind === 'cooldown' ? 'info' : notice.kind,
            title: notice.title,
            description: notice.description,
          });
          return;
        }
        setUntil(Date.now() + 86_400_000);
        refreshNow();
        setConfirming(false);
        const text = fullScanResultText(
          scan.data.found,
          scan.data.scanned,
          Boolean(scan.data.truncated),
        );
        router.refresh();
        if (scan.data.found > 0) {
          const drain = summariseDrain(await drainUntilEmpty(() => router.refresh()), false);
          toast.show({
            ...drain,
            title: drain.title === 'Done' ? 'Full scan complete' : drain.title,
            description: `${text} ${drain.description}`,
          });
          router.refresh();
        } else {
          toast.show({ kind: 'success', title: 'Full scan complete', description: text });
        }
      } catch (e) {
        setConfirming(false);
        toast.show(thrownToast(e, 'Full scan did not finish'));
      }
    });

  if (confirming && !blocked) {
    return (
      <div
        role="group"
        aria-label="Confirm scanning the whole mailbox"
        className="flex max-w-sm flex-col gap-2 rounded-md border border-border bg-surface p-3 sm:items-end"
      >
        <p className="text-caption text-ink-soft">{FULL_SCAN_CONFIRM_TEXT}</p>
        <div className="flex items-center gap-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => {
              setConfirming(false);
              focusAfterRender(triggerRef);
            }}
          >
            Cancel
          </Button>
          <Button type="button" variant="outline" size="sm" loading={isPending} onClick={run}>
            {isPending ? 'Scanning whole mailbox…' : FULL_SCAN_CONFIRM_ACTION}
          </Button>
        </div>
        <p role="status" className="sr-only">
          {isPending ? 'Scanning the whole mailbox. This may take a while.' : ''}
        </p>
      </div>
    );
  }

  return (
    <div className="flex max-w-xs flex-col sm:items-end">
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        aria-disabled={blocked ? true : undefined}
        aria-describedby={reason ? reasonId : undefined}
        className={blocked ? 'cursor-not-allowed opacity-60' : undefined}
        leftIcon={<Tray className="h-4 w-4" aria-hidden />}
        onClick={() => {
          if (blocked) return;
          setConfirming(true);
          focusAfterRender(cancelRef);
        }}
      >
        {FULL_SCAN_LABEL}
      </Button>
      {reason ? (
        // Disconnected, the banner below already says so; the reason stays
        // for the button's description only.
        <p
          id={reasonId}
          className={disconnected ? 'sr-only' : 'mt-1.5 text-caption text-ink-soft sm:text-right'}
        >
          {reason}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The scan-then-ingest run behind the Scan button. A refused scan that is
 * only the cooldown starts the button's countdown instead of a toast.
 */
function useScanRun(cooldown: ScanCooldown) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'ingesting'>('idle');

  const run = () =>
    startTransition(async () => {
      try {
        setPhase('scanning');
        const scan = await postJson<ScanResponse>('/api/ingest/gmail');
        if (!scan.ok) {
          setPhase('idle');
          const notice = scanErrorMessage(scan);
          if (notice.kind === 'cooldown') cooldown.start(notice);
          else
            toast.show({ kind: notice.kind, title: notice.title, description: notice.description });
          return;
        }
        const foundText = `Found ${scan.data.found} private URLs in ${scan.data.scanned} messages.`;
        router.refresh();

        // One toast per click (DASH-2): the scan result and, when URLs were
        // found, the import result that follows it, said together.
        if (scan.data.found > 0) {
          setPhase('ingesting');
          const drain = summariseDrain(await drainUntilEmpty(() => router.refresh()), false);
          toast.show({
            ...drain,
            title: drain.title === 'Done' ? 'Gmail scan complete' : drain.title,
            description: `${foundText} ${drain.description}`,
          });
          router.refresh();
        } else {
          toast.show({ kind: 'success', title: 'Gmail scan complete', description: foundText });
        }
        setPhase('idle');
      } catch (e) {
        setPhase('idle');
        toast.show(thrownToast(e, 'Import did not finish'));
      }
    });

  return { isPending, phase, run };
}

export function IngestAllButton({ pendingCount }: { pendingCount?: number }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [progress, setProgress] = useState<{ processed: number; remaining: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [stopping, setStopping] = useState(false);

  // The label ticks on every batch, which a screen reader must not narrate;
  // this line changes on start, every fifth URL, on Stop and at the end (DASH-9).
  const total = progress ? progress.processed + progress.remaining : 0;
  const statusLine = !isPending
    ? ''
    : stopping
      ? 'Stopping after the current batch.'
      : progress && progress.processed >= 5
        ? `Ingested ${Math.floor(progress.processed / 5) * 5} of ${total}.`
        : 'Ingesting the queued URLs.';

  return (
    <div className="flex items-center gap-2">
      <p role="status" className="sr-only">
        {statusLine}
      </p>
      <Button
        type="button"
        variant="secondary"
        loading={isPending}
        leftIcon={!isPending ? <Play className="h-4 w-4" aria-hidden /> : undefined}
        onClick={() => {
          setProgress(null);
          setStopping(false);
          const controller = new AbortController();
          abortRef.current = controller;
          startTransition(async () => {
            try {
              const drain = await drainUntilEmpty(
                (p) => {
                  setProgress(p);
                  router.refresh();
                },
                { signal: controller.signal },
              );
              toast.show(summariseDrain(drain, controller.signal.aborted));
              router.refresh();
            } catch (e) {
              toast.show(thrownToast(e, 'Import did not finish'));
            } finally {
              abortRef.current = null;
            }
          });
        }}
      >
        {isPending && progress
          ? `Ingesting… ${progress.processed}/${progress.processed + progress.remaining}`
          : pendingCount
            ? `Ingest all (${pendingCount})`
            : 'Ingest all'}
      </Button>
      {isPending ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          leftIcon={<Stop className="h-3.5 w-3.5" aria-hidden />}
          disabled={stopping}
          onClick={() => {
            setStopping(true);
            abortRef.current?.abort();
          }}
        >
          Stop
        </Button>
      ) : null}
    </div>
  );
}

type CsvResponse = { queued: number; rows: Array<{ line: number; status: string }> };

/** Plain-language reasons for the lines of an uploaded CSV that were not queued. */
const CSV_SKIP_REASON: Record<string, string> = {
  not_a_private_url: 'not a private tournament URL',
  duplicate: 'repeated',
  over_limit: 'over the 20 URL limit',
};

/**
 * Upload a CSV of private tournament URLs (one per line, or a "url" column).
 * The server queues up to 20 of them; the queue then drains like a Gmail scan.
 * The file is read in the browser and posted as text, so nothing but the
 * URLs leaves the page, and the response never contains them again.
 */
export function UploadCsvButton() {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="sr-only"
        aria-label="Upload a CSV of private tournament URLs"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          startTransition(async () => {
            const result = await postJson<CsvResponse>('/api/ingest/csv', {
              csv: await file.text(),
            });
            if (!result.ok) {
              toast.show(failureToast(result, 'CSV upload failed'));
              return;
            }
            const skipped = result.data.rows.filter((r) => r.status !== 'ok');
            const byReason = new Map<string, number[]>();
            for (const r of skipped)
              byReason.set(r.status, [...(byReason.get(r.status) ?? []), r.line]);
            const detail = [...byReason.entries()]
              .map(
                ([status, lines]) =>
                  `${lines.length} ${CSV_SKIP_REASON[status] ?? status} (line${lines.length === 1 ? '' : 's'} ${lines.slice(0, 5).join(', ')}${lines.length > 5 ? '…' : ''})`,
              )
              .join('; ');
            // One toast per upload (DASH-2). "Nothing to queue" is a result,
            // not a failure, so it is neutral and times out like any other.
            router.refresh();
            if (result.data.queued > 0) {
              const queuedTitle = `Queued ${result.data.queued} tournament${result.data.queued === 1 ? '' : 's'}`;
              const drain = summariseDrain(await drainUntilEmpty(() => router.refresh()), false);
              toast.show({
                ...drain,
                title: drain.title === 'Done' ? queuedTitle : drain.title,
                description: [detail ? `Skipped: ${detail}.` : '', drain.description]
                  .filter(Boolean)
                  .join(' '),
              });
              router.refresh();
            } else {
              toast.show({
                kind: 'info',
                title: 'Nothing to queue',
                description: detail || undefined,
              });
            }
          });
        }}
      />
      <Button
        type="button"
        variant="outline"
        loading={isPending}
        leftIcon={!isPending ? <UploadSimple className="h-4 w-4" aria-hidden /> : undefined}
        onClick={() => inputRef.current?.click()}
      >
        Upload CSV
      </Button>
    </>
  );
}

/** Row-action buttons share the touch scale the `link` variant skips (NV-13). */
const ROW_ACTION_CLASS = 'coarse:min-h-[44px]';

export function IngestButton({
  url,
  alreadyDone,
  name,
  canForce = false,
}: {
  url: string;
  alreadyDone: boolean;
  /** Tournament name or host, so the accessible name says which row (NV-13). */
  name?: string;
  /** Admins only: re-ingest forces a fresh scrape instead of using the cache. */
  canForce?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const label = alreadyDone ? 'Re-ingest' : 'Ingest';

  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      className={ROW_ACTION_CLASS}
      aria-label={name ? `${label} ${name}` : undefined}
      loading={isPending}
      leftIcon={
        !isPending && alreadyDone ? (
          <ArrowClockwise className="h-3.5 w-3.5" aria-hidden />
        ) : undefined
      }
      onClick={() => {
        startTransition(async () => {
          const result = await postJson<IngestUrlResponse>('/api/ingest/url', {
            url,
            // Only an admin may force a re-scrape (owner rule, I53). Everyone
            // else re-ingests unforced, which re-scrapes by itself when
            // rounds, tabs or motions are new and otherwise says "cached".
            force: alreadyDone && canForce,
          });
          if (!result.ok) {
            toast.show(failureToast(result, `${label} failed`));
            return;
          }
          // One toast per click. This used to be up to three (done, linked,
          // then a red "Scrape warnings" error), so a successful import with
          // one unreadable optional page ended on an error. Warnings are now
          // a clause in the same toast, which turns neutral rather than red,
          // and the row itself keeps a persistent "Partial data" marker
          // (the route stores the warnings in the job's lastError).
          const metrics = formatMetrics(result.data.totalTeams, result.data.totalParticipants);
          const host = new URL(url).host;
          const what = `${host}${metrics ? ` · ${metrics}` : ''}${result.data.cached ? ' (cached)' : ''}.`;
          const n = result.data.linkedTournamentsCount;
          const linked = result.data.claimedPersonId
            ? n > 0
              ? ` ${n} ${n === 1 ? 'tournament' : 'tournaments'} now on your record.`
              : ' Your identity was confirmed from the private URL.'
            : '';
          const warnings = result.data.warnings ?? [];
          const partial =
            warnings.length > 0
              ? ` Some pages could not be read (${warnings.length}); the row is marked "Partial data".`
              : '';
          toast.show({
            kind: warnings.length > 0 ? 'info' : 'success',
            title: warnings.length > 0 ? `${label}ed with gaps` : `${label}ed`,
            description: `${what}${linked}${partial}`,
            action: result.data.claimedPersonId
              ? { label: 'View your record', href: '/cv' }
              : undefined,
          });
          router.refresh();
        });
      }}
    >
      {label}
    </Button>
  );
}

export function ClearButton({ url, name }: { url: string; name?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const focusAfterRender = useFocusAfterRender();

  // Clear resets a URL's ingest, so it asks first (DASH-8, UX-17). The step is
  // inline, with Cancel as the first control and the safe default for focus.
  if (confirming) {
    return (
      <span
        role="group"
        aria-label="Confirm resetting this import"
        className="flex flex-wrap items-center gap-x-3 gap-y-1"
      >
        <span className="text-caption text-ink-soft">
          Reset this import? The tournament stays on your record until you ingest it again.
        </span>
        <Button
          ref={cancelRef}
          type="button"
          variant="link"
          size="sm"
          className={ROW_ACTION_CLASS}
          disabled={isPending}
          onClick={() => {
            setConfirming(false);
            focusAfterRender(triggerRef);
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="link"
          size="sm"
          className={ROW_ACTION_CLASS}
          aria-label={name ? `Confirm reset of ${name}` : undefined}
          loading={isPending}
          leftIcon={
            !isPending ? <ArrowCounterClockwise className="h-3.5 w-3.5" aria-hidden /> : undefined
          }
          onClick={() => {
            startTransition(async () => {
              const result = await postJson('/api/ingest/clear', { url });
              if (!result.ok) {
                toast.show(failureToast(result, 'Reset failed'));
                return;
              }
              toast.show({
                kind: 'success',
                title: 'Import reset',
                description: 'Ingestion reset — click Ingest to retry.',
              });
              router.refresh();
              setConfirming(false);
            });
          }}
        >
          Reset
        </Button>
      </span>
    );
  }

  return (
    <Button
      ref={triggerRef}
      type="button"
      variant="link"
      size="sm"
      className={ROW_ACTION_CLASS}
      aria-label={name ? `Reset import of ${name}` : undefined}
      leftIcon={<ArrowCounterClockwise className="h-3.5 w-3.5" aria-hidden />}
      onClick={() => {
        setConfirming(true);
        focusAfterRender(cancelRef);
      }}
    >
      Reset
    </Button>
  );
}

type ReingestMineResponse = { queued: number; skipped: number; skippedLocked: number };

function reingestDescription({
  queued,
  skipped,
  skippedLocked,
  selected,
}: ReingestMineResponse & { selected?: boolean }): string {
  const notes = [
    skipped > 0 ? `${skipped} unavailable` : null,
    skippedLocked > 0 ? `${skippedLocked} locked` : null,
  ].filter(Boolean);
  const note = notes.length > 0 ? ` (${notes.join(', ')} skipped)` : '';
  if (queued > 0) {
    return `${queued} ${queued === 1 ? 'URL' : 'URLs'} queued - use "Ingest all" to process them.${note}`;
  }
  if (notes.length > 0)
    return `Nothing queued${selected ? ' from that selection' : ''} - ${notes.join(', ')} skipped.`;
  return selected ? 'Choose at least one unlocked URL first.' : 'Nothing to re-ingest yet.';
}

function selectedReingestUrls(): string[] {
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[data-reingest-url]:checked'))
    .map((input) => input.value)
    .filter(Boolean);
}

export function ReingestMineButton() {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      loading={isPending}
      leftIcon={!isPending ? <ArrowsClockwise className="h-4 w-4" aria-hidden /> : undefined}
      onClick={() => {
        startTransition(async () => {
          const result = await postJson<ReingestMineResponse>('/api/ingest/reingest-mine');
          if (!result.ok) {
            toast.show(failureToast(result, 'Re-ingest failed'));
            return;
          }
          const { queued: n, skipped } = result.data;
          const skipNote =
            skipped > 0 ? ` (${skipped} skipped — source page no longer exists)` : '';
          const locked = result.data.skippedLocked;
          const lockedNote =
            locked > 0
              ? ` ${locked} locked ${locked === 1 ? 'URL was' : 'URLs were'} left untouched.`
              : '';
          toast.show({
            kind: 'success',
            title: 'Queued for re-ingest',
            description:
              (n > 0
                ? `${n} ${n === 1 ? 'URL' : 'URLs'} queued — use "Ingest all" to process them.${skipNote}`
                : skipped > 0
                  ? `Nothing to re-ingest — all ${skipped} URLs are permanently unavailable.`
                  : 'Nothing to re-ingest yet.') + lockedNote,
          });
          router.refresh();
        });
      }}
    >
      Re-ingest mine
    </Button>
  );
}

export function ReingestSelectedButton() {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [selectedCount, setSelectedCount] = useState(0);

  useEffect(() => {
    const update = () => setSelectedCount(selectedReingestUrls().length);
    update();
    document.addEventListener('change', update);
    return () => document.removeEventListener('change', update);
  }, []);

  return (
    <Button
      type="button"
      variant="outline"
      loading={isPending}
      leftIcon={!isPending ? <ArrowsClockwise className="h-4 w-4" aria-hidden /> : undefined}
      onClick={() => {
        // Left enabled so the reason can be given on press instead of hidden
        // behind a disabled button (FORM-7, UX-16).
        const urls = selectedReingestUrls();
        if (urls.length === 0) {
          toast.show({
            kind: 'info',
            title: 'Nothing selected',
            description: 'Select one or more unlocked tournament URLs first.',
          });
          return;
        }

        startTransition(async () => {
          const result = await postJson<ReingestMineResponse>('/api/ingest/reingest-mine', {
            urls,
          });
          if (!result.ok) {
            toast.show(failureToast(result, 'Re-ingest failed'));
            return;
          }
          for (const input of document.querySelectorAll<HTMLInputElement>(
            'input[data-reingest-url]:checked',
          )) {
            input.checked = false;
          }
          setSelectedCount(0);
          toast.show({
            kind: 'success',
            title: 'Queued for re-ingest',
            description: reingestDescription({ ...result.data, selected: true }),
          });
          router.refresh();
        });
      }}
    >
      {selectedCount > 0 ? `Re-ingest selected (${selectedCount})` : 'Re-ingest selected'}
    </Button>
  );
}

export function LockUrlButton({
  url,
  locked,
  name,
}: {
  url: string;
  locked: boolean;
  name?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const nextLocked = !locked;

  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      className={ROW_ACTION_CLASS}
      aria-label={name ? `${locked ? 'Unlock' : 'Lock'} ${name}` : undefined}
      loading={isPending}
      leftIcon={
        !isPending ? (
          locked ? (
            <LockOpen className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Lock className="h-3.5 w-3.5" aria-hidden />
          )
        ) : undefined
      }
      onClick={() => {
        startTransition(async () => {
          const result = await postJson<{ locked: boolean; updated: number }>('/api/ingest/lock', {
            url,
            locked: nextLocked,
          });
          if (!result.ok) {
            toast.show(failureToast(result, 'Lock update failed'));
            return;
          }
          toast.show({
            kind: 'success',
            title: nextLocked ? 'Tournament locked' : 'Tournament unlocked',
            description: nextLocked
              ? 'Bulk re-ingest will skip this URL. Manual re-ingest still works.'
              : 'Bulk re-ingest can queue this URL again.',
          });
          router.refresh();
        });
      }}
    >
      {locked ? 'Unlock' : 'Lock'}
    </Button>
  );
}

export function ExportErrorsButton() {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      loading={isPending}
      leftIcon={!isPending ? <DownloadSimple className="h-4 w-4" aria-hidden /> : undefined}
      onClick={() => {
        startTransition(async () => {
          try {
            const res = await fetch('/api/ingest/errors-export');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            // Force download via blob URL — keeps the auth cookie that
            // window.location navigation would also send, but doesn't navigate
            // the user away from the dashboard.
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const date = new Date().toISOString().slice(0, 10);
            a.download = `ingest-errors-${date}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast.show({ kind: 'success', title: 'Errors exported' });
          } catch (e) {
            toast.show(thrownToast(e, 'Export failed'));
          }
        });
      }}
    >
      Export errors
    </Button>
  );
}
