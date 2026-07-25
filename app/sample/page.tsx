import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Lock, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { BrandMark } from '@/components/BrandMark';
import { SampleCvPreview } from '@/components/landing/SampleCvPreview';
import { StatTile, StatRow } from '@/components/ui/StatTile';
import { SectionHeader } from '@/components/ui/Card';
import { Meter, BarList } from '@/components/ui/BarList';
import { TrendChart } from '@/components/ui/TrendChart';

export const metadata: Metadata = {
  title: 'Sample CV',
  description:
    'A sample debate CV showing the round ledger, motions, field placement and statistics.',
};

const rows = [
  { year: '2024', tournament: 'World Universities Debating Championship', role: 'Speaker', team: 'Maya / Lena', result: 'Octofinals', avg: '73.8', field: '18/412' },
  { year: '2024', tournament: 'Australs', role: 'Speaker', team: 'Maya / Anika', result: 'Open break', avg: '72.9', field: '31/188' },
  { year: '2023', tournament: 'Hart House IV', role: 'Speaker', team: 'Maya / Lena', result: 'Champion', avg: '74.2', field: '4/96' },
  { year: '2023', tournament: 'Cambridge IV', role: 'Judge', team: '—', result: 'Outround chair', avg: '—', field: '—' },
  { year: '2022', tournament: 'University Novice Championship', role: 'Speaker', team: 'Maya / Sam', result: 'Finals', avg: '69.7', field: '9/74' },
];

const roundLedger = [
  { round: 'R1', side: 'OG', motion: 'THW abolish selective state schooling.', score: '73.5', result: 'Won' },
  { round: 'R2', side: 'CO', motion: 'THBT the feminist movement should abandon the language of choice.', score: '71.0', result: 'Lost' },
  { round: 'R3', side: 'OO', motion: 'THS the rise of regional trade blocs at the expense of global institutions.', score: '74.0', result: 'Won' },
  { round: 'R4', side: 'CG', motion: 'THW require all political advertising to be state-funded.', score: '75.5', result: 'Won' },
];

const findings = [
  {
    text: 'You finish stronger than you start: your last three prelims average 1.4 more than your first three.',
    basis: '7 tournaments with six or more scored rounds',
  },
  {
    text: 'CG is your weakest seat at 41%, against a 53% overall round win rate.',
    basis: '22 decided rounds in CG',
  },
  {
    text: 'Half of your speeches land within 2.1 points, between 72.4 and 74.5.',
    basis: '156 scored speeches',
  },
];

const trend = [
  { label: '2022', value: 71.1 },
  { label: '2023', value: 72.6 },
  { label: '2024', value: 73.9 },
  { label: '2025', value: 74.6 },
];

export default function SamplePage() {
  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-5 py-5 md:py-6">
      <header className="flex items-center justify-between gap-4">
        <Link href="/" aria-label="debate cv home">
          <BrandMark />
        </Link>
        <Link href="/">
          <Button variant="primary" rightIcon={<ArrowRight className="h-4 w-4" aria-hidden />}>
            Build my CV
          </Button>
        </Link>
      </header>

      <div className="space-y-10 py-10 md:py-12">
        {/* grid-cols-[minmax(0,1fr)] on the BASE breakpoint, not just md.
            An unspecified single-column grid track is auto-sized, so it grew
            to the 820px min-width of the ledger inside and min-w-0 on the item
            could not help — the track, not the item, was the constraint. */}
        <section className="grid grid-cols-[minmax(0,1fr)] items-end gap-8 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div>
            <div className="eyebrow">Sample record</div>
            <h1 className="mt-4 font-display text-h1 font-medium leading-[1.04] tracking-tight text-ink md:text-display">
              This is the artifact, before you sign in
            </h1>
            <p className="mt-5 text-body leading-relaxed text-ink-soft">
              Fictional data, real structure: the round ledger with motions, placement against
              the field, the statistics page, and the sharing controls. Nothing below is a
              mockup of a feature that does not exist.
            </p>
          </div>
          <SampleCvPreview compact />
        </section>

        {/* Record */}
        <section className="space-y-3">
          <SectionHeader
            label="Record"
            title="Maya Rao — verified rows"
            meta={
              <span className="inline-flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" aria-hidden /> Private preview
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Share2 className="h-3.5 w-3.5" aria-hidden /> Share disabled
                </span>
              </span>
            }
          />
          <div className="panel min-w-0 overflow-hidden">
            <div className="w-full overflow-x-auto">
              <table className="ledger min-w-[820px] text-table">
                <caption className="sr-only">Sample speaking record by tournament</caption>
                <thead>
                  <tr>
                    <th scope="col" className="pl-4">Tournament</th>
                    <th scope="col" className="text-right">Year</th>
                    <th>Role</th>
                    <th>Team</th>
                    <th scope="col" className="text-right">Spk avg</th>
                    <th scope="col" className="text-right">On the tab</th>
                    <th scope="col" className="pr-4">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.year}-${row.tournament}`}>
                      <td className="pl-4 font-medium text-ink">{row.tournament}</td>
                      <td className="cell-num text-ink-soft">{row.year}</td>
                      <td className="text-ink-soft">{row.role}</td>
                      <td className="text-ink-soft">{row.team}</td>
                      <td className="cell-num">{row.avg}</td>
                      <td className="cell-num text-ink-soft">{row.field}</td>
                      <td className="whitespace-nowrap pr-4">
                        {row.result === '—' ? (
                          <span className="text-ink-soft">—</span>
                        ) : row.role === 'Judge' ? (
                          <span className="text-ink">{row.result}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            <Badge variant="gold">Broke</Badge>
                            <span className="text-ink">{row.result}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Round ledger with motions */}
        <section className="space-y-3">
          <SectionHeader
            label="Round ledger"
            title="Australs 2024, round by round"
            meta="Motions come from the tournament's own motions tab"
          />
          <div className="panel min-w-0 overflow-hidden">
            <div className="w-full overflow-x-auto">
              <table className="ledger min-w-[720px] text-table">
                <caption className="sr-only">Sample round-by-round ledger with motions</caption>
                <thead>
                  <tr>
                    <th scope="col" className="pl-4">Round</th>
                    <th>Side</th>
                    <th>Motion</th>
                    <th scope="col" className="text-right">Score</th>
                    <th scope="col" className="pr-4">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {roundLedger.map((r) => (
                    <tr key={r.round}>
                      <td className="num pl-4">{r.round}</td>
                      <td className="text-ink-soft">{r.side}</td>
                      <td className="max-w-[30rem] text-ink-soft">{r.motion}</td>
                      <td className="cell-num">{r.score}</td>
                      <td className="pr-4">
                        <span className={r.result === 'Won' ? 'val-pos font-medium' : 'val-neg'}>
                          {r.result}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Statistics */}
        <section className="space-y-3">
          <SectionHeader label="Statistics" title="What the record implies" />
          <StatRow>
            <StatTile label="Career speaker average" value="74.2" hint="156 scored speeches" />
            <StatTile label="Consistency (σ)" value="1.86" hint="Lower means tighter clustering" />
            <StatTile label="Average tab placement" value="Top 8%" accent="blue" hint="23 tournaments" />
            <StatTile label="Break rate" value="39%" accent="gold" hint="9 of 23 entries" />
          </StatRow>

          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <div className="panel p-4">
              <div className="data-label mb-2">Speaker average by season</div>
              <TrendChart points={trend} baseline={73.1} baselineLabel="career average" />
            </div>
            <div className="panel space-y-4 p-4">
              <Meter label="Placement percentile" display="92nd" value={92} tone="blue" />
              <Meter label="Round win rate" display="53%" value={53} />
              <div className="border-t border-border pt-3">
                <div className="data-label mb-3">Team points per round</div>
                <BarList
                  labelWidth="5.5rem"
                  items={[
                    { label: '3 points', value: 44, display: '44 · 31%', tone: 'pos' },
                    { label: '2 points', value: 39, display: '39 · 28%' },
                    { label: '1 point', value: 33, display: '33 · 23%' },
                    { label: '0 points', value: 25, display: '25 · 18%', tone: 'neg' },
                  ]}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {findings.map((f) => (
              <article key={f.text} className="panel p-4">
                <p className="text-table text-ink">{f.text}</p>
                <p className="mt-2 data-label">{f.basis}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="panel p-5 md:p-6">
          <div className="eyebrow">Share model</div>
          <h2 className="mt-2 font-display text-h3 font-medium text-ink">
            Private first, public when ready
          </h2>
          <p className="mt-3 max-w-3xl text-ui leading-relaxed text-ink-soft">
            Inspect the record privately, fix ambiguous matches, then publish a clean URL or
            export a PDF when another debater, society or institution asks. Nothing is public
            until you switch it on, and switching it off takes the link down.
          </p>
          <div className="mt-5">
            <Link href="/">
              <Button variant="primary" rightIcon={<ArrowRight className="h-4 w-4" aria-hidden />}>
                Build my debate CV
              </Button>
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
