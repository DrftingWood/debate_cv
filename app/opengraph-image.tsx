import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'debate cv — your debate tournament history, from your inbox';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

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
          background: 'linear-gradient(160deg, #FAFAFA 0%, #EEF2FF 100%)',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
          color: '#09090B',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: '#4338CA',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            DC
          </div>
          <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.2 }}>debate cv</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div
            style={{
              fontSize: 68,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: -1.5,
              maxWidth: 960,
            }}
          >
            Your debate CV,
            <br />
            auto-built from your inbox.
          </div>
          <div style={{ fontSize: 26, color: '#52525B', maxWidth: 880, lineHeight: 1.35 }}>
            Sign in with Google. We pull Tabbycat private URLs from Gmail and compile your
            tournament history — speaker scores, break results, teammates.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {[
            { label: 'Gmail read-only', bg: '#EEF2FF', color: '#4338CA' },
            { label: 'Private to you', bg: '#ECFDF5', color: '#047857' },
            { label: 'Open source', bg: '#FFFBEB', color: '#B45309' },
          ].map((p) => (
            <div
              key={p.label}
              style={{
                padding: '10px 18px',
                borderRadius: 999,
                background: p.bg,
                color: p.color,
                fontSize: 22,
                fontWeight: 500,
              }}
            >
              {p.label}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
