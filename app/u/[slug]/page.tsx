import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { buildCvData } from '@/lib/cv/buildCvData';
import { openYears, recordYears } from '@/lib/cv/periodTotal';
import { proAmKey } from '@/lib/cv/proAm';
import { publicHighlights, type Highlight } from '@/lib/cv/publicHighlights';
import { resolveTab } from '@/lib/utils/tabParam';
import { DownloadPdfButton } from '@/components/DownloadPdfButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tabs } from '@/components/ui/Tabs';
import { Check } from '@/components/ui/icons';
import { OpenYearOnHash } from '@/components/OpenYearOnHash';
import { RecordHeader } from '@/components/RecordHeader';
import { JudgingYears, SpeakingYears } from '@/components/YearGroups';
import { PublicJudgingTable, PublicSpeakingTable } from './PublicLedger';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const user = await prisma.user.findUnique({
    where: { publicCvSlug: slug },
    select: { publicCvEnabled: true, name: true },
  });
  if (!user || !user.publicCvEnabled) {
    // Throw here, before the shell streams, so the response is a real 404
    // rather than a 200 carrying a not-found body (NV-2).
    notFound();
  }
  return {
    // Just the name — the root layout's metadata template is '%s · debate cv'
    // and appends the suffix itself. Spelling it out here too rendered
    // "Ritabrata Mitra · debate cv · debate cv" in the tab and in the
    // link preview.
    title: user.name ?? 'Debater',
    description: `${user.name ?? 'A debater'}'s tournament history.`,
    robots: { index: false, follow: false, nocache: true },
  };
}

/**
 * Public read-only CV (`/u/<slug>`), the credentialing artifact.
 *
 * Same data as the owner's /cv with every owner-only affordance stripped:
 * no report buttons, no banners, no share or settings links, no auto-scan,
 * no round detail and no Partners tab.
 *
 * Redesign (owner decision 18, 2026-10-29), top to bottom: the header
 * ("✓ N tournaments, each linked to its tab"), the same tiles and career
 * charts as the Record, Highlights as two short lists side by side
 * (Speaking and Judging, up to three each, majors first), then Ledger and
 * Adjudication tabs grouped by year with subtotals. Hidden tournaments never
 * appear: buildCvData drops them before anything here counts. Print and PDF
 * carry both tabs, every year open, always light.
 *
 * The page follows the visitor's theme (decision 3); only print, the PDF and
 * the share image are fixed light.
 */
const TABS = ['ledger', 'adjudication'] as const;

export default async function PublicCvPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
}) {
  const { slug } = await params;
  const user = await prisma.user.findUnique({
    where: { publicCvSlug: slug },
    select: {
      id: true,
      name: true,
      image: true,
      publicCvEnabled: true,
      publicAvatarEnabled: true,
      publicHiddenTournamentIds: true,
      publicProAmEnabled: true,
      proAmMarks: true,
    },
  });
  if (!user || !user.publicCvEnabled) notFound();

  // No field stats: this page shows the owner's own figures only, and the
  // field summary is the single heaviest query in buildCvData. Skipping it
  // keeps an unauthenticated, force-dynamic route cheap to serve.
  // No field sizes either: only the old "best speaker rank" highlight read
  // them, and Highlights now follow team results, never speaker rank.
  const data = await buildCvData(user.id, {
    includeFieldStats: false,
    excludeTournamentIds: user.publicHiddenTournamentIds ?? [],
  });
  const { speakerRows, judgeRows, summary, highlights } = data;
  const years = recordYears(speakerRows, judgeRows);
  const now = new Date();
  const openSpeaking = openYears(
    years.filter((y) => y.speakingTotal),
    now,
  );
  const openJudging = openYears(
    years.filter((y) => y.judgingTotal),
    now,
  );
  const tab = resolveTab(
    (await searchParams)?.tab,
    TABS,
    speakerRows.length > 0 ? 'ledger' : 'adjudication',
  );
  const lists = publicHighlights(speakerRows, judgeRows);

  // Pro-am marks are private unless the owner opted in (decision 17): only
  // then does the page learn which tournaments carry one.
  const marks = new Set(user.publicProAmEnabled ? user.proAmMarks : []);
  const proAm = new Set(
    speakerRows
      .filter((r) => r.teammates.some((t) => marks.has(proAmKey(r.tournamentId, t))))
      .map((r) => r.tournamentId.toString()),
  );

  // The newest ingest, not the render date (CV-10).
  const updated = data.lastIngestedAt
    ? data.lastIngestedAt.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;
  const active = highlights.activeYears
    ? highlights.activeYears.from === highlights.activeYears.to
      ? `Active ${highlights.activeYears.from}`
      : `Active ${highlights.activeYears.from}–${highlights.activeYears.to}`
    : null;
  const total = summary.totalTournaments;

  return (
    <div className="w-full flex-1 space-y-group">
      <header className="border-b border-border pb-panel">
        <div className="data-label">
          Public debate record{updated ? ` · updated ${updated}` : ''}
        </div>
        <div className="mt-tight flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-stack">
            {user.publicAvatarEnabled && user.image ? (
              // The name is the h1 right beside it, so the photo is decorative
              // here: alt="" stops a screen reader saying the name twice.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt=""
                className="h-16 w-16 rounded-lg border border-border object-cover"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-surface-2 font-mono text-h3 text-ink"
              >
                {initials(user.name)}
              </div>
            )}
            <div>
              <h1 className="font-display text-h1 font-medium tracking-tight text-ink">
                <span className="sr-only">Debate record of </span>
                {user.name ?? 'Debater'}
              </h1>
              {/*
                The record's own tournament total, the same figure the tiles
                add up to. Every one of them links to the tab it was read
                from, which is what the tick claims.
              */}
              <p className="mt-hair flex flex-wrap items-center gap-x-inline text-table text-ink-soft">
                {total > 0 ? (
                  <span className="inline-flex items-center gap-hair text-ink">
                    <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
                    {total} tournament{total === 1 ? '' : 's'}, each linked to its tab
                  </span>
                ) : null}
                {active ? <span>{active}</span> : null}
              </p>
            </div>
          </div>
          <div data-print-hide="true">
            <DownloadPdfButton />
          </div>
        </div>
      </header>

      {total === 0 ? (
        <EmptyState
          title="No tournaments on this record yet"
          description="Tournaments appear here once their tab pages have been read."
        />
      ) : (
        <>
          <RecordHeader speakerRows={speakerRows} judgeRows={judgeRows} summary={summary} />
          <PublicHighlights speaking={lists.speaking} judging={lists.judging} />
          <OpenYearOnHash />
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
                        label: 'Ledger',
                        panel: (
                          <div className="space-y-stack">
                            <h2 className="sr-only">Speaking, by year</h2>
                            <SpeakingYears
                              years={years}
                              open={openSpeaking}
                              table={(y, label) => (
                                <PublicSpeakingTable
                                  rows={y.speaking}
                                  label={label}
                                  proAm={proAm}
                                />
                              )}
                            />
                            {/*
                              The column explanations used to live in `title`
                              tooltips, which a phone never shows. Placement is
                              a team fact (DESIGN_INSTRUCTIONS §9), so the key
                              says which rank is the team's.
                            */}
                            <p className="text-caption text-ink-soft">
                              Team rank is where the team finished on the prelim team tab, out of
                              the teams on it. Speaker-tab rank is an individual figure on the open
                              speaker tab, not the team&rsquo;s placement.
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
                        label: 'Adjudication',
                        panel: (
                          <div>
                            <h2 className="sr-only">Judging, by year</h2>
                            <JudgingYears
                              years={years}
                              open={openJudging}
                              table={(y, label) => (
                                <PublicJudgingTable rows={y.judging} label={label} />
                              )}
                            />
                          </div>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </>
      )}

      <p className="border-t border-border pt-stack text-caption text-ink-soft">
        Compiled from {total} public tab{total === 1 ? '' : 's'}
        {updated ? ` · last updated ${updated}` : ''} ·{' '}
        <Link href="/" className="text-primary underline-offset-2 hover:underline">
          What this is
        </Link>
        . Every row links to the tournament tab it was read from; figures are as the tab published
        them.
      </p>
    </div>
  );
}

/**
 * Highlights as two short lists side by side (decision 18): the best three
 * results in each role, majors first, as statement entries. A role with
 * nothing to show is left out; with neither, the section is.
 */
function PublicHighlights({ speaking, judging }: { speaking: Highlight[]; judging: Highlight[] }) {
  const lists = [
    { key: 'speaking', title: 'Speaking', items: speaking },
    { key: 'judging', title: 'Judging', items: judging },
  ].filter((l) => l.items.length > 0);
  if (lists.length === 0) return null;
  return (
    <section aria-labelledby="highlights" className="space-y-stack">
      <h2 id="highlights" className="data-label">
        Highlights
      </h2>
      <div className={lists.length === 2 ? 'grid gap-group md:grid-cols-2' : undefined}>
        {lists.map((l) => (
          <div key={l.key}>
            <h3 className="font-display text-h4 font-medium text-ink">{l.title}</h3>
            <ol className="mt-tight divide-y divide-border border-y border-border">
              {l.items.map((h) => (
                <li
                  key={`${h.tournamentName}|${h.year}`}
                  className="flex items-baseline justify-between gap-stack py-tight"
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{h.detail}</span>
                    <span className="block text-caption text-ink-soft">
                      {h.tournamentName}
                      {h.major ? <span className="ml-hair font-mono text-ink">◆</span> : null}
                      {h.major ? <span className="sr-only"> (a major)</span> : null}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-caption text-ink-soft">
                    {h.year ?? ''}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

function initials(name: string | null | undefined): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  const first = parts.at(0) ?? '';
  const last = parts.at(-1) ?? '';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return ((first.at(0) ?? '') + (last.at(0) ?? '')).toUpperCase();
}
