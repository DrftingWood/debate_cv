import { formatAbbrev } from '@/lib/calicotab/format';
import type { CvJudgeRow, CvSpeakerRow } from '@/lib/cv/buildCvData';
import { formatStageForDisplay } from '@/lib/cv/formatStage';
import { teamTabPlacement, formatTeamTabPlacement } from '@/lib/cv/teamPlacement';
import { hashRank } from '@/lib/cv/rankDisplay';
import { Badge } from '@/components/ui/Badge';
import { Table, Th, Td, Tr, Nil, TableScroll, Cols } from '@/components/ui/DataTable';
import { TournamentLink } from '@/components/TournamentCard';
import { SourceLink } from '@/components/YearGroups';
import {
  PublicBreakMarker,
  PublicJudgeCard,
  PublicSpeakerCard,
  fmtPublicLastOutround,
} from './PublicRecordCards';

/*
 * The public CV's two ledgers, one year's rows at a time (the year group
 * and its subtotal come from components/YearGroups.tsx, shared with /cv).
 * Moved out of page.tsx with the redesign's tabs (owner decision 18).
 *
 * Read-only by design: no report buttons, no round detail, no partner
 * list. The Year column the flat ledger needed is gone (the group says it)
 * and Source takes its place, the public tab's host with ↗ (decision 16).
 * A pro-am mark shows only when the owner switched it on (decision 17);
 * the page passes the tournament ids that carry one.
 *
 * The table is `w-full`, not `min-w-max`: sized to its widest content it
 * pushed the Result column (the most load-bearing fact on a credential) to
 * the panel's edge at 1280 px. The names wrap instead.
 */

// One set of widths per ledger, so every year's columns line up (as on /cv).
const PUBLIC_SPEAKING_WIDTHS = [
  undefined, // tournament
  '4.5rem', // format
  '20%', // team
  '6.5rem', // team rank
  '7rem', // spk-tab rank
  '5.5rem', // avg score
  '11.5rem', // result: "Final (Champion)" wrapped at 10rem
  '11.5rem', // source (hosts truncate)
];
const PUBLIC_JUDGING_WIDTHS = [
  undefined, // tournament
  '4.5rem', // format
  '7rem', // prelims chaired
  '7rem', // prelims judged
  '11rem', // last outround chaired
  '11rem', // last outround judged
  '13rem', // source
];

export function PublicSpeakingTable({
  rows,
  label,
  proAm,
}: {
  rows: CvSpeakerRow[];
  label: string;
  /** Tournament ids with a pro-am mark the owner chose to show. */
  proAm: ReadonlySet<string>;
}) {
  return (
    <>
      <div className="panel hidden overflow-hidden md:block">
        <TableScroll>
          <Table className="w-full min-w-[56rem] table-fixed" label={label}>
            <Cols widths={PUBLIC_SPEAKING_WIDTHS} />
            <thead>
              <tr>
                <Th className="pl-4">Tournament</Th>
                <Th>Format</Th>
                <Th>Team</Th>
                <Th numeric title="Where the team finished on the prelim team tab">
                  Team rank
                </Th>
                <Th
                  numeric
                  title="Open speaker-tab rank: an individual figure, not the team's placement"
                >
                  Spk-tab rank
                </Th>
                <Th numeric>Avg score</Th>
                <Th>Result</Th>
                <Th className="pr-4">Source</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.tournamentId.toString()}>
                  <Td className="pl-4">
                    <TournamentLink
                      name={r.tournamentName}
                      href={r.sourceUrl}
                      className="coarse:min-h-[44px]"
                    />
                  </Td>
                  <Td className="whitespace-nowrap text-ink-soft" title={r.format ?? undefined}>
                    {formatAbbrev(r.format) ?? <Nil />}
                  </Td>
                  <Td className="text-ink">
                    {r.teamName ? (
                      <span className="block max-w-48 wrap-break-word">{r.teamName}</span>
                    ) : (
                      <Nil />
                    )}
                    {proAm.has(r.tournamentId.toString()) ? <ProAmMark /> : null}
                  </Td>
                  <Td numeric className="whitespace-nowrap" title={teamPlacementTitle(r)}>
                    {r.teamRank != null ? (
                      <>
                        {hashRank(r.teamRank, r.teamRankTied)}
                        {r.totalTeams != null ? (
                          <span className="text-ink-soft">/{r.totalTeams}</span>
                        ) : null}
                      </>
                    ) : (
                      <Nil />
                    )}
                  </Td>
                  <Td numeric>
                    {r.speakerRankOpen != null ? (
                      hashRank(r.speakerRankOpen, r.speakerRankTied)
                    ) : (
                      <Nil />
                    )}
                  </Td>
                  <Td numeric>{r.speakerAvgScore ?? <Nil />}</Td>
                  <Td className="min-w-32">
                    {r.broke || fmtPublicLastOutround(r) ? (
                      <PublicBreakMarker r={r} />
                    ) : (
                      <span className="text-ink-soft">Did not break</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap pr-4">
                    <SourceLink href={r.sourceUrl} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </div>

      <ul className="space-y-3 md:hidden" aria-label={label}>
        {rows.map((r) => (
          <PublicSpeakerCard
            key={r.tournamentId.toString()}
            r={r}
            proAm={proAm.has(r.tournamentId.toString())}
          />
        ))}
      </ul>
    </>
  );
}

export function PublicJudgingTable({ rows, label }: { rows: CvJudgeRow[]; label: string }) {
  return (
    <>
      <div className="panel hidden overflow-hidden md:block">
        <TableScroll>
          <Table className="w-full min-w-[56rem] table-fixed" label={label}>
            <Cols widths={PUBLIC_JUDGING_WIDTHS} />
            <thead>
              <tr>
                <Th className="pl-4">Tournament</Th>
                <Th>Format</Th>
                <Th numeric>Prelims chaired</Th>
                <Th numeric>Prelims judged</Th>
                <Th title="Last outround chaired">Last chaired</Th>
                <Th title="Last outround judged">Last judged</Th>
                <Th className="pr-4">Source</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.tournamentId.toString()}>
                  <Td className="pl-4">
                    <TournamentLink
                      name={r.tournamentName}
                      href={r.sourceUrl}
                      className="coarse:min-h-[44px]"
                    />
                  </Td>
                  <Td className="whitespace-nowrap text-ink-soft" title={r.format ?? undefined}>
                    {formatAbbrev(r.format) ?? <Nil />}
                  </Td>
                  <Td numeric>{r.inroundsChaired ?? <Nil />}</Td>
                  <Td numeric>{r.inroundsJudged ?? <Nil />}</Td>
                  <Td>{formatStageForDisplay(r.lastOutroundChaired) || <Nil />}</Td>
                  <Td>{formatStageForDisplay(r.lastOutroundJudged) || <Nil />}</Td>
                  <Td className="whitespace-nowrap pr-4">
                    <SourceLink href={r.sourceUrl} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </div>

      <ul className="space-y-3 md:hidden" aria-label={label}>
        {rows.map((r) => (
          <PublicJudgeCard key={r.tournamentId.toString()} r={r} />
        ))}
      </ul>
    </>
  );
}

/** The owner's pro-am mark, in words as well as the badge (never colour alone). */
function ProAmMark() {
  return (
    <Badge variant="outline" className="mt-hair">
      Pro-am
    </Badge>
  );
}

function teamPlacementTitle(r: CvSpeakerRow): string | undefined {
  const p = teamTabPlacement(r.teamRank, r.totalTeams);
  return p ? formatTeamTabPlacement(p, r.teamRankTied) : undefined;
}
