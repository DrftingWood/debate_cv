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

import { cn } from '@/lib/utils/cn';
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

/** How a conversion reads as a sentence, for the cell's title and screen readers. */
const STEP_NOUN: Record<string, [from: string, to: string]> = {
  broke: ['tournaments', 'breaks'],
  won: ['open finals with a recorded result', 'titles'],
};

const ROW_LABEL: Record<string, string> = {
  spoken: 'Tournaments spoken',
  broke: 'Broke',
  quarterfinal: 'Open quarterfinal or deeper',
  semifinal: 'Open semifinal or deeper',
  final: 'Open final',
  won: 'Won the open final',
};

/** What "went out here" means on each row, for the cell's title. */
const WENT_OUT: Record<string, string> = {
  spoken: 'did not break',
  broke: 'went out in an open round before the quarterfinals',
  quarterfinal: 'went out in the open quarterfinal round (partial or full)',
  semifinal: 'went out in the open semifinal round (partial or full)',
  final: 'lost the open final',
};

export function OutroundFunnelSection({ tournaments }: { tournaments: TournamentFact[] }) {
  const funnel = outroundFunnel(tournaments);
  if (!funnel) return null;
  const [spoken, broke] = funnel.rungs;
  const { category, consolation } = funnel;
  // A funnel of one full rung and five zeros says less than the Breaks
  // section already does; show it once there is at least one break.
  if (broke.count === 0 && consolation.tournaments === 0) return null;

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
                <Th numeric title="Tournaments whose run ended at this stage">
                  Went out here
                </Th>
                <Th
                  numeric
                  className="pr-4"
                  title="Only where every tournament at the stage above had to play for this one"
                >
                  Rate
                </Th>
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
                    <Td className="pl-4 font-medium">{ROW_LABEL[r.key]}</Td>
                    <Td numeric>{r.count}</Td>
                    <Td>
                      <div
                        aria-hidden="true"
                        className="h-2 w-40 overflow-hidden rounded-full bg-surface-3"
                      >
                        <div
                          className={cn(
                            'h-full rounded-full',
                            // Gold means a break; the spoken row is the base
                            // every break is counted from, so it is grey.
                            r.key === 'spoken' ? 'bg-tier-none' : 'bg-break-gold',
                          )}
                          style={{ width: `${(r.count / spoken.count) * 100}%` }}
                        />
                      </div>
                    </Td>
                    <Td numeric>
                      {r.wentOut != null ? (
                        <span title={`${r.wentOut} ${WENT_OUT[r.key]}`}>
                          {r.wentOut}
                          <span className="sr-only"> {WENT_OUT[r.key]}</span>
                        </span>
                      ) : (
                        <Nil title="A title is not a place to go out" />
                      )}
                    </Td>
                    <Td numeric className="pr-4">
                      {sentence ? (
                        <span title={sentence}>
                          {r.of} of {r.from} · {pct(r.of!, r.from!)}
                          <span className="sr-only"> — {sentence}</span>
                        </span>
                      ) : (
                        <Nil
                          title={
                            r.from == null && r.key !== 'spoken'
                              ? 'Bracket size and byes put teams on this stage without a round played, so a rate would not measure winning'
                              : r.from == null
                                ? 'The first stage has nothing above it'
                                : 'Nothing to compare'
                          }
                        />
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
      </div>
      {category.breaks > 0 || consolation.tournaments > 0 ? (
        <p className="text-body text-ink">
          {category.breaks > 0
            ? `Also: ${plural(category.breaks, 'break')} in ${category.brackets.join(', ')} ${category.brackets.length === 1 ? 'bracket' : 'brackets'}, with ${plural(category.finals, 'final')} and ${plural(category.titles, 'title')} — counted under Broke, not in the open stages.`
            : ''}
          {category.breaks > 0 && consolation.tournaments > 0 ? ' ' : ''}
          {consolation.tournaments > 0
            ? `${plural(consolation.tournaments, 'tournament')} ended in a consolation bracket (${consolation.brackets.join(', ')}), which is not counted as a break.`
            : ''}
        </p>
      ) : null}
      {/* Only what this record left out; the counting method lives in
          lib/cv/outroundFunnel.ts (owner: show, don't tell). */}
      {funnel.unknownDepth > 0 || funnel.finalsUndecided > 0 ? (
        <p className="text-caption text-ink-soft">
          {funnel.unknownDepth > 0
            ? ` ${plural(funnel.unknownDepth, 'break')} with no readable stage ${funnel.unknownDepth === 1 ? 'counts' : 'count'} as broke but ${funnel.unknownDepth === 1 ? 'is' : 'are'} left out of the stages below.`
            : ''}
          {funnel.finalsUndecided > 0
            ? ` ${plural(funnel.finalsUndecided, 'final')} with no recorded result ${funnel.finalsUndecided === 1 ? 'is' : 'are'} left out of the title rate and the finals lost.`
            : ''}
        </p>
      ) : null}
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

function FirstTile({
  label,
  first,
  undated,
  also,
}: {
  label: string;
  first: FirstMilestone | null;
  undated: number;
  /** A sentence about other brackets, appended to the hint. */
  also?: string;
}) {
  // Undated qualifiers can't be placed, but they exist: "none" would be false
  // on a record whose only titles came from tournaments with no year. And
  // beside a dated first they could be earlier, so the tile says "earliest
  // dated" and names nobody rather than presenting a guess as the first.
  const base = !first
    ? undated > 0
      ? `${undated} undated — no season to place ${undated === 1 ? 'it' : 'them'} in`
      : 'None among these tournaments'
    : first.undated > 0
      ? `earliest dated season; ${first.undated} undated could be earlier`
      : (first.tournament ??
        `${first.count} tournaments that season — order within it isn't recorded`);
  const hint = also ? `${base} · ${also}` : base;
  return <StatTile size="sm" label={label} value={first ? first.year : '—'} hint={hint} />;
}

/** A score as the tab printed it: whole points stay whole, half points keep their decimal. */
const score = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function MilestonesSection({ speakerRows }: { speakerRows: CvSpeakerRow[] }) {
  const m = milestones(speakerRows);
  if (!m) return null;
  const run = m.breakRun;
  const other = m.otherBracket;
  const otherBrackets = other.brackets.join(' / ');
  const otherRank = m.bestBreakRankOtherBracket;

  return (
    <section id="milestones" aria-label="Milestones and records" className="scroll-mt-24 space-y-3">
      <SectionHeader
        label="Milestones"
        title="Firsts and records"
        meta={plural(speakerRows.length, 'tournament')}
      />

      <StatRow columns={4}>
        <FirstTile
          label="First tournament"
          first={m.firstTournament}
          undated={m.undatedFirsts.tournament}
        />
        <FirstTile label="First break" first={m.firstBreak} undated={m.undatedFirsts.break} />
        <FirstTile
          label="First open final"
          first={m.firstFinal}
          undated={m.undatedFirsts.final}
          also={
            other.finals > 0
              ? `also ${plural(other.finals, 'final')} in ${otherBrackets}`
              : undefined
          }
        />
        <FirstTile
          label="First open title"
          first={m.firstTitle}
          undated={m.undatedFirsts.title}
          also={
            other.titles > 0
              ? `also ${plural(other.titles, 'title')} in ${otherBrackets}`
              : undefined
          }
        />
      </StatRow>

      <div className="panel overflow-hidden">
        <TableScroll>
          <Table className="min-w-max" label="Career records">
            <thead>
              <tr>
                <Th className="pl-4">Record</Th>
                <Th numeric>Figure</Th>
                <Th>Where</Th>
                <Th numeric className="pr-4">
                  Out of
                </Th>
              </tr>
            </thead>
            <tbody>
              <Tr>
                <Td rowHeader className="pl-4 font-medium">
                  Best speech
                </Td>
                <Td numeric>{m.bestSpeech ? score(m.bestSpeech.score) : <Nil />}</Td>
                <Td>
                  {m.bestSpeech ? (
                    <span className="block max-w-88 wrap-break-word">
                      {holders(m.bestSpeech.at)}
                    </span>
                  ) : (
                    <Nil title="No scored prelim speeches" />
                  )}
                </Td>
                <Td numeric className="pr-4">
                  {m.bestSpeech ? (
                    plural(m.bestSpeech.speeches, 'prelim speech', 'prelim speeches')
                  ) : (
                    <Nil />
                  )}
                </Td>
              </Tr>
              <Tr>
                <Td rowHeader className="pl-4 font-medium">
                  Best team-tab rank
                </Td>
                <Td numeric>{m.bestTeamRank ? `#${m.bestTeamRank.rank}` : <Nil />}</Td>
                <Td>
                  {m.bestTeamRank ? (
                    <span className="block max-w-88 wrap-break-word">
                      {holders(m.bestTeamRank.at)}
                    </span>
                  ) : (
                    <Nil title="No published team tab" />
                  )}
                </Td>
                <Td numeric className="pr-4">
                  {m.bestTeamRank ? plural(m.bestTeamRank.of, 'team tab') : <Nil />}
                </Td>
              </Tr>
              <Tr>
                <Td rowHeader className="pl-4 font-medium">
                  Best speaker-tab rank
                </Td>
                <Td numeric>{m.bestSpeakerRank ? `#${m.bestSpeakerRank.rank}` : <Nil />}</Td>
                <Td>
                  {m.bestSpeakerRank ? (
                    <span className="block max-w-88 wrap-break-word">
                      {holders(m.bestSpeakerRank.at)}
                    </span>
                  ) : (
                    <Nil />
                  )}
                </Td>
                <Td numeric className="pr-4">
                  {m.bestSpeakerRank ? plural(m.bestSpeakerRank.of, 'ranked tab') : <Nil />}
                </Td>
              </Tr>
              <Tr>
                <Td rowHeader className="pl-4 font-medium">
                  Best open break rank
                </Td>
                <Td numeric>{m.bestBreakRank ? `#${m.bestBreakRank.rank}` : <Nil />}</Td>
                <Td>
                  {m.bestBreakRank ? (
                    <span className="block max-w-88 wrap-break-word">
                      {holders(m.bestBreakRank.at)}
                    </span>
                  ) : (
                    <Nil title="No open break with a published break rank" />
                  )}
                </Td>
                <Td numeric className="pr-4">
                  {m.bestBreakRank ? plural(m.bestBreakRank.of, 'ranked open break') : <Nil />}
                </Td>
              </Tr>
              {otherRank ? (
                <Tr>
                  <Td rowHeader className="pl-4 font-medium">
                    Best category break rank
                  </Td>
                  <Td numeric>#{otherRank.rank}</Td>
                  <Td>
                    <span className="block max-w-88 wrap-break-word">{holders(otherRank.at)}</span>
                  </Td>
                  <Td numeric className="pr-4">
                    {plural(otherRank.of, 'ranked category break')}
                  </Td>
                </Tr>
              ) : null}
              <Tr>
                <Td rowHeader className="pl-4 font-medium">
                  Longest break run
                </Td>
                <Td numeric>
                  {!run ? (
                    <Nil title="No dated breaks" />
                  ) : run.certain === run.possible ? (
                    run.certain
                  ) : (
                    <span
                      title={`At least ${run.certain} in a row under any order within a season; ${run.possible} if the order was favourable`}
                    >
                      {run.certain}–{run.possible}
                    </span>
                  )}
                </Td>
                <Td>
                  {!run ? (
                    <Nil />
                  ) : run.certain === run.possible ? (
                    'consecutive dated tournaments broken'
                  ) : (
                    `among dated tournaments: at least ${run.certain} under any order, up to ${run.possible}`
                  )}
                </Td>
                <Td numeric className="pr-4">
                  {run ? plural(run.dated, 'dated tournament') : <Nil />}
                </Td>
              </Tr>
            </tbody>
          </Table>
        </TableScroll>
      </div>

      {/* Only what this record left out; the ordering and bracket rules live
          in lib/cv/milestones.ts (owner: show, don't tell). */}
      {(m.bestSpeech && m.bestSpeech.unbounded > 0) || m.undated > 0 ? (
        <p className="text-caption text-ink-soft">
          {m.bestSpeech && m.bestSpeech.unbounded > 0
            ? `${plural(m.bestSpeech.unbounded, 'speech', 'speeches')} ${m.bestSpeech.unbounded === 1 ? 'comes' : 'come'} from tabs with no prelim count, so an outround score may be among them. `
            : ''}
          {m.undated > 0
            ? `${plural(m.undated, 'undated tournament')} ${m.undated === 1 ? 'is' : 'are'} left out of firsts and the break run.`
            : ''}
        </p>
      ) : null}
    </section>
  );
}
