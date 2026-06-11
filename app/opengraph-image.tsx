import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'debate cv — verified tournament records for debaters';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const INK = '#1C1B18';
const SHEET = '#FAF9F4';
const GOLD = '#A06F22';
const MUTED = '#6B675C';

/**
 * Site-level Open Graph card, Tab Sheet style: gold break-slash brand,
 * the hero declarative over a heavy ink rule, and the trust facts in a
 * letterspaced agate row. Replaces the editorial Georgia-serif card.
 */
export default async function OpengraphImage() {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 12, height: 34, background: GOLD, transform: 'skewX(-12deg)' }} />
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 3 }}>DEBATE CV</div>
        </div>

        {/* Headline over the heavy rule */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div
            style={{
              fontSize: 88,
              fontWeight: 800,
              lineHeight: 1.04,
              letterSpacing: -2,
              maxWidth: 1000,
            }}
          >
            Every break, on the record.
          </div>
          <div style={{ display: 'flex', height: 4, background: INK }} />
          <div style={{ fontSize: 26, color: MUTED, maxWidth: 920, lineHeight: 1.4 }}>
            Tournaments, breaks, speaker scores, and judging — one verified record you
            can share when it matters.
          </div>
        </div>

        {/* Agate trust row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: 2.5,
            color: MUTED,
          }}
        >
          <span>READ-ONLY GMAIL</span>
          <span style={{ color: GOLD }}>·</span>
          <span>PRIVATE UNTIL SHARED</span>
          <span style={{ color: GOLD }}>·</span>
          <span>SOURCE-BACKED ROWS</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
