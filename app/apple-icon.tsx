import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/**
 * 180×180 iOS home-screen icon. Matches the in-app BrandMark: display
 * grotesk wordmark on ballot paper, with the "cv" half in tournament green.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          background: '#F2F6F2',
          color: '#142019',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ fontSize: 62, fontWeight: 700, letterSpacing: -2, lineHeight: 1 }}>
          debate
        </div>
        <div
          style={{
            fontSize: 62,
            fontWeight: 700,
            letterSpacing: -2,
            lineHeight: 1,
            color: '#15703D',
          }}
        >
          cv
        </div>
      </div>
    ),
    { ...size },
  );
}
