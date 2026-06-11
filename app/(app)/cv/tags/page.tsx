import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { REGIONS, MOTION_TYPES, MOTION_TYPE_LABELS, MOTION_TOPICS, inferMotionType } from '@/lib/tags/vocabulary';
import { TagProposalControls } from '@/components/TagProposalControls';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Tags',
  description: 'Propose region and motion tags for your tournaments.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function CvTagsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  // Load every ingested tournament for this user — same pattern as /cv/analytics
  // but we need the motions and the user's own proposals alongside them.
  const discoveredRows = await prisma.discoveredUrl.findMany({
    where: {
      userId,
      tournamentId: { not: null },
      ingestedAt: { not: null },
    },
    include: {
      tournament: {
        include: { motions: { orderBy: [{ roundNumber: 'asc' }, { seq: 'asc' }] } },
      },
    },
  });

  // Deduplicate by tournamentId — the same tournament can arrive through
  // multiple Gmail threads (invite + reminder), but the tagging surface is
  // per-tournament, not per-URL.
  const seenIds = new Set<string>();
  const tournaments: NonNullable<(typeof discoveredRows)[number]['tournament']>[] = [];
  for (const row of discoveredRows) {
    if (!row.tournament) continue;
    const tid = row.tournament.id.toString();
    if (seenIds.has(tid)) continue;
    seenIds.add(tid);
    tournaments.push(row.tournament);
  }

  // Sort most-recent-year first so the page opens with the user's freshest
  // tournaments — the ones most worth tagging.
  tournaments.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  // Collect tournament and motion IDs to fetch the user's proposals in a
  // single query rather than N+1 per section.
  const tournamentIds = tournaments.map((t) => t.id);
  const motionIds = tournaments.flatMap((t) => t.motions.map((m) => m.id));

  const proposals = await prisma.tagProposal.findMany({
    where: {
      userId,
      OR: [
        { tournamentId: { in: tournamentIds }, motionId: null },
        ...(motionIds.length > 0 ? [{ motionId: { in: motionIds } }] : []),
      ],
    },
    select: {
      id: true,
      kind: true,
      tournamentId: true,
      motionId: true,
      value: true,
      status: true,
      adminNote: true,
    },
  });

  // Index proposals by a composite key so child components can look them up
  // in O(1). Key format: `region:<tournamentId>`, `motion_type:<motionId>`,
  // `motion_topic:<motionId>`.
  type ProposalShape = {
    value: string;
    status: string;
    adminNote: string | null;
  };
  const proposalByKey = new Map<string, ProposalShape>();
  for (const p of proposals) {
    const key =
      p.kind === 'region'
        ? `region:${p.tournamentId.toString()}`
        : `${p.kind}:${p.motionId?.toString() ?? ''}`;
    proposalByKey.set(key, { value: p.value, status: p.status, adminNote: p.adminNote });
  }

  // MOTION_TYPE_LABELS has MotionType-keyed entries — cast to the wider
  // Record<string,string> the component accepts.
  const typeLabels: Record<string, string> = MOTION_TYPE_LABELS;

  return (
    <div className="space-y-10">
      <header className="space-y-4">
        <div className="eyebrow">DEBATE CV — TAGS</div>
        <h1 className="font-display text-h1 leading-[1.05] tracking-tight text-record-ink">
          Tags.
        </h1>
        <hr className="hairline" />
        <div className="meta">
          Tags are shared community facts — a tournament region or a motion type appears
          identically on every CV that includes that tournament. Proposals go live after
          an admin approves them, and feed the Analytics slices.
        </div>
        <p className="meta">
          <Link href="/cv/analytics" className="text-record-green hover:underline">
            ← Back to Growth
          </Link>
        </p>
      </header>

      {tournaments.length === 0 ? (
        <p className="text-body text-record-muted">
          No ingested tournaments yet. Once tournaments are on your CV, you can propose
          region and motion tags here.
        </p>
      ) : (
        <div className="space-y-12">
          {tournaments.map((t) => {
            const tIdStr = t.id.toString();
            const regionProposal = proposalByKey.get(`region:${tIdStr}`) ?? null;

            return (
              <section key={tIdStr} className="space-y-6">
                {/* Tournament header — name + year as a eyebrow/heading pair */}
                <header>
                  <div className="eyebrow">
                    {t.year ? `${t.year} · ` : ''}
                    {t.name.toUpperCase()}
                  </div>
                  <hr className="hairline mt-2" />
                </header>

                {/* Region row */}
                <div className="space-y-1.5">
                  <div className="text-table font-medium text-record-ink">Region</div>
                  <TagProposalControls
                    kind="region"
                    tournamentId={tIdStr}
                    options={[...REGIONS]}
                    approvedValue={t.region}
                    myProposal={regionProposal}
                  />
                </div>

                {/* Motion list — only rendered when the tournament has motions */}
                {t.motions.length > 0 ? (
                  <div className="space-y-4">
                    <div className="eyebrow">MOTIONS</div>
                    <div className="space-y-6">
                      {t.motions.map((m) => {
                        const mIdStr = m.id.toString();
                        const typeProposal = proposalByKey.get(`motion_type:${mIdStr}`) ?? null;
                        const topicProposal = proposalByKey.get(`motion_topic:${mIdStr}`) ?? null;
                        // Compute the inferred type server-side so the heavy
                        // regex runs once per motion in the RSC render rather
                        // than re-running every time the client re-hydrates.
                        const suggestedType = inferMotionType(m.text);

                        return (
                          <div
                            key={mIdStr}
                            className="space-y-3 border-l-2 border-record-ink/10 pl-4"
                          >
                            {/* Round label + motion text */}
                            <div>
                              <div className="text-caption text-record-muted uppercase tracking-[0.12em]">
                                {m.roundLabel}
                              </div>
                              <p className="mt-0.5 font-display text-body text-record-ink leading-snug">
                                {m.text}
                              </p>
                            </div>

                            {/* Type and topic pickers side by side on wider viewports */}
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="space-y-1">
                                <div className="text-caption text-record-muted uppercase tracking-[0.12em]">
                                  Motion type
                                </div>
                                <TagProposalControls
                                  kind="motion_type"
                                  tournamentId={tIdStr}
                                  motionId={mIdStr}
                                  options={[...MOTION_TYPES]}
                                  optionLabels={typeLabels}
                                  approvedValue={m.motionType}
                                  myProposal={typeProposal}
                                  suggestedValue={suggestedType}
                                />
                              </div>
                              <div className="space-y-1">
                                <div className="text-caption text-record-muted uppercase tracking-[0.12em]">
                                  Topic
                                </div>
                                <TagProposalControls
                                  kind="motion_topic"
                                  tournamentId={tIdStr}
                                  motionId={mIdStr}
                                  options={[...MOTION_TOPICS]}
                                  approvedValue={m.topic}
                                  myProposal={topicProposal}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
