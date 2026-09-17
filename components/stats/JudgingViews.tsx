/**
 * The judging sections of /cv/stats: the judging lens (chair rate by season,
 * outround depth, appointments, judge breaks) and speaking against judging
 * season by season. Presentational only — the figures come from
 * lib/cv/judgingLens.ts.
 *
 * Neither responds to the partner or seat filters. A judge has no partner and
 * no seat, so the page renders these from the unfiltered judge rows whatever
 * the filter bar says, and the section header says as much so a filtered page
 * does not look broken when these figures stay put.
 *
 * SeasonTrends already charts chaired rounds, events and outround tournaments
 * per season. Nothing here repeats those counts on their own; they appear only
 * as the denominators of the ratios this file adds.
 */

import type { CvJudgeRow, CvSpeakerRow } from '@/lib/cv/buildCvData';
import { judgingLens, speakingVsJudging, type JudgeLensRow } from '@/lib/cv/judgingLens';
import { SectionHeader } from '@/components/ui/Card';
import { StatTile, StatRow } from '@/components/ui/StatTile';
import { BarList } from '@/components/ui/BarList';
import { Table, Th, Td, Tr, Nil, TableScroll } from '@/components/ui/DataTable';

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const pct = (rate: number | null) => (rate == null ? null : `${Math.round(rate * 100)}%`);

const NOT_FILTERABLE = 'Judging has no partner or seat, so filters leave it unchanged';

// ── Judging lens ──────────────────────────────────────────────────────────

export function JudgingLensSection({ judgeRows }: { judgeRows: JudgeLensRow[] }) {
  if (judgeRows.length === 0) return null;
  const lens = judgingLens(judgeRows);
  const { chair, depth, appointments, breaks } = lens;

  const chairExclusions = [
    chair.unmeasured > 0
      ? `${plural(chair.unmeasured, 'tournament')} with no count of prelims judged`
      : null,
    chair.inconsistent > 0
      ? `${plural(chair.inconsistent, 'tournament')} recording more prelims chaired than judged`
      : null,
  ].filter(Boolean);

  return (
    <section id="judging-lens" aria-label="Judging lens" className="scroll-mt-24 space-y-3">
      <SectionHeader label="Judging" title="From the adjudication room" meta={NOT_FILTERABLE} />

      <StatRow columns={4}>
        <StatTile label="Tournaments judged" value={lens.tournaments} hint="every judged tournament on record" />
        {chair.overall.chairRate != null ? (
          <StatTile
            label="Chair rate"
            value={pct(chair.overall.chairRate)}
            hint={`${chair.overall.roundsChaired} of ${plural(chair.overall.roundsJudged, 'prelim')} judged · ${plural(chair.overall.measured, 'tournament')}`}
          />
        ) : chair.chairedWithoutCount.tournaments > 0 ? (
          // No tournament carries a judged-round count, so there is nothing to
          // divide by; a per-tournament chair count is the most the rows say.
          <StatTile
            label="Prelims chaired per tournament"
            value={(chair.chairedWithoutCount.rounds / chair.chairedWithoutCount.tournaments).toFixed(1)}
            hint={`${chair.chairedWithoutCount.rounds} chaired over ${plural(chair.chairedWithoutCount.tournaments, 'tournament')}; prelims judged not recorded`}
          />
        ) : (
          <StatTile label="Chair rate" value="—" hint="no prelim counts recorded" />
        )}
        <StatTile
          label="Judge breaks"
          value={breaks.broke}
          hint={`of ${plural(breaks.tournaments, 'tournament')}${breaks.rate != null ? ` · ${pct(breaks.rate)}` : ''}`}
        />
        <StatTile
          label="Outround chair"
          value={depth.chairedOutround}
          hint={`tournaments with an outround chair on record, of ${depth.withOutround} with an outround stage`}
        />
      </StatRow>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel overflow-hidden">
          <div className="data-label px-4 pt-4">Chair rate by season</div>
          <TableScroll className="mt-2">
            <Table className="min-w-max" label="Chair rate by season">
              <thead>
                <tr>
                  <Th className="pl-4">Season</Th>
                  <Th numeric title="Tournaments with a count of prelims judged, of those judged that season">
                    Events counted
                  </Th>
                  <Th numeric>Prelims judged</Th>
                  <Th numeric>Chaired</Th>
                  <Th numeric className="pr-4">
                    Chair rate
                  </Th>
                </tr>
              </thead>
              <tbody>
                {chair.seasons.map((s) => (
                  <Tr key={s.year}>
                    <Td className="pl-4 num">{s.year}</Td>
                    <Td numeric>
                      {s.measured === s.tournaments ? (
                        s.tournaments
                      ) : (
                        <span title={`${s.measured} of ${s.tournaments} carry a count of prelims judged`}>
                          {s.measured} of {s.tournaments}
                        </span>
                      )}
                    </Td>
                    <Td numeric>{s.measured > 0 ? s.roundsJudged : <Nil title="No count of prelims judged" />}</Td>
                    <Td numeric>{s.measured > 0 ? s.roundsChaired : <Nil title="No count of prelims judged" />}</Td>
                    <Td numeric className="pr-4">
                      {pct(s.chairRate) ?? <Nil title="No count of prelims judged" />}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
          <p className="px-4 pb-4 pt-2 text-caption text-ink-soft">
            Prelims chaired over prelims judged, where both are recorded. A missing chair count beside a
            judged-round count is read as none chaired, because that is how a zero is stored.
            {chairExclusions.length > 0 ? ` Left out: ${chairExclusions.join('; ')}.` : ''}
            {chair.undated > 0
              ? ` ${plural(chair.undated, 'undated tournament')} ${chair.undated === 1 ? 'counts' : 'count'} in the overall rate but no season.`
              : ''}
          </p>
        </div>

        <div className="panel p-4">
          <div className="data-label mb-3">Deepest outround judged, per tournament</div>
          <BarList
            labelWidth="11rem"
            items={depth.buckets.map((b) => ({
              label: b.label,
              value: b.tournaments,
              display: String(b.tournaments),
              detail: b.secondaryBracket > 0 ? `· ${b.secondaryBracket} in a secondary bracket` : undefined,
            }))}
          />
          <p className="mt-3 text-caption text-ink-soft">
            {plural(lens.tournaments, 'judged tournament')}, each counted once at the deepest round judged,
            chair or panel.
            {depth.secondaryBracket > 0
              ? ` ${depth.secondaryBracket} of those rounds ran in a secondary bracket (novice, ESL, junior and the like), which can rank above an open-bracket round judged at the same event.`
              : ''}
            {depth.buckets.some((b) => b.key === 'broke_unstaged')
              ? ' "Broke, stage not recorded" means the break is on record but the round is not.'
              : ''}
            {depth.buckets.some((b) => b.key === 'unrecognised')
              ? ' "Stage unrecognised" is an outround whose name the stage reader does not know, left unranked rather than guessed.'
              : ''}
          </p>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="data-label px-4 pt-4">Appointments</div>
        <TableScroll className="mt-2">
          <Table className="min-w-max" label="Judge breaks by appointment">
            <thead>
              <tr>
                <Th className="pl-4">Appointed as</Th>
                <Th numeric>Tournaments</Th>
                <Th numeric>Broke</Th>
                <Th numeric className="pr-4">
                  Break rate
                </Th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <Tr key={a.key}>
                  <Td className="pl-4 font-medium">{a.label}</Td>
                  <Td numeric>{a.tournaments}</Td>
                  <Td numeric>{a.broke}</Td>
                  <Td numeric className="pr-4">
                    <span title={`${a.broke} of ${plural(a.tournaments, 'tournament')}`}>
                      {pct(a.broke / a.tournaments)}
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
        <p className="px-4 pb-4 pt-2 text-caption text-ink-soft">
          As the tab's participant list records it
          {appointments.some((a) => a.key === 'unstated')
            ? '. "Not stated" covers tournaments whose list gave no appointment, including ones known only from the round pages.'
            : '.'}
        </p>
      </div>
    </section>
  );
}

// ── Speaking vs judging ──────────────────────────────────────────────────

const LEAN_LABEL = { judged: 'Judged', spoken: 'Spoke', even: 'Even' } as const;

export function SpeakingVsJudgingSection({
  speakerRows,
  judgeRows,
}: {
  speakerRows: Pick<CvSpeakerRow, 'year'>[];
  judgeRows: Pick<CvJudgeRow, 'year'>[];
}) {
  if (judgeRows.length === 0) return null;
  const balance = speakingVsJudging(speakerRows, judgeRows);
  const { seasons } = balance;
  if (seasons.length === 0) return null;
  const latest = seasons[seasons.length - 1]!.year;

  const headline =
    balance.turnedIn != null
      ? balance.turnedSeasons === 1
        ? `Judging overtook speaking in ${balance.turnedIn}, the latest season on record — one season so far.`
        : `Judging overtook speaking in ${balance.turnedIn} and has stayed ahead for ${balance.turnedSeasons} seasons, through ${latest}.`
      : balance.alwaysJudgedMore
        ? 'You judged at more tournaments than you spoke at in every season on record, so there was no turn.'
        : balance.judgedMoreSeasons === 0
          ? 'You spoke at least as often as you judged in every season on record.'
          : `No lasting turn: you judged more in ${balance.judgedMoreSeasons} of ${plural(seasons.length, 'season')}, but not in ${latest}.`;

  const undated = [
    balance.undatedSpoken > 0 ? plural(balance.undatedSpoken, 'spoken tournament') : null,
    balance.undatedJudged > 0 ? plural(balance.undatedJudged, 'judged tournament') : null,
  ].filter(Boolean);

  return (
    <section id="speaking-judging" aria-label="Speaking vs judging over time" className="scroll-mt-24 space-y-3">
      <SectionHeader label="Speaking vs judging" title="When the balance turned" meta={NOT_FILTERABLE} />
      <p className="text-body text-ink">{headline}</p>

      <div className="panel overflow-hidden">
        <TableScroll>
          <Table className="min-w-max" label="Tournaments spoken and judged by season">
            <thead>
              <tr>
                <Th className="pl-4">Season</Th>
                <Th numeric>Spoke at</Th>
                <Th numeric>Judged at</Th>
                <Th className="pr-4">More often</Th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((s) => (
                <Tr key={s.year}>
                  <Td className="pl-4 num">{s.year}</Td>
                  <Td numeric>{s.spoken}</Td>
                  <Td numeric>{s.judged}</Td>
                  <Td className="pr-4">
                    {LEAN_LABEL[s.lean]}
                    {balance.turnedIn === s.year ? <span className="ml-1.5 text-ink-soft">· turn</span> : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </div>
      <p className="text-caption text-ink-soft">
        Tournaments per season on each side; one you both spoke and judged at counts on both. The turn is
        the first season of the unbroken run, to the latest season, in which judging outnumbered speaking.
        Years with no tournaments neither break nor extend it.
        {undated.length > 0 ? ` Undated and left out: ${undated.join(' and ')}.` : ''}
      </p>
    </section>
  );
}
