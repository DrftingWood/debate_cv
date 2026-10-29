import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { ShieldCheck } from '@/components/ui/icons';
import { Tabs } from '@/components/ui/Tabs';
import { BuildCvButton } from '@/components/landing/BuildCvButton';
import { PublicHeader } from '@/components/landing/PublicHeader';
import { Footer } from '@/components/Footer';
import { OpenYearOnHash } from '@/components/OpenYearOnHash';
import { PublicHighlights } from '@/components/PublicHighlights';
import { RecordHeader } from '@/components/RecordHeader';
import { JudgingYears, SpeakingYears } from '@/components/YearGroups';
import { PublicJudgingTable, PublicSpeakingTable } from '@/app/u/[slug]/PublicLedger';
import { openYears, recordYears } from '@/lib/cv/periodTotal';
import { publicHighlights } from '@/lib/cv/publicHighlights';
import {
  SAMPLE_JUDGE_ROWS,
  SAMPLE_NAME,
  SAMPLE_SPEAKER_ROWS,
  SAMPLE_SUMMARY,
} from '@/lib/sample/sampleRecord';

export const metadata: Metadata = {
  title: 'Sample CV',
  description:
    'A sample debate CV: the career charts, highlights and the year-by-year ledger, on fictional data.',
};

/**
 * /sample: what a shared debate CV looks like, before signing in.
 *
 * It renders the one fictional record (lib/sample/sampleRecord.ts, shared
 * with the landing hero) through the same components as a real public CV:
 * the header and career charts, the two-list highlights, and the Ledger and
 * Adjudication tabs grouped by year. It used to draw the pre-redesign
 * Record by hand, with a seasons chart and "Won/Lost" on BP rounds, so a
 * visitor saw a different product from the one they would get (owner
 * review 2026-10-29). Built from the real components, it cannot drift.
 */
export default async function SamplePage() {
  const session = await auth();
  const years = recordYears(SAMPLE_SPEAKER_ROWS, SAMPLE_JUDGE_ROWS);
  // A fixed "now", so the sample opens the same years for every visitor.
  const now = new Date('2026-06-01');
  const openSpeaking = openYears(
    years.filter((y) => y.speakingTotal),
    now,
  );
  const openJudging = openYears(
    years.filter((y) => y.judgingTotal),
    now,
  );
  const lists = publicHighlights(SAMPLE_SPEAKER_ROWS, SAMPLE_JUDGE_ROWS);
  const none = new Set<string>();
  const total = SAMPLE_SUMMARY.tournamentsSpoken + SAMPLE_SUMMARY.tournamentsJudged;

  return (
    <>
      <div className="mx-auto w-full max-w-wide flex-1 px-5">
        <PublicHeader signedIn={!!session?.user} />
        <main id="main" className="space-y-group pb-page">
          <header className="border-b border-border pb-panel pt-panel">
            <div className="eyebrow">Sample record · fictional</div>
            <h1 className="mt-tight font-display text-h1 font-medium tracking-tight text-ink">
              {SAMPLE_NAME}
            </h1>
            <p className="mt-inline max-w-2xl text-body leading-relaxed text-ink-soft">
              This is what a shared debate CV looks like: {total} tournaments, each linked to its
              tab. The person and every figure are invented; the layout is the real one, the same
              page you get from your own tabs.
            </p>
          </header>

          <RecordHeader
            speakerRows={SAMPLE_SPEAKER_ROWS}
            judgeRows={SAMPLE_JUDGE_ROWS}
            summary={SAMPLE_SUMMARY}
          />
          <PublicHighlights speaking={lists.speaking} judging={lists.judging} />
          <OpenYearOnHash />
          <Tabs
            label="Sample record"
            param="tab"
            items={[
              {
                value: 'ledger',
                label: 'Ledger',
                panel: (
                  <SpeakingYears
                    years={years}
                    open={openSpeaking}
                    table={(y, label) => (
                      <PublicSpeakingTable rows={y.speaking} label={label} proAm={none} />
                    )}
                  />
                ),
              },
              {
                value: 'adjudication',
                label: 'Adjudication',
                panel: (
                  <JudgingYears
                    years={years}
                    open={openJudging}
                    table={(y, label) => <PublicJudgingTable rows={y.judging} label={label} />}
                  />
                ),
              },
            ]}
          />

          <section className="panel bg-ink p-panel text-paper md:p-group">
            <div className="grid items-center gap-panel md:grid-cols-[1fr_auto]">
              <div>
                <div className="eyebrow-on-ink">Your own record</div>
                <h2 className="mt-tight font-display text-h2 font-medium tracking-tight">
                  The same page, from your tabs
                </h2>
                <p className="mt-tight inline-flex items-center gap-inline text-ui text-paper/70">
                  <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
                  Read-only Gmail · we keep tab links, never email bodies
                </p>
              </div>
              <BuildCvButton />
            </div>
          </section>
        </main>
      </div>
      <Footer width="public" />
    </>
  );
}
