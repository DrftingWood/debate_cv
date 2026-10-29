import type { SpeakerStats } from '@/lib/cv/speakerStats';
import { SectionHeader } from '@/components/ui/Card';

/*
 * The Statistics summary strip's findings ("What the numbers say"): the
 * strongest four, then a fold. Moved out of StatsSections.tsx, which is over
 * the 800-line cap and may not grow.
 */

/** Findings shown before the "Show more" fold: the strongest, as the engine orders them. */
const FINDINGS_SHOWN = 4;

export function Quirks({ stats, visibleIds }: { stats: SpeakerStats; visibleIds?: string[] }) {
  const quirks = visibleIds ? stats.quirks.filter((q) => visibleIds.includes(q.id)) : stats.quirks;
  if (quirks.length === 0) return null;
  const shown = quirks.slice(0, FINDINGS_SHOWN);
  const more = quirks.slice(FINDINGS_SHOWN);
  return (
    <section id="findings" aria-label="What the numbers say" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Findings"
        title="What the numbers say"
        meta="Each one rests on the figures in the tabs below"
      />
      <FindingGrid quirks={shown} />
      {/*
        The rest fold away (owner review 2026-10-29: nine finding cards
        pushed the tabs 1,021 px down the page, a screen and a half before
        any section).
      */}
      {more.length > 0 ? (
        <details className="group/more">
          <summary className="inline-flex min-h-6 cursor-pointer items-center gap-hair text-caption font-medium text-primary">
            <span className="group-open/more:hidden">
              Show {more.length} more finding{more.length === 1 ? '' : 's'}
            </span>
            <span className="hidden group-open/more:inline">Show fewer</span>
          </summary>
          <div className="mt-3">
            <FindingGrid quirks={more} />
          </div>
        </details>
      ) : null}
    </section>
  );
}

/** Direction in a glyph as well as a colour, never colour alone (UX-47). */
const TONE_MARK = { pos: '▲', neg: '▼', neutral: '•' } as const;

function FindingGrid({ quirks }: { quirks: SpeakerStats['quirks'] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {quirks.map((q) => (
        <article key={q.id} className="panel p-4">
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden
              className={
                'mt-px w-3 shrink-0 text-center text-caption leading-5 ' +
                (q.tone === 'pos' ? 'text-pos' : q.tone === 'neg' ? 'text-neg' : 'text-ink-soft')
              }
            >
              {TONE_MARK[q.tone === 'pos' || q.tone === 'neg' ? q.tone : 'neutral']}
            </span>
            <div className="min-w-0">
              <p className="text-table text-ink">{q.text}</p>
              <p className="mt-1.5 data-label">{q.basis}</p>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
