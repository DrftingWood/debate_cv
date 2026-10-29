import * as React from 'react';
import type {
  CvSpeakerRow as SpeakingTableRow,
  CvJudgeRow as JudgingTableRow,
  CvTaggedMotion,
  CvFieldStat,
} from '@/lib/cv/buildCvData';
import {
  formatStageForDisplay,
  formatBaseStageForDisplay,
  championTitle,
} from '@/lib/cv/formatStage';
import { formatAbbrev } from '@/lib/calicotab/format';
import { Badge } from '@/components/ui/Badge';
import { TableScroll, Table, Th, Td, Tr, Nil, Cols } from '@/components/ui/DataTable';
import { CvRowReportButton } from '@/components/CvRowReportButton';
import { RoundsToggle } from '@/components/RoundsToggle';
import { TournamentCard, type TournamentCardField } from '@/components/TournamentCard';
import { teamTabPlacement, formatTeamTabPlacement } from '@/lib/cv/teamPlacement';
import { hashRank } from '@/lib/cv/rankDisplay';
import { RoundLedger, roundCount } from '@/components/RoundLedger';
import type { RecordYear } from '@/lib/cv/periodTotal';
import { JudgingYears, SourceLink, SpeakingYears } from '@/components/YearGroups';

/*
 * The Record page's two ledgers, Speaking (the Ledger tab) and Judging (the
 * Adjudication tab), each grouped by calendar year (redesign, owner
 * decisions 14-16, 2026-10-29). They moved here from app/(app)/cv/page.tsx
 * when the page took its tabs, so the page is left with the header and the
 * layout.
 *
 * A year is a native <details>: its <summary> is the year's subtotal row,
 * so a folded year still reads as a line of the statement, and it works
 * without client JS. The print stylesheet forces every <details> open, so
 * paper and PDF carry every year. Its id (`y2025` for speaking, `j2025`
 * for judging) is what a career-chart bar links to; `OpenYearOnHash` opens
 * the year and switches to its tab when that link is followed.
 *
 * The Year column the flat ledger needed is gone (the group says it), and
 * a Source column takes its place: the tab host in mono with ↗, linking the
 * public tab page and never a private URL (owner decision 16).
 */

/**
 * Hover text for the team-rank cell: "3 of 40 teams · top 8%", the team's
 * placement against the team tab. Falls back to the bare rank when the field
 * size is unknown or inconsistent with it.
 */
function teamPlacementTitle(r: {
  teamRank: number | null;
  teamRankTied?: boolean;
  totalTeams: number | null;
}): string | undefined {
  const p = teamTabPlacement(r.teamRank, r.totalTeams);
  return p ? `${formatTeamTabPlacement(p, r.teamRankTied)} on the prelim team tab` : undefined;
}

// Pretty-print speaker rank columns: "#5 Open · #3 ESL"; a tied Open rank reads "#5=".
function fmtSpeakerRanks(r: {
  speakerRankOpen: number | null;
  speakerRankTied?: boolean;
  speakerRankEsl: number | null;
  speakerRankEfl: number | null;
}): string | null {
  const parts: string[] = [];
  if (r.speakerRankOpen != null)
    parts.push(`${hashRank(r.speakerRankOpen, r.speakerRankTied)} Open`);
  if (r.speakerRankEsl != null) parts.push(`#${r.speakerRankEsl} ESL`);
  if (r.speakerRankEfl != null) parts.push(`#${r.speakerRankEfl} EFL`);
  return parts.join(' · ') || null;
}

function fmtLastOutroundSpoken(r: SpeakingTableRow): string | null {
  // Show the actual outround stage (Quarterfinals, Semifinals, …) when we
  // have it. The break-tab rank lives in its own column; conflating "made
  // the break tab" with "spoke in an outround" misleads — a team can appear
  // on the break tab but lose in their first outround room. When the team
  // won the final, append "(Champion)" so winners read distinctly from
  // grand-finalists. EUDC dual-break: render the deepest outround per
  // category together, e.g. "Open: Octofinals · ESL: Grand Final".
  if (r.eliminationReachedByCategory && r.eliminationReachedByCategory.length > 1) {
    const joined = r.eliminationReachedByCategory
      .map((e) => `${e.category}: ${formatBaseStageForDisplay(e.stage)}`)
      .join(' · ');
    return r.wonTournament === true ? `${joined} (${championTitle(r.eliminationReached)})` : joined;
  }
  if (!r.eliminationReached) return null;
  const display = formatStageForDisplay(r.eliminationReached);
  if (r.wonTournament === true) return `${display} (${championTitle(r.eliminationReached)})`;
  return display;
}

function ReportCell({
  r,
  compact = false,
}: {
  r: { tournamentId: bigint; tournamentName: string; hasOpenReport: boolean };
  compact?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-1.5" data-print-hide="true">
      {/* Plain visible text, not a live region: the badge is a fact about
          the row present at load, not a status change (UX-19). */}
      {r.hasOpenReport ? <Badge variant="warning">Reported</Badge> : null}
      <CvRowReportButton
        tournamentId={r.tournamentId.toString()}
        tournamentName={r.tournamentName}
        iconOnly={compact}
      />
    </div>
  );
}

function SpeakingTable({
  rows,
  label,
  motionsByTournament,
  fieldByTournament,
}: {
  rows: SpeakingTableRow[];
  /** Accessible name of the table ("Speaking record, 2025"). */
  label: string;
  motionsByTournament: Map<string, CvTaggedMotion[]>;
  fieldByTournament: Map<string, CvFieldStat>;
}) {
  return (
    <>
      {/* Desktop ledger */}
      <div className="panel hidden overflow-hidden md:block">
        <TableScroll>
          <Table className="w-full min-w-[68rem] table-fixed" label={label}>
            <Cols widths={SPEAKING_WIDTHS} />
            <thead>
              <tr>
                <Th className="pr-0 pl-2">
                  <span className="sr-only">Rounds</span>
                </Th>
                <Th className="pl-1">Tournament</Th>
                <Th>Format</Th>
                <Th>Team</Th>
                <Th
                  numeric
                  title="Where the team finished on the prelim team tab, of how many teams"
                >
                  Team rank
                </Th>
                <Th numeric>Pts</Th>
                <Th numeric title="Average speaker score per prelim round spoken">
                  Spk avg
                </Th>
                <Th
                  numeric
                  title="Where that average placed among every speaker on the speaker tab — an individual figure, not the team's placement"
                >
                  Spk tab
                </Th>
                <Th title="Speaker rank within each break category. Open = main draw; ESL = English as Second Language; EFL = English as Foreign Language.">
                  Spk rank
                </Th>
                <Th>Result</Th>
                <Th>Source</Th>
                <Th className="pr-4">
                  <span className="sr-only">Report a problem</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const field = fieldByTournament.get(r.tournamentId.toString());
                const outround = fmtLastOutroundSpoken(r);
                const ranks = fmtSpeakerRanks(r);
                const rounds = roundCount(r);
                const roundsId = `rounds-${r.tournamentId.toString()}`;
                return (
                  <React.Fragment key={r.tournamentId.toString()}>
                    <Tr className="align-top">
                      <Td className="w-0 pr-0 pl-2">
                        {rounds > 0 ? (
                          <RoundsToggle
                            controls={roundsId}
                            tournamentName={r.tournamentName}
                            rounds={rounds}
                          />
                        ) : null}
                      </Td>
                      <Td className="pl-1">
                        <TournamentCell name={r.tournamentName} myName={r.myName} />
                      </Td>
                      <Td className="whitespace-nowrap text-ink-soft" title={r.format ?? undefined}>
                        {formatAbbrev(r.format) ?? <Nil />}
                      </Td>
                      {/*
                      Team and partner share one column, and the field size
                      rides on the rank ("#3/40") instead of a Teams column of
                      its own. Those two columns were the ledger's overflow
                      at 1280 px (CV-2), and both truncated their text behind
                      a hover-only title (UX-36). The cap sits on the inner
                      block because a table cell ignores max-width.
                    */}
                      <Td>
                        <div className="max-w-52 wrap-break-word">
                          {r.teamName ?? <Nil />}
                          {r.teammates.length ? (
                            <div className="text-caption text-ink-soft">
                              with {r.teammates.join(', ')}
                            </div>
                          ) : null}
                        </div>
                      </Td>
                      <Td numeric className="whitespace-nowrap">
                        {r.teamRank != null ? (
                          <span title={teamPlacementTitle(r)}>
                            {hashRank(r.teamRank, r.teamRankTied)}
                            {r.totalTeams != null ? (
                              <span className="text-ink-soft">/{r.totalTeams}</span>
                            ) : null}
                          </span>
                        ) : (
                          <Nil />
                        )}
                      </Td>
                      <Td numeric>
                        <TeamPoints r={r} />
                      </Td>
                      <Td
                        numeric
                        title={
                          r.speakerAvgScore && r.prelimsSpoken > 0
                            ? `Average across ${r.prelimsSpoken} prelim ${r.prelimsSpoken === 1 ? 'round' : 'rounds'}`
                            : undefined
                        }
                      >
                        {r.speakerAvgScore ?? <Nil />}
                      </Td>
                      <Td numeric className="text-ink-soft">
                        {field?.betterThanUser != null && field.speakerCount > 0 ? (
                          <span
                            title={`${field.betterThanUser + 1} of ${field.speakerCount} speakers on the speaker tab`}
                          >
                            {field.betterThanUser + 1}/{field.speakerCount}
                          </span>
                        ) : (
                          <Nil title="Speaker tab did not publish comparable totals" />
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">{ranks ?? <Nil />}</Td>
                      {/*
                      A "Broke" badge next to "Quarterfinals" says the same
                      thing twice — reaching an outround IS the break — and
                      the pair was the widest column on the ledger. The gold
                      badge is what carries the break visually, so the label
                      moves inside it instead of sitting beside it.
                    */}
                      <Td className="whitespace-nowrap">
                        {r.broke ? (
                          <Badge variant="gold">{outround ?? 'Broke'}</Badge>
                        ) : outround ? (
                          <span className="text-ink">{outround}</span>
                        ) : (
                          <Nil />
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">
                        <SourceLink href={r.sourceUrl} />
                      </Td>
                      <Td className="pr-4">
                        <ReportCell r={r} compact />
                      </Td>
                    </Tr>
                    {/*
                    The rounds get their own full-width row rather than living
                    inside the Tournament cell: nested in a cell, the long
                    motion column forces that column wide and blows the whole
                    ledger's geometry apart, on paper too. The row is hidden
                    until the caret at the start of the tournament's row opens
                    it; print shows it (data-rounds, globals.css).
                  */}
                    {rounds > 0 ? (
                      <tr
                        id={roundsId}
                        hidden
                        data-rounds="true"
                        className="border-b border-border"
                      >
                        <td colSpan={SPEAKING_COLUMNS} className="px-4 py-0">
                          <RoundLedger r={r} motionsByTournament={motionsByTournament} bare />
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
      </div>

      {/* Mobile: one panel per tournament. An eleven-column ledger cannot be
          squeezed onto a phone, so the same fields become a labelled grid. */}
      <ul className="space-y-3 md:hidden">
        {rows.map((r) => (
          <TournamentCard
            key={r.tournamentId.toString()}
            name={r.tournamentName}
            href={r.sourceUrl}
            year={r.year}
            result={breakResult(r.broke, fmtLastOutroundSpoken(r))}
            fields={speakerCardFields(r, fieldByTournament.get(r.tournamentId.toString()))}
          >
            <RoundLedger r={r} motionsByTournament={motionsByTournament} />
            <ReportCell r={r} />
          </TournamentCard>
        ))}
      </ul>
    </>
  );
}

function JudgingTable({ rows, label }: { rows: JudgingTableRow[]; label: string }) {
  return (
    <>
      <div className="panel hidden overflow-hidden md:block">
        <TableScroll>
          <Table className="w-full min-w-[68rem] table-fixed" label={label}>
            <Cols widths={JUDGING_WIDTHS} />
            <thead>
              <tr>
                <Th className="pl-4">Tournament</Th>
                <Th>Format</Th>
                <Th numeric>Teams</Th>
                <Th>Judge type</Th>
                <Th numeric>Judged</Th>
                <Th numeric>Chaired</Th>
                <Th>Last outround chaired</Th>
                <Th>Last outround judged</Th>
                <Th>Source</Th>
                <Th className="pr-4">
                  <span className="sr-only">Report a problem</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.tournamentId.toString()}>
                  <Td className="pl-4">
                    <TournamentCell name={r.tournamentName} myName={r.myName} />
                  </Td>
                  <Td className="whitespace-nowrap text-ink-soft" title={r.format ?? undefined}>
                    {formatAbbrev(r.format) ?? <Nil />}
                  </Td>
                  <Td numeric className="text-ink-soft">
                    {r.totalTeams ?? <Nil />}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-soft">{r.judgeTypeTag ?? <Nil />}</Td>
                  <Td numeric>{r.inroundsJudged ?? <Nil />}</Td>
                  <Td numeric>{r.inroundsChaired ?? <Nil />}</Td>
                  <Td className="whitespace-nowrap">
                    {formatStageForDisplay(r.lastOutroundChaired) || <Nil />}
                  </Td>
                  {/* The break is a fact about the judged rounds, so it sits
                      here, once; it used to sit under "last chaired" even on
                      rows with nothing chaired (owner review 2026-10-29). */}
                  <Td className="whitespace-nowrap">
                    {r.broke ? (
                      <span className="flex items-center gap-1.5">
                        <Badge variant="gold">Broke</Badge>
                        {formatStageForDisplay(r.lastOutroundJudged)}
                      </span>
                    ) : (
                      formatStageForDisplay(r.lastOutroundJudged) || <Nil />
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <SourceLink href={r.sourceUrl} />
                  </Td>
                  <Td className="pr-4">
                    <ReportCell r={r} compact />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </div>

      <ul className="space-y-3 md:hidden">
        {rows.map((r) => (
          <TournamentCard
            key={r.tournamentId.toString()}
            name={r.tournamentName}
            href={r.sourceUrl}
            year={r.year}
            result={r.broke ? <Badge variant="gold">Broke</Badge> : null}
            fields={judgeCardFields(r)}
          >
            <ReportCell r={r} />
          </TournamentCard>
        ))}
      </ul>
    </>
  );
}

const SPEAKING_COLUMNS = 12;

/*
 * One set of widths for every year's table, so the columns line up down the
 * page. Tournament takes what is left; Team gets a share; the figures are
 * fixed. The min-width keeps the fixed columns readable below xl, where the
 * table scrolls inside its panel instead of crushing them.
 */
const SPEAKING_WIDTHS = [
  '2.75rem', // round caret
  undefined, // tournament
  '4.5rem', // format
  '17%', // team
  '6.5rem', // team rank
  '5rem', // pts
  '5.5rem', // spk avg
  '5.5rem', // spk tab
  '7.5rem', // spk rank
  '9.5rem', // result
  '13rem', // source
  '3.25rem', // report
];
const JUDGING_WIDTHS = [
  undefined, // tournament
  '4.5rem', // format
  '4.5rem', // teams
  '8rem', // judge type
  '5rem', // judged
  '5rem', // chaired
  '11rem', // last outround chaired
  '11rem', // last outround judged
  '13rem', // source
  '3.25rem', // report
];

/**
 * The ledger's first column: the tournament, linked out to its tab, and the
 * name the tab printed for the user underneath. The name wraps inside a
 * 16rem block instead of truncating behind a hover title (UX-36).
 */
function TournamentCell({ name, myName }: { name: string; myName: string }) {
  // Plain text on the desktop ledger: the Source column is the row's one
  // link to its tab. Both used to link the same page (owner review
  // 2026-10-29). The phone cards, which have no Source column, keep it.
  return (
    <div className="max-w-[16rem]">
      <div className="wrap-break-word font-medium text-ink">{name}</div>
      <div className="text-caption text-ink-soft">{myName}</div>
    </div>
  );
}

/**
 * The result line on a speaking card. Reaching an outround is the break, so
 * the stage goes inside the gold badge rather than beside a second "Broke"
 * badge, exactly as the desktop Result column has it (CV-8).
 */
function breakResult(broke: boolean, outround: string | null): React.ReactNode {
  if (broke) return <Badge variant="gold">{outround ?? 'Broke'}</Badge>;
  return outround ? <span className="text-caption text-ink">{outround}</span> : null;
}

/** A speaking row's columns as labelled card fields, most telling first. */
function speakerCardFields(
  r: SpeakingTableRow,
  field: CvFieldStat | undefined,
): TournamentCardField[] {
  const ranks = fmtSpeakerRanks(r);
  const out: TournamentCardField[] = [];
  if (r.speakerAvgScore) out.push({ label: 'Speaker avg', value: r.speakerAvgScore, mono: true });
  if (field?.betterThanUser != null && field.speakerCount > 0) {
    out.push({
      label: 'Speaker tab',
      value: `${field.betterThanUser + 1} of ${field.speakerCount}`,
      mono: true,
    });
  }
  if (r.teamRank != null) {
    out.push({
      label: 'Team rank',
      value:
        r.totalTeams != null
          ? `${hashRank(r.teamRank, r.teamRankTied)} of ${r.totalTeams}`
          : hashRank(r.teamRank, r.teamRankTied),
      mono: true,
    });
  }
  if (r.teamPoints) out.push({ label: 'Team points', value: r.teamPoints, mono: true });
  if (ranks) out.push({ label: 'Speaker-tab rank', value: ranks });
  if (r.format) out.push({ label: 'Format', value: r.format });
  if (r.teamName) out.push({ label: 'Team', value: r.teamName });
  if (r.teammates.length) out.push({ label: 'Partner', value: r.teammates.join(', ') });
  return out;
}

function judgeCardFields(r: JudgingTableRow): TournamentCardField[] {
  const out: TournamentCardField[] = [];
  if (r.judgeTypeTag) out.push({ label: 'Judge type', value: r.judgeTypeTag });
  out.push({
    label: 'Inrounds judged',
    value: r.inroundsJudged != null ? String(r.inroundsJudged) : '—',
    mono: true,
  });
  out.push({
    label: 'Inrounds chaired',
    value: r.inroundsChaired != null ? String(r.inroundsChaired) : '—',
    mono: true,
  });
  if (r.format) out.push({ label: 'Format', value: r.format });
  if (r.lastOutroundChaired) {
    out.push({
      label: 'Last outround chaired',
      value: formatStageForDisplay(r.lastOutroundChaired),
    });
  }
  if (r.lastOutroundJudged) {
    out.push({ label: 'Last outround judged', value: formatStageForDisplay(r.lastOutroundJudged) });
  }
  return out;
}

/** The Ledger tab: speaking, year by year. */
export function SpeakingLedger({
  years,
  open,
  motionsByTournament,
  fieldByTournament,
}: {
  years: RecordYear[];
  open: Set<number>;
  motionsByTournament: Map<string, CvTaggedMotion[]>;
  fieldByTournament: Map<string, CvFieldStat>;
}) {
  return (
    <SpeakingYears
      years={years}
      open={open}
      table={(y, label) => (
        <SpeakingTable
          rows={y.speaking}
          label={label}
          motionsByTournament={motionsByTournament}
          fieldByTournament={fieldByTournament}
        />
      )}
    />
  );
}

/** The Adjudication tab: judging, year by year. */
export function JudgingLedger({ years, open }: { years: RecordYear[]; open: Set<number> }) {
  return (
    <JudgingYears
      years={years}
      open={open}
      table={(y, label) => <JudgingTable rows={y.judging} label={label} />}
    />
  );
}

/**
 * The Pts cell. Two-team tabs often publish the team's speaker-point total
 * in their "points" column ("1374.5"), which beside a BP team's 11 read as
 * one figure on two scales (owner review 2026-10-29). Team points are at
 * most 3 a round, so a larger figure is a speaker total and is not shown
 * as points; the wins count stands in when the tab has one.
 */
function TeamPoints({ r }: { r: SpeakingTableRow }) {
  const pts = r.teamPoints == null ? null : Number.parseFloat(r.teamPoints);
  const ceiling = 3 * (r.prelimRoundCount ?? 12);
  if (pts != null && Number.isFinite(pts) && pts <= ceiling) return <>{r.teamPoints}</>;
  if (r.teamWins != null) return <>{`${r.teamWins}W`}</>;
  return <Nil title="This tab's points column counts speaker points, not team points" />;
}
