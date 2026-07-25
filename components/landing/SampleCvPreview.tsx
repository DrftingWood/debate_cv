import Link from 'next/link';
import { ArrowUpRight, Lock } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Sparkline } from '@/components/ui/TrendChart';
import { Badge } from '@/components/ui/Badge';

type SampleCvPreviewProps = {
  compact?: boolean;
  className?: string;
};

/**
 * The signed-out product proof: a miniature of the real statement UI, built
 * from the same tokens and table mechanics as /cv so what a visitor sees
 * before signing in is what they get afterwards. Data is fictional and
 * labelled as such.
 */
const metrics = [
  { label: 'Tournaments', value: '23' },
  { label: 'Breaks', value: '9', gold: true },
  { label: 'Career avg', value: '74.2' },
  { label: 'Tab placement', value: 'Top 8%' },
];

const rows = [
  { name: 'World Universities', year: '2024', avg: '73.8', field: '18/412', result: 'Octofinals', broke: true },
  { name: 'Australs', year: '2024', avg: '72.9', field: '31/188', result: 'Open break', broke: true },
  { name: 'Hart House IV', year: '2023', avg: '74.2', field: '4/96', result: 'Champion', broke: true },
  { name: 'Cambridge IV', year: '2023', avg: '71.4', field: '77/240', result: '—', broke: false },
];

const trend = [71.1, 71.8, 71.4, 72.6, 73.1, 73.4, 74.2, 73.9, 74.6];

export function SampleCvPreview({ compact = false, className }: SampleCvPreviewProps) {
  return (
    <article
      className={cn('panel overflow-hidden shadow-md', className)}
      aria-label="Sample debate CV preview"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3.5">
        <div>
          <div className="data-label">Debate record · sample</div>
          <h2 className="mt-1 font-display text-h4 font-medium tracking-tight text-ink">
            Maya Rao
          </h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded border border-border bg-surface-2 px-2 py-1 text-caption text-ink-soft">
          <Lock className="h-3 w-3 text-primary" aria-hidden />
          Private
        </span>
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="bg-card px-4 py-3">
            <div className="data-label truncate">{metric.label}</div>
            <div
              className={cn(
                'figure mt-1 text-figure-sm',
                metric.gold ? 'text-break-gold' : 'text-ink',
              )}
            >
              {metric.value}
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="ledger text-caption">
          <thead>
            <tr>
              <th className="pl-4">Tournament</th>
              <th className="text-right">Avg</th>
              <th className="text-right">On the tab</th>
              <th className="pr-4">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td className="pl-4">
                  <span className="font-medium text-ink">{row.name}</span>
                  <span className="num ml-1.5 text-ink-soft">{row.year}</span>
                </td>
                <td className="cell-num">{row.avg}</td>
                <td className="cell-num text-ink-soft">{row.field}</td>
                <td className="whitespace-nowrap pr-4">
                  {row.broke ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Badge variant="gold">Broke</Badge>
                      <span className="text-ink">{row.result}</span>
                    </span>
                  ) : (
                    <span className="text-ink-soft/60">{row.result}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-2 px-4 py-3">
        <div className="min-w-0">
          <div className="data-label">Speaker average, 9 seasons</div>
          <p className="mt-1 text-caption text-ink-soft">
            Up <span className="num val-pos">+2.8</span> since the first parsed season
          </p>
        </div>
        <Sparkline values={trend} width={120} height={30} />
      </div>

      {!compact ? (
        <div className="border-t border-border px-4 py-3">
          <Link
            href="/sample"
            className="inline-flex items-center gap-1.5 text-table font-medium text-primary hover:underline"
          >
            Open the full sample <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      ) : null}
    </article>
  );
}
