import { Badge } from '@/components/ui/Badge';
import { StatusPill, type Status } from '@/components/ui/StatusPill';
import { AuditNowButton } from '@/components/admin/AuditNowButton';
import { TabLink } from '@/components/admin/TabLink';
import { BAND_BADGE } from '@/components/admin/bandBadge';
import type { TournamentAccuracy } from '@/lib/admin/tournamentAccuracy';
import type { CheckStatus } from '@/lib/audit/types';
import { relativeTime } from '@/lib/utils/relativeTime';

// Pass is done, a warning is pending, a failure is failed and a check that
// could not run is unavailable, the same pill states the grid below uses.
const PILL: Record<CheckStatus, { status: Status; label: string }> = {
  pass: { status: 'done', label: 'Pass' },
  warn: { status: 'pending', label: 'Check' },
  fail: { status: 'failed', label: 'Fail' },
  na: { status: 'unavailable', label: 'Not applicable' },
};

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
  now,
}: {
  tournamentId: string;
  tournamentName: string;
  audit: TournamentAccuracy | null;
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
            ) : (
              <span>Not audited yet</span>
            )}
          </p>
        </div>
        <AuditNowButton tournamentId={tournamentId} tournamentName={tournamentName} />
      </div>

      <AuditNotes audit={audit} />
      {audit && audit.checks.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {audit.checks.map((c) => (
            <CheckRow key={c.code} check={c} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function CheckRow({ check: c }: { check: TournamentAccuracy['checks'][number] }) {
  const pill = PILL[c.status];
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
          <a href="/admin#open-questions" className="underline underline-offset-4">
            Open question: {q.title}
          </a>
        </p>
      ))}
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
