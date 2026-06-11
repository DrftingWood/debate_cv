import { ImageResponse } from 'next/og';
import { prisma } from '@/lib/db';
import { buildCvData } from '@/lib/cv/buildCvData';

// Node runtime (not edge): this card reads through Prisma. It renders the
// preview a debater's CV link shows in WhatsApp / Instagram DM / LinkedIn —
// the product's actual distribution channels — so it must read as a
// break-announcement-grade credential, not a blank card (teardown §1.9).
export const alt = 'Verified debate tournament record';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const INK = '#1C1B18';
const SHEET = '#FAF9F4';
const GOLD = '#A06F22';
const MUTED = '#6B675C';

export default async function OpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await prisma.user.findUnique({
    where: { publicCvSlug: slug },
    select: { id: true, name: true, publicCvEnabled: true },
  });

  // Disabled/unknown slugs get the brand card, never an error or a leak.
  if (!user || !user.publicCvEnabled) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 28,
            background: SHEET,
          }}
        >
          <div style={{ width: 26, height: 72, background: GOLD, transform: 'skewX(-12deg)' }} />
          <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: 4, color: INK }}>DEBATE CV</div>
        </div>
      ),
      { ...size },
    );
  }

  const { summary, highlights } = await buildCvData(user.id);
  const stats: { label: string; value: string }[] = [];
  stats.push({ label: 'TOURNAMENTS', value: String(summary.totalTournaments) });
  if (summary.breaks > 0) stats.push({ label: 'BREAKS', value: String(summary.breaks) });
  if (highlights.bestSpeakerAverage)
    stats.push({ label: 'BEST AVG', value: highlights.bestSpeakerAverage.score.toFixed(1) });
  if (highlights.bestSpeakerRank)
    stats.push({ label: 'BEST SPEAKER', value: `#${highlights.bestSpeakerRank.rank}` });
  if (stats.length < 4 && highlights.outroundsChaired > 0)
    stats.push({ label: 'OUTROUNDS CHAIRED', value: String(highlights.outroundsChaired) });
  const blocks = stats.slice(0, 4);
  const span = highlights.activeYears
    ? `${highlights.activeYears.from}–${String(highlights.activeYears.to).slice(2)}`
    : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: SHEET,
          color: INK,
        }}
      >
        {/* Brand row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 12, height: 34, background: GOLD, transform: 'skewX(-12deg)' }} />
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 3 }}>DEBATE CV</div>
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: 3, color: MUTED }}>
            VERIFIED TOURNAMENT RECORD{span ? ` · ${span}` : ''}
          </div>
        </div>

        {/* Name over the heavy rule */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              fontSize: 84,
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: -2,
              maxWidth: 1040,
            }}
          >
            {user.name ?? 'Debater'}
          </div>
          <div style={{ display: 'flex', height: 4, background: INK }} />
        </div>

        {/* Stat row — ruled like the masthead StatBlocks */}
        <div style={{ display: 'flex', gap: 56 }}>
          {blocks.map((s) => (
            <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 56, fontWeight: 700 }}>{s.value}</div>
              <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: 2.5, color: MUTED }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
