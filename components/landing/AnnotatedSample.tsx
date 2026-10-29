import { CareerChart } from '@/components/ui/CareerChart';
import { Badge } from '@/components/ui/Badge';
import { ArrowSquareOut } from '@/components/ui/icons';
import { formatStageForDisplay } from '@/lib/cv/formatStage';
import {
  SAMPLE_NAME,
  SAMPLE_SPEAKER_ROWS,
  SAMPLE_SPEAKING_SERIES,
  SAMPLE_SUMMARY,
} from '@/lib/sample/sampleRecord';

/**
 * The landing hero's sample (redesign owner decision 20, design §3.1): a
 * miniature of the real Record, built from the same chart and ledger
 * mechanics, with three numbered callouts pointing at what makes it a
 * record rather than a list. The data is fictional and says so.
 *
 * The callouts are a visible ①②③ beside the part they name and a numbered
 * list underneath that says it in words; the markers themselves are hidden
 * from a screen reader, which reads the list instead.
 */

/*
 * The same fictional record as /sample (lib/sample/sampleRecord.ts), so the
 * landing preview and the sample page show one person, not two (owner
 * review 2026-10-29). Three rows picked to carry the callouts: a source
 * link, a title in gold, and a team rank.
 */
const PICK = [
  'World Universities Debating Championship 2025',
  'Hart House IV 2025',
  'Oxford IV 2024',
];
const ROWS = PICK.map((name) => {
  const r = SAMPLE_SPEAKER_ROWS.find((x) => x.tournamentName === name);
  if (!r) throw new Error(`sample row missing: ${name}`);
  return {
    name: r.tournamentName.replace(' Debating Championship', ''),
    host: new URL(r.sourceUrl).host,
    rank: `${r.teamRank}/${r.totalTeams}`,
    result: r.broke
      ? r.wonTournament
        ? 'Champion'
        : formatStageForDisplay(r.eliminationReached)
      : null,
  };
});

function Marker({ n }: { n: 1 | 2 | 3 }) {
  return (
    <span
      aria-hidden
      className="ml-hair inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-[0.625rem] font-semibold text-primary-foreground"
    >
      {n}
    </span>
  );
}

export function AnnotatedSample() {
  return (
    <figure className="min-w-0 space-y-tight" aria-labelledby="sample-caption">
      <div className="panel min-w-0 overflow-hidden shadow-md">
        <div className="flex flex-col gap-hair border-b border-border px-stack py-tight sm:flex-row sm:items-baseline sm:justify-between sm:gap-stack">
          <div>
            <div className="data-label">Sample record · fictional</div>
            <div className="mt-hair font-display text-h4 font-medium text-ink">{SAMPLE_NAME}</div>
          </div>
          <div className="font-mono text-caption text-ink-soft">
            {SAMPLE_SUMMARY.tournamentsSpoken} spoken · {SAMPLE_SUMMARY.speakingBreaks} broke
          </div>
        </div>

        <div className="p-tight">
          <CareerChart
            kind="speaking"
            title="Speaking, by year"
            series={SAMPLE_SPEAKING_SERIES}
            compact
          />
        </div>

        <table className="ledger w-full text-caption">
          <caption className="sr-only">
            Three sample tournaments with team rank, result and source
          </caption>
          <thead>
            <tr>
              <th scope="col" className="pl-stack">
                Tournament
              </th>
              <th scope="col" className="text-right">
                <span className="inline-flex items-center">
                  {/* "Team rank" in mono caps squeezed the names to three
                      lines on a phone; note 3 says whose rank it is. */}
                  <span className="sm:hidden">Rank</span>
                  <span className="max-sm:hidden">Team rank</span>
                  <Marker n={3} />
                </span>
              </th>
              <th scope="col">Result</th>
              <th scope="col" className="pr-stack max-sm:hidden">
                Source
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r, i) => (
              <tr key={r.name}>
                <td className="pl-stack font-medium text-ink">
                  <span className="inline-flex items-center">
                    {r.name}
                    {i === 0 ? <Marker n={1} /> : null}
                  </span>
                </td>
                <td className="cell-num">{r.rank}</td>
                <td className="whitespace-nowrap">
                  {r.result ? (
                    <span className="inline-flex items-center">
                      <Badge variant="gold">{r.result}</Badge>
                      {i === 1 ? <Marker n={2} /> : null}
                    </span>
                  ) : (
                    <span className="text-ink-soft">Did not break</span>
                  )}
                </td>
                <td className="whitespace-nowrap pr-stack font-mono text-ink-soft max-sm:hidden">
                  <span className="inline-flex items-center gap-hair">
                    {r.host}
                    <ArrowSquareOut className="h-3 w-3" aria-hidden />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <figcaption id="sample-caption" className="sr-only">
        A sample debate record
      </figcaption>
      <ol className="grid gap-inline text-caption text-ink-soft sm:grid-cols-3">
        {[
          'Every row links to the tab it was read from.',
          'A break is marked in gold, a title the same.',
          'Placement is your team’s, not the speaker tab’s.',
        ].map((text, i) => (
          <li key={text} className="flex items-start gap-inline">
            <span
              aria-hidden
              className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-[0.625rem] font-semibold text-primary-foreground"
            >
              {i + 1}
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
