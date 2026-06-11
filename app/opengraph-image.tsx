import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'debate cv — verified tournament records for debaters';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Open Graph share card. Editorial paper-on-ink with italic-Fraunces
 * wordmark, headline matching the new landing hero, and a small-caps
 * tagline. Replaces the previous indigo-SaaS gradient + traffic-light
 * pill chips.
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
          background: '#FAF6EC',
          color: '#181A1F',
          fontFamily: 'Georgia, "Times New Roman", serif',
        }}
      >
        {/* Masthead row */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 36, fontStyle: 'italic', fontWeight: 500, letterSpacing: -0.5 }}>
              debate
            </span>
            <span style={{ fontSize: 36, fontStyle: 'italic', fontWeight: 500, letterSpacing: -0.5, color: '#7A2528' }}>
              cv
            </span>
          </div>
          <div
            style={{
              fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: 3,
              textTransform: 'uppercase',
              color: '#5C636E',
            }}
          >
            Verified tournament records
          </div>
        </div>

        {/* Hairline rule */}
        <div style={{ display: 'flex', height: 1, background: 'rgba(24, 26, 31, 0.14)', marginTop: -40 }} />

        {/* Headline + lede */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div
            style={{
              fontSize: 80,
              fontStyle: 'italic',
              fontWeight: 500,
              lineHeight: 1.05,
              letterSpacing: -2,
              maxWidth: 1040,
            }}
          >
            Every break, on the record.
          </div>
          <div
            style={{
              fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
              fontSize: 26,
              color: '#5C636E',
              maxWidth: 920,
              lineHeight: 1.4,
            }}
          >
            Tournaments, breaks, speaker scores, and judging — one verified record you can share when it matters.
          </div>
        </div>

        {/* Colophon row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
            fontSize: 18,
            fontWeight: 500,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: '#5C636E',
          }}
        >
          <span>Read-only Gmail</span>
          <span style={{ color: 'rgba(24, 26, 31, 0.3)' }}>·</span>
          <span>Private until shared</span>
          <span style={{ color: 'rgba(24, 26, 31, 0.3)' }}>·</span>
          <span>Delete any time</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
