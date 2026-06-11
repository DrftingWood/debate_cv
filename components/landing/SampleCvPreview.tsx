import Link from 'next/link';
import { ArrowUpRight, CheckCircle2, Lock, Share2, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

type SampleCvPreviewProps = {
  compact?: boolean;
  className?: string;
};

const metrics = [
  { label: 'Tournaments', value: '23' },
  { label: 'Breaks', value: '9' },
  { label: 'Best avg', value: '74.2' },
  { label: 'Active years', value: '2022–26' },
];

const tournaments = [
  { name: 'World Universities Debating Championship', meta: '2024 · Speaker', result: 'Octofinalist', score: '73.8 avg' },
  { name: 'Australs', meta: '2024 · Speaker', result: 'Open break', score: '+2.1 YoY' },
  { name: 'Hart House IV', meta: '2023 · Speaker', result: 'Champion', score: '74.2 avg' },
];

const trend = [38, 45, 42, 56, 61, 68, 74, 78, 84];

export function SampleCvPreview({ compact = false, className }: SampleCvPreviewProps) {
  return (
    <article className={cn('record-panel overflow-hidden', className)} aria-label="Sample debate CV preview">
      <div className="flex items-start justify-between gap-4 border-b border-record-rule px-4 py-4 sm:px-5">
        <div>
          <div className="eyebrow">Sample CV</div>
          <h2 className="mt-1 font-display text-h3 font-semibold tracking-tight text-record-ink">
            Maya Rao
          </h2>
          <p className="mt-1 text-caption text-record-muted">University debate · private preview</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-record-rule bg-record-surface px-3 py-1.5 text-caption font-medium text-record-ink">
          <Lock className="h-3.5 w-3.5 text-record-green" aria-hidden />
          Private
        </div>
      </div>

      <div className="grid grid-cols-2 border-b border-record-rule sm:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="border-r border-record-rule px-4 py-3 last:border-r-0 sm:px-5">
            <div className="data-label">{metric.label}</div>
            <div className="mt-1 font-mono text-stat font-semibold text-record-ink">{metric.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-0 md:grid-cols-[1fr_0.8fr]">
        <div className="px-4 py-4 sm:px-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="eyebrow">Verified record</div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-record-green-soft px-2.5 py-1 text-caption font-medium text-record-green">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              18 source links
            </span>
          </div>
          <div className="space-y-2.5">
            {tournaments.map((tournament) => (
              <div key={tournament.name} className="rounded-lg border border-record-rule bg-record-surface px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-ui font-semibold leading-snug text-record-ink">{tournament.name}</div>
                    <div className="mt-1 text-caption text-record-muted">{tournament.meta}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-caption font-semibold text-break-gold">{tournament.result}</div>
                    <div className="mt-1 font-mono text-caption text-record-muted">{tournament.score}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-record-rule bg-record-surface px-4 py-4 md:border-l md:border-t-0 sm:px-5">
          <div className="flex items-center gap-2 text-ui font-semibold text-record-ink">
            <TrendingUp className="h-4 w-4 text-score-blue" aria-hidden />
            Growth signal
          </div>
          <div className="mt-3 flex h-24 items-end gap-1.5" aria-hidden>
            {trend.map((value, index) => (
              <div
                key={index}
                className="w-full rounded-t bg-score-blue/80"
                style={{ height: `${value}%` }}
              />
            ))}
          </div>
          <p className="mt-3 text-caption leading-relaxed text-record-muted">
            Speaker average up <span className="font-mono font-semibold text-record-ink">+2.8</span> since 2022.
            Breaks cluster in 7+ round tournaments.
          </p>
          {!compact ? (
            <Link
              href="/sample"
              className="mt-4 inline-flex items-center gap-2 text-ui font-semibold text-record-green hover:underline"
            >
              Open full sample <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-record-rule px-4 py-3 text-caption text-record-muted sm:px-5">
        <span className="inline-flex items-center gap-2">
          <Share2 className="h-3.5 w-3.5" aria-hidden />
          Share link stays off until you publish it.
        </span>
        <span className="font-mono">Last updated · just now</span>
      </div>
    </article>
  );
}
