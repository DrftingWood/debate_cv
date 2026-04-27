'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Mail,
  UserCheck,
  Loader2,
  CheckCircle2,
  ChevronLeft,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
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
  names: { displayName: string; normalizedName: string; urlCount: number; isMine: boolean }[];
  totals: { urls: number; named: number; unknown: number; failed: number };
};
type ErrorsResponse = {
  failures: { id: string; url: string; host: string; error: string }[];
};

type Phase = 'scan' | 'preflight' | 'pick' | 'done';

const PHASE_ORDER: Phase[] = ['scan', 'preflight', 'pick'];

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
  const [urlCount, setUrlCount] = useState(initialUrlCount);
  const [preflight, setPreflight] = useState({
    remaining: initialPreflightRemaining,
    extracted: 0,
    failed: 0,
  });
  const [names, setNames] = useState<NamesResponse['names']>([]);
  const [totals, setTotals] = useState<NamesResponse['totals']>({
    urls: initialUrlCount,
    named: 0,
    unknown: initialPreflightRemaining,
    failed: 0,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [persistedErrors, setPersistedErrors] = useState<ErrorsResponse['failures']>([]);
  const [recentErrors, setRecentErrors] = useState<{ url: string; error: string }[]>([]);
  // The errors panel auto-opens the first time persisted errors load (so a
  // user with failures isn't left wondering why their CV is empty), but
  // honours a manual close afterwards via `errorsOpenedAuto`.
  const [errorsOpen, setErrorsOpen] = useState(false);
  const errorsAutoOpenedRef = useRef(false);
  const [isScanning, startScan] = useTransition();
  const [isConfirming, startConfirm] = useTransition();
  const [isResetting, startReset] = useTransition();

  // ── Phase 2: preflight loop ─────────────────────────────────────────────
  // Polls /api/onboarding/preflight in batches of 10 until remaining hits 0,
  // then advances to the pick phase by calling /api/onboarding/names.
  useEffect(() => {
    if (phase !== 'preflight') return;
    let cancelled = false;
    (async () => {
      // Earlier we exited on a single zero-progress response (`processed===0`),
      // which let a transient flake terminate the loop while URLs were still
      // pending. Allow a few consecutive zero-progress responses (typically
      // from a hung fetch on one URL) before giving up — the endpoint is
      // already idempotent so retrying is safe.
      const MAX_ZERO_PROGRESS_IN_A_ROW = 3;
      let zeroProgressStreak = 0;
      while (!cancelled) {
        const res = await postJson<PreflightResponse>('/api/onboarding/preflight');
        if (!res.ok) {
          toast.show({ kind: 'error', title: 'Preflight failed', description: res.error });
          return;
        }
        if (cancelled) return;
        setPreflight((p) => ({
          remaining: res.data.remaining,
          extracted: p.extracted + res.data.extracted,
          failed: p.failed + res.data.failed,
        }));
        if (res.data.errors?.length) {
          setRecentErrors((prev) => [...res.data.errors, ...prev].slice(0, 50));
        }
        if (res.data.remaining === 0) break;
        if (res.data.processed === 0) {
          zeroProgressStreak += 1;
          if (zeroProgressStreak >= MAX_ZERO_PROGRESS_IN_A_ROW) break;
        } else {
          zeroProgressStreak = 0;
        }
      }
      if (cancelled) return;
      await refreshNames();
      setPhase('pick');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Phase 3 entry: load names + persisted errors ────────────────────────
  const refreshNames = async () => {
    try {
      const [namesRes, errsRes] = await Promise.all([
        fetch('/api/onboarding/names').then((r) => r.json()),
        fetch('/api/onboarding/errors').then((r) => r.json()),
      ]);
      setNames(namesRes.names ?? []);
      setTotals(namesRes.totals ?? totals);
      const failures: ErrorsResponse['failures'] = errsRes.failures ?? [];
      setPersistedErrors(failures);
      // First time we discover persisted failures, auto-open the panel so
      // the user can see why some URLs didn't yield names. Subsequent
      // refreshes respect the user's manual open/close state.
      if (failures.length > 0 && !errorsAutoOpenedRef.current) {
        errorsAutoOpenedRef.current = true;
        setErrorsOpen(true);
      }
      setSelected(
        new Set(
          (namesRes.names ?? [])
            .filter((n: { isMine: boolean }) => n.isMine)
            .map((n: { normalizedName: string }) => n.normalizedName),
        ),
      );
    } catch (e) {
      toast.show({
        kind: 'error',
        title: 'Could not load names',
        description: e instanceof Error ? e.message : 'unknown',
      });
    }
  };

  useEffect(() => {
    if (phase === 'pick') void refreshNames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Phase 1: Gmail scan ─────────────────────────────────────────────────
  const onScan = () => {
    startScan(async () => {
      const res = await postJson<ScanResponse>('/api/ingest/gmail');
      if (!res.ok) {
        toast.show({ kind: 'error', title: 'Scan failed', description: res.error });
        return;
      }
      const found = res.data.found ?? 0;
      toast.show({
        kind: 'success',
        title: 'Gmail scan complete',
        description: `Found ${found} private URLs in ${res.data.scanned} messages.`,
      });
      setUrlCount(found);
      if (found > 0) {
        setPreflight({ remaining: found, extracted: 0, failed: 0 });
        setRecentErrors([]);
        setPhase('preflight');
      }
    });
  };

  // ── Retry: reset failures and re-fire preflight ────────────────────────
  const onRetryFailures = () => {
    startReset(async () => {
      const res = await postJson<PreflightResponse>(
        '/api/onboarding/preflight?retry=true',
      );
      if (!res.ok) {
        toast.show({ kind: 'error', title: 'Retry failed', description: res.error });
        return;
      }
      // The retry call returns the first batch's result; switch to preflight
      // phase so the loop above keeps draining the rest.
      setPreflight({
        remaining: res.data.remaining,
        extracted: res.data.extracted,
        failed: res.data.failed,
      });
      setRecentErrors(res.data.errors ?? []);
      setPhase('preflight');
    });
  };

  // ── Phase 3: confirm picks ──────────────────────────────────────────────
  const toggle = (norm: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(norm)) next.delete(norm);
      else next.add(norm);
      return next;
    });
  };

  const onConfirm = () => {
    if (selected.size === 0) {
      toast.show({
        kind: 'info',
        title: 'No names selected',
        description: 'Pick at least one name that\'s you.',
      });
      return;
    }
    const picked = names.filter((n) => selected.has(n.normalizedName));
    startConfirm(async () => {
      const res = await postJson<{ claimed: number }>('/api/onboarding/confirm', {
        names: picked.map((n) => n.displayName),
      });
      if (!res.ok) {
        toast.show({ kind: 'error', title: 'Confirm failed', description: res.error });
        return;
      }
      toast.show({
        kind: 'success',
        title: 'Identity confirmed',
        description: `${res.data.claimed} ${res.data.claimed === 1 ? 'name' : 'names'} claimed. Now ingesting tournaments…`,
      });
      setPhase('done');
      router.push('/dashboard');
    });
  };

  const goToPhase = (target: Phase) => {
    if (target === phase) return;
    setPhase(target);
  };

  return (
    <div className="space-y-6">
      <ProgressBar phase={phase} onJump={goToPhase} />

      {phase === 'scan' && (
        <Card>
          <CardBody className="space-y-4 p-6 md:p-8">
            <div className="flex items-start gap-4">
              <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                <Mail className="h-5 w-5" aria-hidden />
              </div>
              <div className="space-y-2">
                <h2 className="font-display text-h3 font-semibold text-foreground">
                  Scan your Gmail for private URLs
                </h2>
                <p className="text-[14px] text-muted-foreground">
                  We'll search your inbox for Tabbycat invitation emails (read-only) and
                  pull every private URL that was sent to you. Nothing is ingested yet —
                  the next step asks which names on those URLs are you.
                </p>
              </div>
            </div>
            <div className="pt-2">
              <Button
                type="button"
                variant="primary"
                size="lg"
                loading={isScanning}
                leftIcon={!isScanning ? <Search className="h-4 w-4" aria-hidden /> : undefined}
                onClick={onScan}
              >
                {isScanning ? 'Scanning Gmail…' : 'Scan Gmail'}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {phase === 'preflight' && (
        <Card>
          <CardBody className="space-y-4 p-6 md:p-8">
            <div className="flex items-start gap-4">
              <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              </div>
              <div className="space-y-2">
                <h2 className="font-display text-h3 font-semibold text-foreground">
                  Reading the names off your private URLs
                </h2>
                <p className="text-[14px] text-muted-foreground">
                  Visiting each URL's landing page and pulling the registered participant
                  name. This is a one-time preflight — no tournament data is stored yet.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Badge variant="info">{preflight.extracted} extracted</Badge>
                  {preflight.failed > 0 ? (
                    <Badge variant="neutral">{preflight.failed} failed</Badge>
                  ) : null}
                  <Badge variant="warning">{preflight.remaining} remaining</Badge>
                </div>
              </div>
            </div>

            {recentErrors.length > 0 ? (
              <RecentErrors errors={recentErrors} />
            ) : null}

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                leftIcon={<ChevronLeft className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => goToPhase('scan')}
              >
                Back to scan
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => goToPhase('pick')}
              >
                Skip to picker (use what's done so far)
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {phase === 'pick' && (
        <Card>
          <CardBody className="space-y-5 p-6 md:p-8">
            <div className="flex items-start gap-4">
              <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                <UserCheck className="h-5 w-5" aria-hidden />
              </div>
              <div className="space-y-1.5">
                <h2 className="font-display text-h3 font-semibold text-foreground">
                  Which of these names are you?
                </h2>
                <p className="text-[14px] text-muted-foreground">
                  We extracted these names from {totals.named} of your{' '}
                  {totals.urls} private URLs. Tournaments often spell people slightly
                  differently — tick every spelling that's you. We'll merge them into
                  one identity on your CV.
                </p>
                {totals.failed > 0 ? (
                  <p className="text-caption text-muted-foreground">
                    {totals.failed} {totals.failed === 1 ? 'URL' : 'URLs'} couldn't be
                    parsed — open the errors panel below to see exactly what went wrong.
                  </p>
                ) : null}
              </div>
            </div>

            {names.length === 0 ? (
              <p className="rounded-md border border-border bg-muted/40 p-4 text-caption text-muted-foreground">
                No names extracted yet. Open the errors below to see what failed,
                then click <strong>Reset and try again</strong> to re-run preflight on
                those URLs.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-card border border-border bg-card">
                {names.map((n) => {
                  const checked = selected.has(n.normalizedName);
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
                          {n.isMine ? (
                            <Badge variant="success">Already mine</Badge>
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
            )}

            <ErrorsPanel
              failures={persistedErrors}
              open={errorsOpen}
              onToggle={() => setErrorsOpen((v) => !v)}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  leftIcon={<ChevronLeft className="h-3.5 w-3.5" aria-hidden />}
                  onClick={() => goToPhase('scan')}
                >
                  Back to scan
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={isResetting}
                  leftIcon={
                    !isResetting ? <RefreshCw className="h-3.5 w-3.5" aria-hidden /> : undefined
                  }
                  onClick={onRetryFailures}
                  title="Clears every URL's cached name and re-fetches all landings"
                >
                  Re-extract all names
                </Button>
              </div>
              <Button
                type="button"
                variant="primary"
                size="lg"
                disabled={selected.size === 0 || isConfirming}
                loading={isConfirming}
                leftIcon={
                  !isConfirming ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : undefined
                }
                onClick={onConfirm}
              >
                {isConfirming ? 'Confirming…' : 'These are me — continue'}
              </Button>
            </div>
            <p className="text-caption text-muted-foreground">
              {selected.size} of {names.length} selected
            </p>
          </CardBody>
        </Card>
      )}

      {phase === 'done' && (
        <Card>
          <CardBody className="flex items-center gap-3 p-6 md:p-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
            <p className="text-foreground">Loading your dashboard…</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function ProgressBar({ phase, onJump }: { phase: Phase; onJump: (p: Phase) => void }) {
  const steps: { key: Phase; label: string }[] = [
    { key: 'scan', label: 'Scan Gmail' },
    { key: 'preflight', label: 'Read names' },
    { key: 'pick', label: 'Pick yourself' },
  ];
  const order = (p: Phase) => steps.findIndex((s) => s.key === p);
  const current = phase === 'done' ? steps.length : order(phase);
  return (
    <ol className="flex items-center justify-between gap-2 rounded-card border border-border bg-card/60 p-3">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.key} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => onJump(s.key)}
              className={
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold transition-colors hover:opacity-80 ' +
                (done
                  ? 'bg-primary text-primary-foreground'
                  : active
                    ? 'bg-primary-soft text-primary ring-2 ring-primary/40'
                    : 'bg-muted text-muted-foreground')
              }
              aria-label={`Go to step ${i + 1}: ${s.label}`}
            >
              {done ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : i + 1}
            </button>
            <button
              type="button"
              onClick={() => onJump(s.key)}
              className={
                'truncate text-left text-caption hover:underline ' +
                (active ? 'font-medium text-foreground' : 'text-muted-foreground')
              }
            >
              {s.label}
            </button>
            {i < steps.length - 1 ? (
              <span aria-hidden className="hidden flex-1 border-t border-dashed border-border md:block" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function RecentErrors({ errors }: { errors: { url: string; error: string }[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-caption">
      <div className="mb-1.5 inline-flex items-center gap-1.5 font-medium text-warning">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        {errors.length} most recent {errors.length === 1 ? 'failure' : 'failures'}
      </div>
      <ul className="max-h-48 space-y-1 overflow-auto">
        {errors.slice(0, 10).map((e, i) => (
          <li key={i} className="font-mono text-[11.5px] text-muted-foreground">
            <span className="text-foreground">{new URL(e.url).host}</span> — {e.error}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ErrorsPanel({
  failures,
  open,
  onToggle,
}: {
  failures: { id: string; url: string; host: string; error: string }[];
  open: boolean;
  onToggle: () => void;
}) {
  if (failures.length === 0) return null;
  return (
    <div className="rounded-card border border-border bg-card/60">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-[13.5px] hover:bg-muted/30"
      >
        <span className="inline-flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden />
          {failures.length} {failures.length === 1 ? 'URL' : 'URLs'} couldn't be parsed
          — show details
        </span>
        <ChevronDown
          className={
            'h-4 w-4 text-muted-foreground transition-transform ' + (open ? 'rotate-180' : '')
          }
          aria-hidden
        />
      </button>
      {open ? (
        <ul className="max-h-72 divide-y divide-border overflow-auto">
          {failures.map((f) => (
            <li key={f.id} className="space-y-1 px-4 py-2.5 text-[12.5px]">
              <div className="font-medium text-foreground">{f.host}</div>
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block break-all font-mono text-[11.5px] text-muted-foreground hover:text-primary"
              >
                {f.url}
              </a>
              <div className="font-mono text-[11.5px] text-destructive">{f.error}</div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
