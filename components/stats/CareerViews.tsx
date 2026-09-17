/**
 * Career-shaped sections of /cv/stats: the outround funnel and milestones &
 * records. Presentational only — the figures come from
 * lib/cv/outroundFunnel.ts and lib/cv/milestones.ts. Both are tournament-level,
 * so the page passes what its partner filter left and withholds these under a
 * seat filter; neither section knows about seats.
 *
 * Every figure prints its sample next to it, and neither section uses colour
 * to carry meaning: the funnel bars are decoration beside a printed count
 * (and hidden from assistive tech), never the only statement of it.
 */

import type { CvSpeakerRow } from '@/lib/cv/buildCvData';
import type { TournamentFact } from '@/lib/cv/statsFacts';
import { outroundFunnel } from '@/lib/cv/outroundFunnel';
import { milestones, type FirstMilestone, type RecordHolder } from '@/lib/cv/milestones';
import { SectionHeader } from '@/components/ui/Card';
import { StatTile, StatRow } from '@/components/ui/StatTile';
import { Table, Th, Td, Tr, Nil, TableScroll } from '@/components/ui/DataTable';

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const pct = (of: number, from: number) => `${Math.round((of / from) * 100)}%`;

// ── Outround funnel ───────────────────────────────────────────────────────

/** How each step reads as a sentence, for the cell's title and screen readers. */
const STEP_NOUN: Record<string, [from: string, to: string]> = {
  broke: ['tournaments', 'breaks'],
  quarterfinal: ['breaks of known depth', 'quarterfinals or deeper'],
  semifinal: ['quarterfinals or deeper', 'semifinals or deeper'],
  final: ['semifinals or deeper', 'finals'],
  won: ['finals with a recorded result', 'titles'],
};

const ROW_LABEL: Record<string, string> = {
  spoken: 'Tournaments spoken',
  broke: 'Broke',
  quarterfinal: 'Quarterfinal or deeper',
  semifinal: 'Semifinal or deeper',
  final: 'Final',
  won: 'Won',
};

export function OutroundFunnelSection({ tournaments }: { tournaments: TournamentFact[] }) {
  const funnel = outroundFunnel(tournaments);
  if (!funnel) return null;
  const [spoken, broke] = funnel.rungs;
  // A funnel of one full rung and five zeros says less than the Breaks
  // section already does; show it once there is at least one break.
  if (broke.count === 0) return null;

  return (
    <section id="funnel" aria-label="Outround funnel" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Outrounds"
        title="How far your breaks went"
        meta={`${plural(broke.count, 'break')} from ${plural(spoken.count, 'tournament')}`}
      />
      <div className="panel overflow-hidden">
        <TableScroll>
          <Table className="min-w-max" label="Outround funnel: tournaments reaching each stage">
            <thead>
              <tr>
                <Th className="pl-4">Stage</Th>
                <Th numeric>Tournaments</Th>
                <Th className="w-40">
                  <span className="sr-only">Share of tournaments, drawn as a bar</span>
                </Th>
                <Th numeric className="pr-4">From the stage above</Th>
              </tr>
            </thead>
            <tbody>
              {funnel.rungs.map((r) => {
                const [fromNoun, toNoun] = STEP_NOUN[r.key] ?? ['', ''];
                const sentence =
                  r.from != null && r.of != null && r.from > 0
                    ? `${r.of} of ${r.from} ${fromNoun} became ${toNoun}`
                    : undefined;
                return (
                  <Tr key={r.key}>
                    <Td className="pl-4 font-medium">
                      {ROW_LABEL[r.key]}
                    </Td>
                    <Td numeric>{r.count}</Td>
                    <Td aria-hidden="true">
                      <div className="h-2 w-40 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full rounded-full bg-break-gold"
                          style={{ width: `${(r.count / spoken.count) * 100}%` }}
                        />
                      </div>
                    </Td>
                    <Td numeric className="pr-4">
                      {sentence ? (
                        <span title={sentence}>
                          {r.of} of {r.from} · {pct(r.of!, r.from!)}
                          <span className="sr-only"> — {sentence}</span>
                        </span>
                      ) : (
                        <Nil title={r.from == null ? 'The first stage has nothing above it' : 'Nothing to compare'} />
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
      </div>
      <p className="text-caption text-ink-soft">
        Each stage counts tournaments that went at least that deep. The tab records the deepest round a
        team reached, not where its bracket began, so a small break that started at semifinals is
        counted at quarterfinals too. Partial rounds sit below their full stage, and category finals
        (ESL, novice) count as finals. A title counts as a final even where the stage label is missing.
        {funnel.unknownDepth > 0
          ? ` ${plural(funnel.unknownDepth, 'break')} with no readable stage ${funnel.unknownDepth === 1 ? 'counts' : 'count'} as broke but ${funnel.unknownDepth === 1 ? 'is' : 'are'} left out of the stages below.`
          : ''}
        {funnel.finalsUndecided > 0
          ? ` ${plural(funnel.finalsUndecided, 'final')} with no recorded result ${funnel.finalsUndecided === 1 ? 'is' : 'are'} left out of the title rate.`
          : ''}
      </p>
    </section>
  );
}

// ── Milestones & records ──────────────────────────────────────────────────

function holders(at: Array<RecordHolder & { round?: number }>): string {
  const one = (h: RecordHolder & { round?: number }) =>
    // Most tournament names already carry their year ("IITB 2023"); don't print it twice.
    `${h.tournament}${h.year != null && !h.tournament.includes(String(h.year)) ? ` (${h.year})` : ''}${h.round != null ? `, round ${h.round}` : ''}`;
  if (at.length <= 2) return at.map(one).join('; ');
  return `${one(at[0])} and ${at.length - 1} more`;
}

function FirstTile({ label, first, undated }: { label: string; first: FirstMilestone | null; undated: number }) {
  // Undated qualifiers can't be placed, but they exist: "none" would be false
  // on a record whose only titles came from tournaments with no year.
  const hint = first
    ? (first.tournament ?? `${first.count} tournaments that season — order within it isn't recorded`)
    : undated > 0
      ? `${undated} undated — no season to place ${undated === 1 ? 'it' : 'them'} in`
      : 'None among these tournaments';
  return <StatTile size="sm" label={label} value={first ? first.year : '—'} hint={hint} />;
}

/** A score as the tab printed it: whole points stay whole, half points keep their decimal. */
const score = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function MilestonesSection({ speakerRows }: { speakerRows: CvSpeakerRow[] }) {
  const m = milestones(speakerRows);
  if (!m) return null;
  const run = m.breakRun;

  return (
    <section id="milestones" aria-label="Milestones and records" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Milestones"
        title="Firsts and records"
        meta={plural(speakerRows.length, 'tournament')}
      />

      <StatRow columns={4}>
        <FirstTile label="First tournament" first={m.firstTournament} undated={m.undatedFirsts.tournament} />
        <FirstTile label="First break" first={m.firstBreak} undated={m.undatedFirsts.break} />
        <FirstTile label="First final" first={m.firstFinal} undated={m.undatedFirsts.final} />
        <FirstTile label="First title" first={m.firstTitle} undated={m.undatedFirsts.title} />
      </StatRow>

      <div className="panel overflow-hidden">
        <TableScroll>
          <Table className="min-w-max" label="Career records">
            <thead>
              <tr>
                <Th className="pl-4">Record</Th>
                <Th numeric>Figure</Th>
                <Th>Where</Th>
                <Th numeric className="pr-4">Out of</Th>
              </tr>
            </thead>
            <tbody>
              <Tr>
                <Td className="pl-4 font-medium">Best speech</Td>
                <Td numeric>{m.bestSpeech ? score(m.bestSpeech.score) : <Nil />}</Td>
                <Td>
                  {m.bestSpeech ? (
                    <span className="block max-w-[22rem] truncate" title={m.bestSpeech.at.map((h) => `${h.tournament}, round ${h.round}`).join('\n')}>
                      {holders(m.bestSpeech.at)}
                    </span>
                  ) : (
                    <Nil title="No scored prelim speeches" />
                  )}
                </Td>
                <Td numeric className="pr-4">{m.bestSpeech ? plural(m.bestSpeech.speeches, 'prelim speech', 'prelim speeches') : <Nil />}</Td>
              </Tr>
              <Tr>
                <Td className="pl-4 font-medium">Best speaker-tab rank</Td>
                <Td numeric>{m.bestSpeakerRank ? `#${m.bestSpeakerRank.rank}` : <Nil />}</Td>
                <Td>
                  {m.bestSpeakerRank ? (
                    <span className="block max-w-[22rem] truncate" title={m.bestSpeakerRank.at.map((h) => h.tournament).join('\n')}>
                      {holders(m.bestSpeakerRank.at)}
                    </span>
                  ) : (
                    <Nil />
                  )}
                </Td>
                <Td numeric className="pr-4">{m.bestSpeakerRank ? plural(m.bestSpeakerRank.of, 'ranked tab') : <Nil />}</Td>
              </Tr>
              <Tr>
                <Td className="pl-4 font-medium">Best team break rank</Td>
                <Td numeric>{m.bestBreakRank ? `#${m.bestBreakRank.rank}` : <Nil />}</Td>
                <Td>
                  {m.bestBreakRank ? (
                    <span className="block max-w-[22rem] truncate" title={m.bestBreakRank.at.map((h) => h.tournament).join('\n')}>
                      {holders(m.bestBreakRank.at)}
                    </span>
                  ) : (
                    <Nil title="No break with a published break rank" />
                  )}
                </Td>
                <Td numeric className="pr-4">{m.bestBreakRank ? plural(m.bestBreakRank.of, 'ranked break') : <Nil />}</Td>
              </Tr>
              <Tr>
                <Td className="pl-4 font-medium">Longest break run</Td>
                <Td numeric>
                  {!run ? (
                    <Nil title="No dated breaks" />
                  ) : run.certain === run.possible ? (
                    run.certain
                  ) : (
                    <span title={`At least ${run.certain} in a row under any order within a season; ${run.possible} if the order was favourable`}>
                      {run.certain}–{run.possible}
                    </span>
                  )}
                </Td>
                <Td>
                  {!run ? (
                    <Nil />
                  ) : run.certain === run.possible ? (
                    'consecutive tournaments broken'
                  ) : (
                    `at least ${run.certain} for certain, up to ${run.possible}`
                  )}
                </Td>
                <Td numeric className="pr-4">{run ? plural(run.dated, 'dated tournament') : <Nil />}</Td>
              </Tr>
            </tbody>
          </Table>
        </TableScroll>
      </div>

      <p className="text-caption text-ink-soft">
        Tournaments are ordered by season only — the tab doesn't say which tournament in a season came
        first. So a first is named only when it was the only one that season, and the break run shows a
        range when the order inside a season could change it: the run every possible order guarantees,
        and the longest any order allows. Best speech counts scored prelim speeches; ranks are open
        speaker-tab and team break ranks.
        {m.undated > 0
          ? ` ${plural(m.undated, 'undated tournament')} ${m.undated === 1 ? 'is' : 'are'} left out of firsts and the break run.`
          : ''}
      </p>
    </section>
  );
}
