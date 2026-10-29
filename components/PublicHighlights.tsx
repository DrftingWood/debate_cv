import type { Highlight } from '@/lib/cv/publicHighlights';

/**
 * Highlights as two short lists side by side (decision 18): the best three
 * results in each role, majors first, as statement entries. A role with
 * nothing to show is left out; with neither, the section is.
 */
export function PublicHighlights({
  speaking,
  judging,
}: {
  speaking: Highlight[];
  judging: Highlight[];
}) {
  const lists = [
    { key: 'speaking', title: 'Speaking', items: speaking },
    { key: 'judging', title: 'Judging', items: judging },
  ].filter((l) => l.items.length > 0);
  if (lists.length === 0) return null;
  return (
    <section aria-labelledby="highlights" className="space-y-stack">
      <h2 id="highlights" className="data-label">
        Highlights
      </h2>
      <div className={lists.length === 2 ? 'grid gap-group md:grid-cols-2' : undefined}>
        {lists.map((l) => (
          <div key={l.key}>
            <h3 className="font-display text-h4 font-medium text-ink">{l.title}</h3>
            <ol className="mt-tight divide-y divide-border border-y border-border">
              {l.items.map((h) => (
                <li
                  key={`${h.tournamentName}|${h.year}`}
                  className="flex items-baseline justify-between gap-stack py-tight"
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{h.detail}</span>
                    <span className="block text-caption text-ink-soft">
                      {h.tournamentName}
                      {h.major ? <span className="ml-hair font-mono text-ink">◆</span> : null}
                      {h.major ? <span className="sr-only"> (a major)</span> : null}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-caption text-ink-soft">
                    {h.year ?? ''}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
