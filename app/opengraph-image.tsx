import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'debate cv — your debate history, readable and ready to share';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Open Graph share card. Mirrors the new landing hero: display-grotesk
 * headline (not italic), tournament-green accent, a factual trust strip
 * at the bottom. Brief §11 retires Vol./Editor's Note/Colophon framing.
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
          padding: 80,
          background: '#F2F6F2',
          color: '#142019',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Wordmark + tagline */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 36, fontWeight: 600, letterSpacing: -0.5 }}>debate</span>
            <span
              style={{
                fontSize: 36,
                fontWeight: 600,
                letterSpacing: -0.5,
                color: '#15703D',
              }}
            >
              cv
            </span>
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: 3,
              textTransform: 'uppercase',
              color: '#5A6660',
            }}
          >
            For university debaters
          </div>
        </div>

        {/* Hairline */}
        <div style={{ display: 'flex', height: 1, background: 'rgba(20, 32, 25, 0.14)', marginTop: -40 }} />

        {/* Headline + sub */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              fontSize: 78,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: -2,
              maxWidth: 1040,
            }}
          >
            Your debate history, readable and ready to share.
          </div>
          <div
            style={{
              fontSize: 26,
              color: '#3F4A44',
              maxWidth: 980,
              lineHeight: 1.4,
            }}
          >
            A private, source-backed CV — tournaments, breaks, speaker scores,
            and growth over time, verified against the original tab pages.
          </div>
        </div>

        {/* Trust strip */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: '#5A6660',
          }}
        >
          <span>Read-only Gmail</span>
          <span style={{ color: 'rgba(20, 32, 25, 0.3)' }}>·</span>
          <span>Private until shared</span>
          <span style={{ color: 'rgba(20, 32, 25, 0.3)' }}>·</span>
          <span>Delete any time</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
