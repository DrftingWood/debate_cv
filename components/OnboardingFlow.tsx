'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Clock, Mail, UserCheck, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { useFocusAfterRender } from '@/components/useFocusAfterRender';
import {
  FailureWarning,
  NamePicker,
  PrivacyFacts,
  ProgressSteps,
  RetryButton,
  ScanEmpty,
  StepError,
  preflightProgressText,
  type NameRow,
  type Phase,
} from '@/components/OnboardingSteps';
import { scanErrorMessage, formatCountdown } from '@/lib/ingest/scanErrorMessage';
import { userMessage } from '@/lib/ingest/userMessage';
import { ScanCooldownNotice, useScanCooldown } from '@/components/ScanCooldown';
import { postJson } from '@/lib/utils/api';

type ScanResponse = { scanned: number; found: number };
type PreflightResponse = {
  extracted: number;
  failed: number;
  processed: number;
  remaining: number;
  errors: { url: string; error: string }[];
};
type NamesResponse = {
  names: NameRow[];
  totals: { urls: number; named: number; unknown: number; failed: number };
};

// The read step's live line changes at most this often, so a screen reader
// hears progress without a stream of numbers (FORM-4).
const ANNOUNCE_EVERY_MS = 4000;

/**
 * First-time onboarding wizard. Strictly forward: scan → preflight → pick →
 * done. Re-entry users (those with ≥1 claimed Person) never see this — they
 * hit the stub on /onboarding instead and manage identities from
 * /settings/profile. Failures during preflight are summarized with a
 * threshold banner; per-URL retry is not exposed here, since permanent
 * failures route to the dashboard's `Failed` filter for triage.
 *
 * Every step change moves focus to the new step's heading (FORM-1): the
 * button that was pressed unmounts with its card, and focus would otherwise
 * fall to <body>. Every failure is shown in the card with a way forward, not
 * only as a toast (FORM-2, FORM-3, FORM-10).
 */
export function OnboardingFlow({
  initialPhase,
  initialUrlCount,
  initialPreflightRemaining,
}: {
  initialPhase: Phase;
  initialUrlCount: number;
  initialPreflightRemaining: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [preflight, setPreflight] = useState({
    remaining: initialPreflightRemaining,
    extracted: 0,
    failed: 0,
  });
  const [preflightRun, setPreflightRun] = useState(0);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [announced, setAnnounced] = useState('');
  const lastAnnounceAt = useRef(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const [emptyScan, setEmptyScan] = useState<{ scanned: number } | null>(null);
  const [names, setNames] = useState<NameRow[]>([]);
  const [namesState, setNamesState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [totals, setTotals] = useState<NamesResponse['totals']>({
    urls: initialUrlCount,
    named: 0,
    unknown: initialPreflightRemaining,
    failed: 0,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickError, setPickError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [isScanning, startScan] = useTransition();
  const [isConfirming, startConfirm] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstCheckboxRef = useRef<HTMLInputElement>(null);
  const focusAfterRender = useFocusAfterRender();
  const cooldown = useScanCooldown();

  const goTo = (next: Phase) => {
    focusAfterRender(headingRef);
    setPhase(next);
  };

  // ── Phase 2: preflight loop ─────────────────────────────────────────────
  // Polls /api/onboarding/preflight in batches of 10 until remaining hits 0.
  // Allow a few consecutive zero-progress responses (typically a hung fetch
  // on one URL) before giving up — the endpoint is idempotent so retrying
  // is safe, which is also why "Try again" can simply re-run this loop.
  useEffect(() => {
    if (phase !== 'preflight' || preflightError) return;
    let cancelled = false;
    (async () => {
      const MAX_ZERO_PROGRESS_IN_A_ROW = 3;
      let zeroProgressStreak = 0;
      while (!cancelled) {
        const res = await postJson<PreflightResponse>('/api/onboarding/preflight');
        if (cancelled) return;
        if (!res.ok) {
          setPreflightError(userMessage(res).description);
          return;
        }
        setPreflight((p) => ({
          remaining: res.data.remaining,
          extracted: p.extracted + res.data.extracted,
          failed: p.failed + res.data.failed,
        }));
        if (res.data.remaining === 0) break;
        if (res.data.processed === 0) {
          zeroProgressStreak += 1;
          if (zeroProgressStreak >= MAX_ZERO_PROGRESS_IN_A_ROW) break;
        } else {
          zeroProgressStreak = 0;
        }
      }
      if (!cancelled) goTo('pick');
    })();
    return () => {
      cancelled = true;
    };
    // The loop reads only setters and the stable focus helper; it restarts
    // on entering the step and on "Try again" (preflightRun), never per batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only on step entry or retry
  }, [phase, preflightRun, preflightError]);

  // Throttled live line for the read step (FORM-4). The counters themselves
  // are not live: a region that changes every batch is noise.
  useEffect(() => {
    if (phase !== 'preflight') return;
    const now = Date.now();
    if (preflight.remaining > 0 && now - lastAnnounceAt.current < ANNOUNCE_EVERY_MS) return;
    lastAnnounceAt.current = now;
    setAnnounced(preflightProgressText(preflight));
  }, [phase, preflight]);

  // ── Phase 3 entry: load names (once per entry; FORM-10) ────────────────
  const loadNames = async () => {
    setNamesState('loading');
    try {
      const r = await fetch('/api/onboarding/names');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const res: NamesResponse = await r.json();
      const rows = res.names ?? [];
      setNames(rows);
      if (res.totals) setTotals(res.totals);
      setSelected(
        new Set(
          rows
            // Already mine, or the same name as the user's Google name. A close
            // name (and any double surname or one-word name, which the server
            // caps at close) always needs the user's own tick (owner rule, I38).
            .filter((n) => n.isMine || n.proximity === 'match')
            .map((n) => n.normalizedName),
        ),
      );
      setNamesState('ready');
    } catch {
      setNamesState('error');
    }
  };

  useEffect(() => {
    if (phase === 'pick') void loadNames();
  }, [phase]);

  // ── Phase 1: Gmail scan ─────────────────────────────────────────────────
  const onScan = () => {
    setScanError(null);
    setEmptyScan(null);
    startScan(async () => {
      const res = await postJson<ScanResponse>('/api/ingest/gmail');
      if (!res.ok) {
        // A refused scan that is only the cooldown is a wait, not a failure:
        // neutral notice and a counting button, no red "did not run" (DASH-1).
        const notice = scanErrorMessage(res);
        if (notice.kind === 'cooldown') cooldown.start(notice);
        else setScanError(notice.description);
        return;
      }
      const found = res.data.found ?? 0;
      if (found > 0) {
        setPreflight({ remaining: found, extracted: 0, failed: 0 });
        goTo('preflight');
      } else {
        setEmptyScan({ scanned: res.data.scanned ?? 0 });
      }
    });
  };

  // ── Phase 3: confirm picks ──────────────────────────────────────────────
  const toggle = (norm: string) => {
    setPickError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(norm)) next.delete(norm);
      else next.add(norm);
      return next;
    });
  };

  const onConfirm = () => {
    // Validate on press rather than disabling the button (UX-16): the
    // message below the list says what to do, and focus goes to the list.
    if (selected.size === 0) {
      setPickError('Tick at least one name that is you');
      firstCheckboxRef.current?.focus();
      return;
    }
    setConfirmError(null);
    const picked = names.filter((n) => selected.has(n.normalizedName));
    startConfirm(async () => {
      const res = await postJson<{ claimed: number; unclaimed: number }>(
        '/api/onboarding/confirm',
        { names: picked.map((n) => n.displayName) },
      );
      if (!res.ok) {
        setConfirmError(`Your names were not saved. ${userMessage(res).description}`);
        return;
      }
      const { claimed } = res.data;
      toast.show({
        kind: 'success',
        title: 'Names confirmed',
        description: `${claimed} ${claimed === 1 ? 'name' : 'names'} added. Building your Record…`,
      });
      goTo('done');
      // Land on /cv so the user immediately sees their CV taking shape.
      // The "Ingesting X tournaments" banner on /cv reassures them while
      // the queue drains in the background.
      router.push('/cv');
    });
  };

  // Threshold banner: surface when failure rate is so high that the user
  // probably has a systemic problem (wrong Gmail account, OAuth scope
  // missing, Cloudflare blocking everything). Below this rate we trust the
  // queue and stay quiet.
  const totalProcessed = preflight.extracted + preflight.failed;
  const showFailureWarning = totalProcessed > 5 && preflight.failed / totalProcessed > 0.5;

  const heading = (text: string) => (
    <h2 ref={headingRef} tabIndex={-1} className="font-display text-h3 font-medium text-ink">
      {text}
    </h2>
  );

  return (
    <div className="space-y-6">
      <ProgressSteps phase={phase} />

      {phase === 'scan' && (
        <Card>
          <CardBody className="space-y-4 p-6 md:p-8">
            <StepIntro icon={<Mail className="h-5 w-5" aria-hidden />}>
              {heading('Scan your Gmail for tournament links')}
              <p className="text-ui text-ink-soft">
                We&apos;ll search your inbox for Tabbycat invitation emails and collect the private
                tournament links sent to you. Nothing is imported yet — the next step asks which
                names on those links are you.
              </p>
              <PrivacyFacts />
            </StepIntro>
            {scanError ? (
              <StepError title="The scan did not run" detail={scanError}>
                <RetryButton
                  onClick={() => {
                    focusAfterRender(headingRef);
                    onScan();
                  }}
                >
                  Try again
                </RetryButton>
              </StepError>
            ) : null}
            {emptyScan ? (
              <ScanEmpty
                scanned={emptyScan.scanned}
                scanning={isScanning}
                cooldownLabel={
                  cooldown.active
                    ? `Scan again in ${formatCountdown(cooldown.remainingSec)}`
                    : undefined
                }
                onScanAgain={() => {
                  focusAfterRender(headingRef);
                  onScan();
                }}
              />
            ) : (
              <div className="pt-2">
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  loading={isScanning}
                  disabled={cooldown.active}
                  leftIcon={
                    isScanning ? undefined : cooldown.active ? (
                      <Clock className="h-4 w-4" aria-hidden />
                    ) : (
                      <Search className="h-4 w-4" aria-hidden />
                    )
                  }
                  onClick={onScan}
                >
                  {isScanning
                    ? 'Scanning Gmail…'
                    : cooldown.active
                      ? `Scan again in ${formatCountdown(cooldown.remainingSec)}`
                      : 'Scan Gmail'}
                </Button>
              </div>
            )}
            <ScanCooldownNotice cooldown={cooldown} id="onboarding-scan-cooldown" />
          </CardBody>
        </Card>
      )}

      {phase === 'preflight' && (
        <Card>
          <CardBody className="space-y-4 p-6 md:p-8">
            <StepIntro
              icon={
                preflightError ? (
                  <Mail className="h-5 w-5" aria-hidden />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                )
              }
            >
              {heading('Reading your tournament links')}
              <p className="text-ui text-ink-soft">
                Opening each link to read the name it was sent to. This happens once, and no
                tournament results are saved yet.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Badge variant="info">{preflight.extracted} read</Badge>
                {preflight.failed > 0 ? (
                  <Badge variant="neutral">{preflight.failed} failed</Badge>
                ) : null}
                <Badge variant="warning">{preflight.remaining} to go</Badge>
              </div>
              <p role="status" className="text-caption text-ink-soft">
                {announced}
              </p>
            </StepIntro>

            {preflightError ? (
              <StepError
                title="Reading your links stopped"
                detail={`${preflightError}. The links read so far are kept.`}
              >
                <RetryButton
                  onClick={() => {
                    focusAfterRender(headingRef);
                    setPreflightError(null);
                    setPreflightRun((n) => n + 1);
                  }}
                >
                  Try again
                </RetryButton>
                <Button type="button" variant="ghost" size="sm" onClick={() => goTo('pick')}>
                  Skip to picking names
                </Button>
              </StepError>
            ) : null}

            {showFailureWarning ? <FailureWarning /> : null}
          </CardBody>
        </Card>
      )}

      {phase === 'pick' && (
        <Card>
          <CardBody className="space-y-5 p-6 md:p-8">
            <StepIntro icon={<UserCheck className="h-5 w-5" aria-hidden />}>
              {heading('Which of these names are you?')}
              <p className="text-ui text-ink-soft">
                We found these names on {totals.named} of your {totals.urls} tournament links.
                Tournaments often spell people slightly differently — tick every spelling
                that&apos;s you. We&apos;ll merge them into one identity on your CV.
              </p>
            </StepIntro>

            {showFailureWarning ? <FailureWarning /> : null}

            {namesState === 'loading' ? (
              <p role="status" className="flex items-center gap-2 text-ui text-ink-soft">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading names…
              </p>
            ) : namesState === 'error' ? (
              <StepError title="The names did not load">
                <RetryButton
                  onClick={() => {
                    focusAfterRender(headingRef);
                    void loadNames();
                  }}
                >
                  Retry
                </RetryButton>
              </StepError>
            ) : names.length === 0 ? (
              <p className="rounded-md border border-border bg-paper p-4 text-caption text-ink-soft">
                No names could be read from your links. Links that failed for good appear on{' '}
                <Link href="/dashboard" className="text-primary hover:underline">
                  Imports
                </Link>{' '}
                under the <strong>Failed</strong> filter.
              </p>
            ) : (
              <NamePicker
                names={names}
                selected={selected}
                error={pickError}
                firstCheckboxRef={firstCheckboxRef}
                onToggle={toggle}
              />
            )}

            {confirmError ? (
              <p role="alert" className="text-caption font-medium text-destructive">
                {confirmError}
              </p>
            ) : null}

            {namesState === 'ready' && names.length > 0 ? (
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  loading={isConfirming}
                  leftIcon={
                    !isConfirming ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : undefined
                  }
                  onClick={onConfirm}
                >
                  {isConfirming ? 'Confirming…' : 'These are me — continue'}
                </Button>
                {/* A way back to the scan step, for example to rescan after
                    connecting the right inbox (NV-15, UX-83). */}
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  disabled={isConfirming}
                  onClick={() => goTo('scan')}
                >
                  Back: scan again
                </Button>
                <p className="ml-auto text-caption text-ink-soft">
                  {selected.size} of {names.length} selected
                </p>
              </div>
            ) : null}
          </CardBody>
        </Card>
      )}

      {phase === 'done' && (
        <Card>
          <CardBody className="flex items-center gap-3 p-6 md:p-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
            {heading('Loading your Record…')}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function StepIntro({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
        {icon}
      </div>
      <div className="min-w-0 space-y-2">{children}</div>
    </div>
  );
}
