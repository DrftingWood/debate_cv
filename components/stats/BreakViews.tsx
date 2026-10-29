/**
 * Break margin section of /cv/stats: how far above or below the Open break
 * line each tournament finished. Presentational only — the figures come from
 * lib/cv/breakMargin.ts, which also explains how the line is derived and
 * why some tournaments are left out.
 *
 * Tournament-level, so the page passes the speaker rows its partner filter
 * left and withholds the section under a seat filter.
 *
 * Formats are shown separately and never summed: BP margins are team points,
 * the two-team formats count wins. Colour on a margin means above / below
 * the line and is always backed by a printed sign; the outcome column says
 * the same thing in words.
 */

import type { CvSpeakerRow } from '@/lib/cv/buildCvData';
import {
  breakMargin,
  type ExclusionReason,
  type FormatMargins,
  type MarginEntry,
  type MarginOutcome,
  type MarginUnit,
} from '@/lib/cv/breakMargin';
import { formatAbbrev } from '@/lib/calicotab/format';
import { SectionHeader } from '@/components/ui/Card';
import { StatTile, StatRow } from '@/components/ui/StatTile';
import { Table, Th, Td, Tr, TableScroll } from '@/components/ui/DataTable';

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
/** Whole points stay whole; half points keep their decimal. */
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const signed = (n: number) => (n > 0 ? `+${num(n)}` : n < 0 ? `−${num(-n)}` : '0');
const unitWord = (unit: MarginUnit, n: number) =>
  unit === 'points' ? (Math.abs(n) === 1 ? 'point' : 'points') : Math.abs(n) === 1 ? 'win' : 'wins';

const OUTCOME_LABEL: Record<MarginOutcome, string> = {
  cleared: 'Broke',
  'on-the-line': 'Broke on the line',
  'missed-on-speaks': 'Level with the line, missed',
  'missed-by-one': 'Missed by one',
  missed: 'Missed',
};

const EXCLUSION_TEXT: Record<ExclusionReason, [one: string, many: string]> = {
  'no-open-break': ['has no Open break tab on record', 'have no Open break tab on record'],
  'unknown-format': ['has no known format', 'have no known format'],
  'no-team-standing': [
    'has no team-tab standing for your team',
    'have no team-tab standing for your team',
  ],
  'line-incomplete': [
    'has a breaking team missing from the team tab, so its line is unknown',
    'have a breaking team missing from the team tab, so their lines are unknown',
  ],
  'above-line-not-on-break': [
    'had your team above the line but not on the break (ineligible or declined)',
    'had your team above the line but not on the break (ineligible or declined)',
  ],
};

function marginClass(m: number) {
  return m > 0 ? 'val-pos' : m < 0 ? 'val-neg' : 'val-flat';
}

function EntryRow({ e, unit }: { e: MarginEntry; unit: MarginUnit }) {
  const sentence = `${e.tournamentName}: ${num(e.value)} ${unitWord(unit, e.value)} against a line of ${num(e.line)}, ${signed(e.margin)}`;
  return (
    <Tr>
      <Td rowHeader className="pl-4">
        <span className="block max-w-88 wrap-break-word">
          {e.tournamentName}
          {e.year != null && !e.tournamentName.includes(String(e.year)) ? ` (${e.year})` : ''}
        </span>
      </Td>
      <Td numeric>{num(e.value)}</Td>
      <Td numeric>{num(e.line)}</Td>
      <Td numeric>
        <span className={marginClass(e.margin)} title={sentence}>
          {signed(e.margin)}
        </span>
      </Td>
      <Td>
        {OUTCOME_LABEL[e.outcome]}
        {e.brokeElsewhere ? (
          <span className="text-ink-soft"> · broke in another category</span>
        ) : null}
      </Td>
      <Td numeric className="pr-4">
        {e.breakTeams}
      </Td>
    </Tr>
  );
}

function FormatBlock({ f }: { f: FormatMargins }) {
  const broke = f.cleared + f.onTheLine;
  const unitLabel = f.unit === 'points' ? 'team points' : 'wins';
  const one = f.unit === 'points' ? 'one point' : 'one win';
  return (
    <div className="space-y-3">
      <h3 className="data-label">
        <abbr title={f.format} className="no-underline">
          {formatAbbrev(f.format) ?? f.format}
        </abbr>
        {' · '}margins in {unitLabel}
      </h3>
      <StatRow columns={4}>
        <StatTile
          size="sm"
          label="Median margin"
          value={<span className={marginClass(f.medianMargin)}>{signed(f.medianMargin)}</span>}
          hint={`${unitLabel}, over ${plural(f.tournaments, 'tournament')}`}
        />
        <StatTile
          size="sm"
          label="Broke"
          value={`${broke} of ${f.tournaments}`}
          hint={
            f.onTheLine > 0
              ? `${f.onTheLine} level with the line, through on the tiebreak`
              : 'Open break'
          }
        />
        <StatTile
          size="sm"
          label={`Missed by ${one}`}
          value={f.missedByOne}
          hint={`of ${plural(f.tournaments - broke, 'miss', 'misses')}`}
        />
        <StatTile
          size="sm"
          label="Level, missed"
          value={f.missedOnSpeaks}
          hint="on the line, out on the tiebreak"
        />
      </StatRow>
      <div className="panel overflow-hidden">
        <TableScroll>
          <Table
            className="min-w-max"
            label={`Break margin, ${f.format}: your team against the Open break line`}
          >
            <thead>
              <tr>
                <Th className="pl-4">Tournament</Th>
                <Th numeric>Your team</Th>
                <Th numeric>Line</Th>
                <Th numeric>Margin</Th>
                <Th>Outcome</Th>
                <Th numeric className="pr-4">
                  Teams broke
                </Th>
              </tr>
            </thead>
            <tbody>
              {f.entries.map((e) => (
                <EntryRow key={e.tournamentId.toString()} e={e} unit={f.unit} />
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </div>
    </div>
  );
}

export function BreakMarginSection({ speakerRows }: { speakerRows: CvSpeakerRow[] }) {
  const m = breakMargin(speakerRows);
  if (!m || m.formats.length === 0) return null;
  const measured = m.formats.reduce((s, f) => s + f.tournaments, 0);
  const exclusions = (Object.entries(m.excludedByReason) as Array<[ExclusionReason, number]>)
    .filter(([, n]) => n > 0)
    .map(([reason, n]) => `${plural(n, 'tournament')} ${EXCLUSION_TEXT[reason][n === 1 ? 0 : 1]}`);

  return (
    <section id="break-margin" aria-label="Break margin" className="scroll-mt-24 space-y-4">
      <SectionHeader
        label="Break line"
        title="How far from the break"
        meta={`${measured} of ${plural(speakerRows.length, 'tournament')} measured`}
      />
      {m.formats.map((f) => (
        <FormatBlock key={f.format} f={f} />
      ))}
      <p className="text-caption text-ink-soft">
        The line is the lowest Open-breaking team's total (BP points, otherwise wins); teams level
        with it split on the tiebreak.
        {exclusions.length > 0 ? ` Left out: ${exclusions.join('; ')}.` : ''}
      </p>
    </section>
  );
}
