import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Lock, Share2, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { BrandMark } from '@/components/BrandMark';
import { SampleCvPreview } from '@/components/landing/SampleCvPreview';

export const metadata: Metadata = {
  title: 'Sample CV',
  description: 'A sample debate CV showing verified tournament rows, growth signals, and share controls.',
};

const rows = [
  { year: '2024', tournament: 'World Universities Debating Championship', role: 'Speaker', team: 'Maya / Lena', result: 'Octofinalist', avg: '73.8', source: 'Tabbycat private URL' },
  { year: '2024', tournament: 'Australs', role: 'Speaker', team: 'Maya / Anika', result: 'Open break', avg: '72.9', source: 'Imported link' },
  { year: '2023', tournament: 'Hart House IV', role: 'Speaker', team: 'Maya / Lena', result: 'Champion', avg: '74.2', source: 'Tabbycat private URL' },
  { year: '2023', tournament: 'Cambridge IV', role: 'Judge', team: '—', result: 'Open outround chair', avg: '—', source: 'Imported link' },
  { year: '2022', tournament: 'University Novice Championship', role: 'Speaker', team: 'Maya / Sam', result: 'Finalist', avg: '69.7', source: 'Tabbycat private URL' },
];

const quirks = [
  'Speaker average is up 2.8 points from the first parsed season.',
  'Breaks cluster in tournaments with seven or more preliminary rounds.',
  'Judging appears more often after the 2023 season.',
];

export default function SamplePage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-5 md:py-7">
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

      <main className="space-y-10 py-10 md:py-14">
        <section className="grid items-end gap-8 md:grid-cols-[0.8fr_1.2fr]">
          <div>
            <div className="eyebrow">Sample CV</div>
            <h1 className="mt-4 font-display text-h1 font-semibold leading-[1.03] tracking-tight text-record-ink md:text-display">
              A sample debate CV.
            </h1>
            <p className="mt-5 text-body leading-relaxed text-record-muted md:text-body-serif">
              Maya Rao is fictional; the structure is real. Tournaments, breaks, speaker
              scores, judging, and source links — the same rows your own record is
              built from.
            </p>
          </div>
          <SampleCvPreview compact />
        </section>

        <section className="record-panel overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-record-rule p-5 md:flex-row md:items-center md:justify-between md:p-6">
            <div>
              <div className="eyebrow">Maya Rao · University debate</div>
              <h2 className="mt-2 font-display text-h2 font-semibold tracking-tight text-record-ink">
                Verified record
              </h2>
            </div>
            <div className="flex flex-wrap gap-2 text-caption">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-record-green-soft px-3 py-1.5 font-medium text-record-green">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> 18 source links
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-record-rule px-3 py-1.5 font-medium text-record-muted">
                <Lock className="h-3.5 w-3.5" aria-hidden /> Private preview
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-record-rule px-3 py-1.5 font-medium text-record-muted">
                <Share2 className="h-3.5 w-3.5" aria-hidden /> Share disabled
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-table">
              <thead>
                <tr className="border-b border-record-rule bg-record-surface text-left">
                  {['Year', 'Tournament', 'Role', 'Team', 'Result', 'Avg', 'Source'].map((heading) => (
                    <th key={heading} className="px-4 py-3 data-label">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.year}-${row.tournament}`} className="border-b border-record-rule last:border-b-0">
                    <td className="px-4 py-3 font-mono text-record-muted">{row.year}</td>
                    <td className="px-4 py-3 font-semibold text-record-ink">{row.tournament}</td>
                    <td className="px-4 py-3 text-record-muted">{row.role}</td>
                    <td className="px-4 py-3 text-record-muted">{row.team}</td>
                    <td className="px-4 py-3 font-semibold text-break-gold">{row.result}</td>
                    <td className="px-4 py-3 font-mono text-record-ink">{row.avg}</td>
                    <td className="px-4 py-3 text-caption text-record-muted">{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
          <article className="record-panel p-5 md:p-6">
            <div className="flex items-center gap-2 font-display text-h4 font-semibold text-record-ink">
              <TrendingUp className="h-5 w-5 text-score-blue" aria-hidden /> Growth signals
            </div>
            <ul className="mt-4 space-y-3 text-ui leading-relaxed text-record-muted">
              {quirks.map((quirk) => (
                <li key={quirk} className="flex gap-3">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-score-blue" aria-hidden />
                  <span>{quirk}</span>
                </li>
              ))}
            </ul>
          </article>
          <article className="record-panel p-5 md:p-6">
            <div className="eyebrow">Share model</div>
            <h2 className="mt-2 font-display text-h3 font-semibold text-record-ink">Private first, public when ready.</h2>
            <p className="mt-3 text-ui leading-relaxed text-record-muted">
              Your record stays private while you inspect it and fix ambiguous matches.
              Publish a clean URL or export a PDF when another debater, society, or
              institution asks for receipts.
            </p>
          </article>
        </section>
      </main>
    </div>
  );
}
