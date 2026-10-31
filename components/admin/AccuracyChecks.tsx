import { Badge } from '@/components/ui/Badge';
import { StatusPill, type Status } from '@/components/ui/StatusPill';
import { AuditNowButton } from '@/components/admin/AuditNowButton';
import { CheckActions, CheckActionsProvider } from '@/components/admin/CheckActions';
import { InferFormatButton } from '@/components/admin/InferFormatButton';
import { TabLink } from '@/components/admin/TabLink';
import { BAND_BADGE } from '@/components/admin/bandBadge';
import type { TournamentAccuracy } from '@/lib/admin/tournamentAccuracy';
import { adminTabHref } from '@/lib/admin/adminTabs';
import type { CheckStatus } from '@/lib/audit/types';
import { relativeTime } from '@/lib/utils/relativeTime';

// Pass is done, a failure is failed and a check that could not run is
// unavailable, the same pill states the grid below uses. A warning has its
// own state: 'pending' would read as a check still in progress, when the
// check has finished and found something to look at.
const PILL: Record<CheckStatus, { status: Status; label: string }> = {
  pass: { status: 'done', label: 'Pass' },
  warn: { status: 'warning', label: 'Check' },
  fail: { status: 'failed', label: 'Fail' },
  na: { status: 'unavailable', label: 'Not applicable' },
};

// A check an admin has vouched for is a pass in the score, but it says who
// vouched, so it is a state of its own and not a plain "Pass".
const CHECKED_PILL = { status: 'done', label: 'Checked' } as const;

/**
 * "Accuracy checks" above the piece grid: this tournament's score, each
 * check with its finding, and the pages a re-scrape should fetch, so the
 * admin can read why a score is low and then tick those pieces below. A
 * server component: the audit arrives ready to show, with public URLs only.
 */
export function AccuracyChecks({
  tournamentId,
  tournamentName,
  audit,
  loadFailed = false,
  now,
}: {
  tournamentId: string;
  tournamentName: string;
  audit: TournamentAccuracy | null;
  /** The stored audit could not be read: said as such, never as "Not audited yet". */
  loadFailed?: boolean;
  now: Date;
}) {
  return (
    <section aria-labelledby="accuracy-checks" className="space-y-stack rounded-lg border p-panel">
      <div className="flex flex-wrap items-start justify-between gap-tight">
        <div className="space-y-hair">
          <h2 id="accuracy-checks" className="font-display text-h3 font-medium text-ink">
            Accuracy checks
          </h2>
          <p className="flex flex-wrap items-center gap-inline text-ui text-ink-soft">
            {audit ? (
              <>
                <span className="font-mono tabular-nums text-ink">
                  <span className="text-h4 font-medium">{audit.score}</span> / 100
                </span>
                <Badge variant={BAND_BADGE[audit.band].variant}>
                  {BAND_BADGE[audit.band].text}
                </Badge>
                <span className="font-mono text-caption tabular-nums">
                  Audited{' '}
                  <time dateTime={audit.computedAt.toISOString()}>
                    {relativeTime(audit.computedAt, now)}
                  </time>
                </span>
              </>
            ) : loadFailed ? (
              <span>Couldn&rsquo;t load the accuracy checks</span>
            ) : (
              <span>Not audited yet</span>
            )}
          </p>
        </div>
        <AuditNowButton tournamentId={tournamentId} tournamentName={tournamentName} />
      </div>

      <AuditNotes audit={audit} />
      {audit && audit.checks.length > 0 ? (
        <CheckActionsProvider>
          <ul className="divide-y divide-border rounded-md border border-border">
            {audit.checks.map((c) => (
              <CheckRow
                key={c.code}
                check={c}
                tournamentId={tournamentId}
                tournamentName={tournamentName}
              />
            ))}
          </ul>
        </CheckActionsProvider>
      ) : null}
    </section>
  );
}

function CheckRow({
  check: c,
  tournamentId,
  tournamentName,
}: {
  check: TournamentAccuracy['checks'][number];
  tournamentId: string;
  tournamentName: string;
}) {
  const pill = c.checked ? CHECKED_PILL : PILL[c.status];
  return (
    <li className="space-y-hair px-tight py-inline">
      <div className="flex flex-wrap items-center justify-between gap-inline">
        <h3 className="text-ui font-medium text-ink">{c.label}</h3>
        <StatusPill status={pill.status} label={pill.label} />
      </div>
      {c.detail ? <p className="max-w-prose text-body text-ink-soft">{c.detail}</p> : null}
      {c.pieces.length > 0 ? (
        <p className="flex flex-wrap items-baseline gap-x-inline text-caption text-ink-soft">
          <span>Pages to re-scrape:</span>
          {c.pieces.map((p) => (
            <TabLink
              key={`${p.kind}:${p.key}`}
              url={p.url}
              text={p.label}
              of={`${c.label} check`}
              className="font-mono"
            />
          ))}
        </p>
      ) : null}
      {c.questions.map((q) => (
        <p key={q.code} className="text-caption text-ink-soft">
          <a
            href={adminTabHref('tournaments', { question: q.code })}
            className="underline underline-offset-4"
          >
            Open question: {q.title}
          </a>
        </p>
      ))}
      {/* The missing format has a fix of its own, read from the stored rounds;
          the pages above are what it falls back to when they cannot decide. */}
      {c.code === 'format_missing' && c.status === 'fail' ? (
        <InferFormatButton
          tournamentId={tournamentId}
          tournamentName={tournamentName}
          pieces={c.pieces}
        />
      ) : null}
      <CheckActions
        tournamentName={tournamentName}
        label={c.label}
        subject={c.subject}
        fingerprint={c.fingerprint}
        checkedWords={c.checked?.words ?? null}
      />
    </li>
  );
}

/** Words, not colour, for an audit that is out of date or has no rows. */
function AuditNotes({ audit }: { audit: TournamentAccuracy | null }) {
  if (!audit) return null;
  return (
    <>
      {audit.outdated ? (
        <p className="text-caption text-ink-soft">
          Audited with older checks &mdash; Audit again to bring them up to date.
        </p>
      ) : null}
      {audit.checks.length === 0 ? (
        <p className="text-caption text-ink-soft">
          No check results stored &mdash; Audit again to produce them.
        </p>
      ) : null}
    </>
  );
}
