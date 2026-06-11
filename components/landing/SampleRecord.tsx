import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatBlock } from '@/components/ui/StatBlock';
import { SourceBadge } from '@/components/ui/SourceBadge';
import { BreakMarker } from '@/components/ui/BreakMarker';
import { ResultLine } from '@/components/ui/ResultLine';
import { cn } from '@/lib/utils/cn';
import {
  SAMPLE_NAME,
  sampleSpeakerRows,
  sampleJudgeRows,
  sampleStats,
  sampleGrowthLines,
} from './sampleRecord';

/**
 * The full-fidelity sample record — the landing page's sales argument
 * (teardown §2.3: the artifact IS the page). Rendered with the same record
 * primitives the real CV uses, never a scaled-down marketing card. The
 * fictional rows live in ./sampleRecord.ts; their headline stats are
 * derived, so the numbers always reconcile with the visible rows.
 */
export function SampleRecord({ className }: { className?: string }) {
  return (
    <article className={cn('space-y-10', className)} aria-label="Sample debate CV (fictional data)">
      {/* Record masthead */}
      <header className="space-y-4">
        <div className="eyebrow">Sample record — fictional debater, real structure</div>
        <h2 className="display-expanded font-display text-h1 font-bold tracking-tight text-record-ink">
          {SAMPLE_NAME}
        </h2>
        <p className="meta">
          {sampleStats.tournaments} tournaments · verified via tab links · {sampleStats.span}
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <StatBlock label="Tournaments" value={sampleStats.tournaments} />
          <StatBlock label="Breaks" value={sampleStats.breaks} />
          <StatBlock label="Titles" value={sampleStats.titles} />
          <StatBlock label="Best avg" value={sampleStats.bestAvg} />
        </div>
      </header>

      {/* Speaking */}
      <section aria-label="Speaking" className="space-y-0">
        <SectionHeader title="Speaking" count={sampleSpeakerRows.length} />

        {/* Desktop: the tab itself */}
        <table className="hidden w-full text-table md:table">
          <thead>
            <tr className="border-b border-record-rule/50 text-left">
              {['Year', 'Tournament', 'Format', 'Team', 'Spk avg', 'Spk rank', 'Result', 'Source'].map((h) => (
                <th key={h} className="data-label px-3 py-2.5 first:pl-0 last:pr-0 last:text-right">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sampleSpeakerRows.map((row) => (
              <tr
                key={`${row.year}-${row.tournament}`}
                className={cn(
                  'border-b border-record-rule/40',
                  row.broke && 'border-l-2 border-l-break-gold',
                )}
              >
                <td className={cn('num px-3 py-2.5 text-record-muted', row.broke ? 'pl-3' : 'pl-0')}>{row.year}</td>
                <td className="px-3 py-2.5 font-semibold text-record-ink">{row.tournament}</td>
                <td className="px-3 py-2.5 text-record-muted">{row.format}</td>
                <td className="num px-3 py-2.5 text-record-ink">{row.teamRank}</td>
                <td className="num px-3 py-2.5 text-record-ink">{row.avg.toFixed(1)}</td>
                <td className="num px-3 py-2.5 text-record-muted">{row.spkRank ?? '—'}</td>
                <td className="px-3 py-2.5">
                  {row.result ? <BreakMarker>{row.result}</BreakMarker> : <span className="text-record-muted">—</span>}
                </td>
                <td className="px-3 py-2.5 pr-0 text-right">
                  <SourceBadge href="/sample" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mobile: result lines — the screenshot-able unit */}
        <div className="md:hidden">
          {sampleSpeakerRows.map((row) => (
            <ResultLine
              key={`${row.year}-${row.tournament}`}
              title={row.tournament}
              meta={row.year}
              broke={row.broke}
              data={
                <span>
                  {row.teamRank} · {row.avg.toFixed(1)} avg{row.spkRank ? ` · ${row.spkRank} spk` : ''}
                </span>
              }
              result={row.result ? <BreakMarker>{row.result}</BreakMarker> : undefined}
            />
          ))}
        </div>
      </section>

      {/* Judging */}
      <section aria-label="Judging" className="space-y-0">
        <SectionHeader title="Judging" count={sampleJudgeRows.length} />

        <table className="hidden w-full text-table md:table">
          <thead>
            <tr className="border-b border-record-rule/50 text-left">
              {['Year', 'Tournament', 'Format', 'Prelims', 'Chaired', 'Deepest outround'].map((h) => (
                <th key={h} className="data-label px-3 py-2.5 first:pl-0 last:pr-0">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sampleJudgeRows.map((row) => (
              <tr key={`${row.year}-${row.tournament}`} className="border-b border-record-rule/40">
                <td className="num px-3 py-2.5 pl-0 text-record-muted">{row.year}</td>
                <td className="px-3 py-2.5 font-semibold text-record-ink">{row.tournament}</td>
                <td className="px-3 py-2.5 text-record-muted">{row.format}</td>
                <td className="num px-3 py-2.5 text-record-ink">{row.prelims}</td>
                <td className="num px-3 py-2.5 text-record-ink">{row.chaired}</td>
                <td className="px-3 py-2.5 pr-0 text-record-ink">{row.outround ?? <span className="text-record-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="md:hidden">
          {sampleJudgeRows.map((row) => (
            <ResultLine
              key={`${row.year}-${row.tournament}`}
              title={row.tournament}
              meta={row.year}
              data={
                <span>
                  {row.prelims} prelims · {row.chaired} chaired{row.outround ? ` · ${row.outround}` : ''}
                </span>
              }
            />
          ))}
        </div>
      </section>

      {/* Growth — factual, explainable from the rows above */}
      <section aria-label="Growth" className="space-y-0">
        <SectionHeader title="Growth" />
        <ul className="divide-y divide-record-rule/40">
          {sampleGrowthLines.map((line) => (
            <li key={line} className="py-2.5 font-mono text-caption leading-relaxed text-record-muted">
              {line}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
