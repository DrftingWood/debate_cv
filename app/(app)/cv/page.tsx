import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { MagnifyingGlass, Table as TableIcon } from '@/components/ui/icons';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildCvData, type CvTaggedMotion } from '@/lib/cv/buildCvData';
import { EmptyState } from '@/components/ui/EmptyState';
import { buttonClasses } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { AutoScanOnVisit } from '@/components/AutoScanOnVisit';
import { CvNeedsAttentionBanners } from '@/components/CvNeedsAttentionBanners';
import { CvShareButton } from '@/components/CvShareButton';
import { CvDownloadButton } from '@/components/CvDownloadButton';
import { GmailDisconnectedNotice } from '@/components/GmailDisconnectedNotice';
import { OpenYearOnHash } from '@/components/OpenYearOnHash';
import { RecordHeader } from '@/components/RecordHeader';
import { readCvCategory } from '@/lib/cv/categoryFilter';
import { RecordPartners } from '@/components/RecordPartners';
import { JudgingLedger, SpeakingLedger } from '@/components/RecordLedger';
import { openYears, recordYears } from '@/lib/cv/periodTotal';
import { partnerOverview } from '@/lib/cv/proAm';
import { resolveTab } from '@/lib/utils/tabParam';

export const metadata: Metadata = {
  title: 'Record',
  description: 'Your debate tournament history, compiled from your Gmail.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The record view — the product's statement page.
 *
 * Structure follows a bank statement, top to bottom: who the account
 * belongs to, the position summary, then the ledger of transactions with
 * the detail folded away behind each line. Everything on this page is a
 * fact the tab site published; interpretation lives on /cv/stats.
 *
 * Redesign (owner decisions 13-15, 2026-10-29): the header carries two
 * tiles per role above the speaking and judging career charts, then the
 * record sits under two tabs, Ledger (speaking) and Adjudication (judging),
 * each grouped by calendar year with a subtotal row; the current and
 * previous years start open. A Partners tab follows, where the user marks
 * pro-am partnerships (decision 17); it never prints, because the marks are
 * private unless the user shares them. Print and PDF carry Ledger and
 * Adjudication with every year open.
 */
const TABS = ['ledger', 'adjudication', 'partners'] as const;

export default async function CvPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string | string[]; cat?: string | string[] }>;
} = {}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  // First-time users without claims belong on /onboarding (the wizard).
  // /cv is the post-onboarding home; we don't want a brand-new user to
  // arrive here and see "No tournaments yet" with no path forward.
  const claimedCount = await prisma.person.count({
    where: { claimedByUserId: userId },
  });
  if (claimedCount === 0) redirect('/onboarding');

  const [data, pendingCount, gmailToken, marksRow] = await Promise.all([
    buildCvData(userId),
    prisma.ingestJob.count({
      where: { userId, status: { in: ['pending', 'running'] } },
    }),
    // A revoked Gmail grant was only ever surfaced on /dashboard, but
    // AutoScanOnVisit fires here too and swallows the resulting 400 by
    // design. A user who bookmarks /cv — the product's home — would watch
    // their record silently stop updating with nothing on screen to say why.
    prisma.gmailToken.findUnique({ where: { userId }, select: { userId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { proAmMarks: true } }),
  ]);
  const {
    user,
    speakerRows,
    judgeRows,
    taggedMotions,
    fieldStats,
    unmatchedTournaments: unmatched,
    summary,
    highlights,
  } = data;
  const { totalTournaments } = summary;

  // Motions by tournament for the per-round ledger. Outround motions carry no
  // round number, so the ledger matches those by stage (ledgerMotions).
  const motionsByTournament = new Map<string, CvTaggedMotion[]>();
  for (const m of taggedMotions) {
    const key = m.tournamentId.toString();
    const list = motionsByTournament.get(key) ?? [];
    list.push(m);
    motionsByTournament.set(key, list);
  }
  const fieldByTournament = new Map(fieldStats.map((f) => [f.tournamentId.toString(), f]));

  const years = recordYears(speakerRows, judgeRows);
  // Each tab opens its own recent years: a judge whose last judging year is
  // older than their last speaking year still lands on an open year.
  const now = new Date();
  const openSpeaking = openYears(
    years.filter((y) => y.speakingTotal),
    now,
  );
  const openJudging = openYears(
    years.filter((y) => y.judgingTotal),
    now,
  );
  const partners = partnerOverview(speakerRows, new Set(marksRow?.proAmMarks ?? []));
  const params = await searchParams;
  const category = readCvCategory(params?.cat);
  const tab = resolveTab(params?.tab, TABS, speakerRows.length > 0 ? 'ledger' : 'adjudication');

  // The data's date, not today's: "compiled" used to change on every visit
  // and read as a fact about the record (CV-10).
  const updated = data.lastIngestedAt
    ? data.lastIngestedAt.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;

  return (
    <div className="space-y-panel md:space-y-8">
      {/*
        No Gmail grant, no scan: the request can only 400, and the banner
        below already says what to do. Firing it anyway logged a console
        error on every visit (DASH-13).
      */}
      {gmailToken ? <AutoScanOnVisit /> : null}
      {!gmailToken ? (
        <GmailDisconnectedNotice
          data-print-hide="true"
          action={
            <Link href="/dashboard" className={buttonClasses({ variant: 'primary' })}>
              Reconnect from imports
            </Link>
          }
        >
          New tournaments have stopped arriving.
        </GmailDisconnectedNotice>
      ) : null}
      <CvNeedsAttentionBanners pendingCount={pendingCount} unmatchedCount={unmatched.length} />

      {/* Account header — identity on the left, statement actions on the
          right, exactly where a banking dashboard puts them. */}
      <header className="flex flex-col gap-stack border-b border-border pb-stack md:flex-row md:gap-5 md:pb-6 md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="data-label">Debate record{updated ? ` · updated ${updated}` : ''}</div>
          <h1 className="mt-2 font-display text-h1 font-medium tracking-tight text-ink">
            <span className="sr-only">Debate record of </span>
            {user?.name ?? 'Debater'}
          </h1>
          <p className="mt-hair text-table text-ink-soft">
            {[
              user?.email,
              highlights.activeYears
                ? highlights.activeYears.from === highlights.activeYears.to
                  ? `Active ${highlights.activeYears.from}`
                  : `Active ${highlights.activeYears.from}–${highlights.activeYears.to}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-print-hide="true">
          <CvShareButton />
          <CvDownloadButton />
        </div>
      </header>

      {totalTournaments === 0 ? (
        <EmptyState
          icon={<TableIcon weight="light" className="h-5 w-5" aria-hidden />}
          title="No tournaments yet"
          description={
            <>
              On Imports, <strong>Scan Gmail</strong>, then <strong>Ingest all</strong>.
            </>
          }
          // The disconnect notice above already carries the one primary to
          // /dashboard; a second identical one made two (NV-16).
          action={
            gmailToken ? (
              <Link href="/dashboard" className={buttonClasses({ variant: 'primary' })}>
                <MagnifyingGlass className="h-4 w-4" aria-hidden /> Open imports
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <RecordHeader
            speakerRows={speakerRows}
            judgeRows={judgeRows}
            summary={summary}
            countUp
            collapsible
            category={category}
            categoryHref={(cat) => (cat ? `/cv?cat=${cat}` : '/cv')}
          />
          <OpenYearOnHash />
          {/* Every panel prints, one after another (globals.css). */}
          <div data-print-all="true">
            <Tabs
              label="Record"
              param="tab"
              initialValue={tab}
              items={[
                ...(speakerRows.length > 0
                  ? [
                      {
                        value: 'ledger',
                        anchor: 'y',
                        label: 'Speaking',
                        panel: (
                          <div className="space-y-stack">
                            <h2 className="sr-only">Speaking, by year</h2>
                            <SpeakingLedger
                              years={years}
                              open={openSpeaking}
                              motionsByTournament={motionsByTournament}
                              fieldByTournament={fieldByTournament}
                            />
                            {/*
                              The abbreviated column headers explain themselves
                              through `title`, which needs a hover. A tablet
                              gets the desktop table and has no pointer, so the
                              key is printed beneath it; the phone cards spell
                              the labels out already.
                            */}
                            <p className="hidden text-caption text-ink-soft md:block">
                              <span className="font-medium text-ink">Avg speaks</span> speaker score
                              per prelim · <span className="font-medium text-ink">Speaker tab</span>{' '}
                              place on the speaker tab ·{' '}
                              <span className="font-medium text-ink">Category rank</span> rank in
                              your break category
                            </p>
                          </div>
                        ),
                      },
                    ]
                  : []),
                ...(judgeRows.length > 0
                  ? [
                      {
                        value: 'adjudication',
                        anchor: 'j',
                        label: 'Judging',
                        panel: (
                          <div>
                            <h2 className="sr-only">Judging, by year</h2>
                            <JudgingLedger years={years} open={openJudging} />
                          </div>
                        ),
                      },
                    ]
                  : []),
                ...(speakerRows.length > 0
                  ? [
                      {
                        value: 'partners',
                        label: 'Partners',
                        panel: (
                          <div data-print-hide="true">
                            <RecordPartners {...partners} />
                          </div>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </div>

          {/*
            Unmatched tournaments are surfaced via CvNeedsAttentionBanners at
            the top of the page; the per-row Find-me search lives on the
            imports page's Unmatched filter.
          */}
        </>
      )}
    </div>
  );
}
