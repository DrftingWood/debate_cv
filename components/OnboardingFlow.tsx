'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Search,
  Mail,
  UserCheck,
  Loader2,
  CheckCircle2,
  AlertTriangle,
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

type Phase = 'scan' | 'preflight' | 'pick' | 'done';

/**
 * First-time onboarding wizard. Strictly forward: scan → preflight → pick →
 * done. Re-entry users (those with ≥1 claimed Person) never see this — they
 * hit the stub on /onboarding instead and manage identities from
 * /settings/profile. Failures during preflight are summarized with a
 * threshold banner; per-URL retry is not exposed here, since permanent
 * failures route to the dashboard's `Failed` filter for triage.
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
  const [names, setNames] = useState<NamesResponse['names']>([]);
  const [totals, setTotals] = useState<NamesResponse['totals']>({
    urls: initialUrlCount,
    named: 0,
    unknown: initialPreflightRemaining,
    failed: 0,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isScanning, startScan] = useTransition();
  const [isConfirming, startConfirm] = useTransition();

  // ── Phase 2: preflight loop ─────────────────────────────────────────────
  // Polls /api/onboarding/preflight in batches of 10 until remaining hits 0.
  // Allow a few consecutive zero-progress responses (typically a hung fetch
  // on one URL) before giving up — the endpoint is idempotent so retrying
  // is safe.
  useEffect(() => {
    if (phase !== 'preflight') return;
    let cancelled = false;
    (async () => {
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

  // ── Phase 3 entry: load names ──────────────────────────────────────────
  const refreshNames = async () => {
    try {
      const res = await fetch('/api/onboarding/names').then((r) => r.json());
      setNames(res.names ?? []);
      setTotals(res.totals ?? totals);
      setSelected(
        new Set(
          (res.names ?? [])
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
      if (found > 0) {
        setPreflight({ remaining: found, extracted: 0, failed: 0 });
        setPhase('preflight');
      }
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
      const res = await postJson<{ claimed: number; unclaimed: number }>(
        '/api/onboarding/confirm',
        { names: picked.map((n) => n.displayName) },
      );
      if (!res.ok) {
        toast.show({ kind: 'error', title: 'Confirm failed', description: res.error });
        return;
      }
      const { claimed, unclaimed } = res.data;
      const parts: string[] = [];
      parts.push(`${claimed} ${claimed === 1 ? 'name' : 'names'} claimed`);
      if (unclaimed > 0) {
        parts.push(`${unclaimed} ${unclaimed === 1 ? 'name' : 'names'} removed`);
      }
      toast.show({
        kind: 'success',
        title: 'Identity confirmed',
        description: `${parts.join(', ')}. Now ingesting tournaments…`,
      });
      setPhase('done');
      router.push('/dashboard');
    });
  };

  // Threshold banner: surface when failure rate is so high that the user
  // probably has a systemic problem (wrong Gmail account, OAuth scope
  // missing, Cloudflare blocking everything). Below this rate we trust the
  // queue and stay quiet.
  const totalProcessed = preflight.extracted + preflight.failed;
  const showFailureWarning =
    totalProcessed > 5 && preflight.failed / totalProcessed > 0.5;

  return (
    <div className="space-y-6">
      <ProgressBar phase={phase} />

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
                  We&apos;ll search your inbox for Tabbycat invitation emails (read-only) and
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
                  Visiting each URL&apos;s landing page and pulling the registered participant
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

            {showFailureWarning ? <FailureWarning /> : null}
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
                  differently — tick every spelling that&apos;s you. We&apos;ll merge them into
                  one identity on your CV.
                </p>
              </div>
            </div>

            {showFailureWarning ? <FailureWarning /> : null}

            {names.length === 0 ? (
              <p className="rounded-md border border-border bg-muted/40 p-4 text-caption text-muted-foreground">
                No names extracted. Any URLs that failed permanently will appear on the{' '}
                <Link href="/dashboard" className="text-primary hover:underline">
                  dashboard
                </Link>{' '}
                under the <strong>Failed</strong> filter.
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

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <p className="text-caption text-muted-foreground">
                {selected.size} of {names.length} selected
              </p>
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

function ProgressBar({ phase }: { phase: Phase }) {
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
            <span
              className={
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold ' +
                (done
                  ? 'bg-primary text-primary-foreground'
                  : active
                    ? 'bg-primary-soft text-primary ring-2 ring-primary/40'
                    : 'bg-muted text-muted-foreground')
              }
              aria-current={active ? 'step' : undefined}
            >
              {done ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : i + 1}
            </span>
            <span
              className={
                'truncate text-caption ' +
                (active ? 'font-medium text-foreground' : 'text-muted-foreground')
              }
            >
              {s.label}
            </span>
            {i < steps.length - 1 ? (
              <span aria-hidden className="hidden flex-1 border-t border-dashed border-border md:block" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function FailureWarning() {
  return (
    <div className="rounded-md border border-warning/30 bg-warning/5 p-4 text-[13px]">
      <div className="mb-1.5 inline-flex items-center gap-1.5 font-medium text-warning">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        We couldn&apos;t read most of your URLs
      </div>
      <p className="text-muted-foreground">
        This usually means a Gmail connection issue or that your URLs are
        blocked at the source. Permanent failures will appear on the{' '}
        <Link href="/dashboard" className="text-primary hover:underline">
          dashboard
        </Link>{' '}
        once preflight finishes, where you can retry them or check your{' '}
        <Link href="/settings" className="text-primary hover:underline">
          Gmail connection
        </Link>
        .
      </p>
    </div>
  );
}
