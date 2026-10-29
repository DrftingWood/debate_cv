import type { CvJudgeRow, CvSpeakerRow, CvTaggedMotion } from '@/lib/cv/buildCvData';
import { judgingByFormat, judgingByTopic } from '@/lib/cv/judgingConditions';
import { topSpeakerFinishes } from '@/lib/cv/topSpeakerFinishes';
import { SectionHeader } from '@/components/ui/Card';
import { StatRow, StatTile } from '@/components/ui/StatTile';
import { BarList } from '@/components/ui/BarList';
import { Table, Th, Td, Tr, Nil, TableScroll } from '@/components/ui/DataTable';

/*
 * The Statistics sections the redesign's tab tree named and the long page
 * never had (owner decision 19, part 2): Speaking → Speaks → Top-10
 * finishes, and Judging → Conditions → By format and By motion topic.
 * Presentational; the figures come from lib/cv/topSpeakerFinishes.ts and
 * lib/cv/judgingConditions.ts.
 */

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const pct = (rate: number | null) => (rate == null ? null : `${Math.round(rate * 100)}%`);
const NOT_FILTERABLE = 'Not filtered';

/** Speaks → Top-10 finishes: the speaking chart's stars, as a list. */
export function TopFinishesSection({ speakerRows }: { speakerRows: CvSpeakerRow[] }) {
  const { finishes, tournaments } = topSpeakerFinishes(speakerRows);
  if (tournaments === 0) return null;
  return (
    <section id="top-finishes" aria-label="Top-10 finishes" className="space-y-3">
      <SectionHeader
        label="Speaker tab"
        title="Top-10 speaker finishes"
        meta={`${plural(finishes.length, 'tournament')} of ${tournaments} spoken`}
      />
      {finishes.length === 0 ? (
        <div className="panel-inset p-4 text-table text-ink-soft">
          No top-10 finish on an Open, ESL or EFL speaker tab yet.
        </div>
      ) : (
        <div className="panel max-w-3xl overflow-hidden">
          <TableScroll>
            <Table className="w-full" label="Top-10 speaker finishes">
              <thead>
                <tr>
                  <Th className="pl-4">Tournament</Th>
                  <Th numeric>Year</Th>
                  <Th className="pr-4">Finish</Th>
                </tr>
              </thead>
              <tbody>
                {finishes.map((f) => (
                  <Tr key={`${f.tournamentName}|${f.year}`}>
                    <Td className="pl-4 font-medium">
                      {f.tournamentName}
                      {f.major ? (
                        <>
                          <span className="ml-hair font-mono text-ink">◆</span>
                          <span className="sr-only"> (a major)</span>
                        </>
                      ) : null}
                    </Td>
                    <Td numeric className="text-ink-soft">
                      {f.year ?? <Nil />}
                    </Td>
                    <Td className="pr-4 font-mono">{f.detail}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </div>
      )}
    </section>
  );
}

/** Judging → Conditions → By format. */
export function JudgingFormatSection({ judgeRows }: { judgeRows: CvJudgeRow[] }) {
  const rows = judgingByFormat(judgeRows);
  if (rows.length === 0) return null;
  return (
    <section id="judging-format" aria-label="Judging by format" className="space-y-3">
      <SectionHeader label="Judging" title="By format" meta={NOT_FILTERABLE} />
      <div className="panel max-w-3xl overflow-hidden">
        <TableScroll>
          <Table className="w-full" label="Judging by format">
            <thead>
              <tr>
                <Th className="pl-4">Format</Th>
                <Th numeric>Tournaments</Th>
                <Th numeric title="A judged outround or the adjudicator break">
                  Broke
                </Th>
                <Th numeric>Prelims judged</Th>
                <Th numeric className="pr-4">
                  Chair rate
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.format}>
                  <Td className="pl-4 font-medium">{r.format}</Td>
                  <Td numeric>{r.tournaments}</Td>
                  <Td numeric>{r.broke}</Td>
                  <Td numeric>{r.roundsJudged > 0 ? r.roundsJudged : <Nil />}</Td>
                  <Td numeric className="pr-4">
                    {pct(r.chairRate) ?? <Nil title="No count of prelims judged" />}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </div>
    </section>
  );
}

/** Judging → Conditions → By motion topic: the prelim rounds you judged, by topic. */
export function JudgingTopicSection({
  judgeRows,
  motions,
}: {
  judgeRows: CvJudgeRow[];
  motions: CvTaggedMotion[];
}) {
  const { topics, roundsJudged, withTopic } = judgingByTopic(judgeRows, motions);
  if (roundsJudged === 0) return null;
  return (
    <section id="judging-topic" aria-label="Judging by motion topic" className="space-y-3">
      <SectionHeader
        label="Judging"
        title="By motion topic"
        meta={`${plural(withTopic, 'prelim')} with a topic, of ${roundsJudged} judged`}
      />
      {topics.length === 0 ? (
        <div className="panel-inset p-4 text-table text-ink-soft">
          None of the rounds you judged has a tagged motion topic yet.
        </div>
      ) : (
        <>
          <StatRow columns={2}>
            <StatTile
              label="Most judged topic"
              value={topics[0]?.topic ?? '—'}
              hint={topics[0] ? plural(topics[0].rounds, 'round') : undefined}
            />
            <StatTile label="Topics judged" value={topics.length} hint="with a tagged motion" />
          </StatRow>
          <div className="panel p-4">
            <BarList
              labelWidth="11rem"
              items={topics.map((t) => ({
                label: t.topic,
                value: t.rounds,
                display: String(t.rounds),
                detail: `· ${plural(t.tournaments, 'tournament')}`,
              }))}
            />
          </div>
        </>
      )}
    </section>
  );
}
