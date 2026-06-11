import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/**
 * 180×180 iOS home-screen icon. Editorial brand mark: italic-Fraunces
 * wordmark on cream paper, with the "cv" half tinted record-green — matches
 * the in-app BrandMark component.
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
          background: '#FAF6EC',
          color: '#181A1F',
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontStyle: 'italic',
        }}
      >
        <div style={{ fontSize: 62, fontWeight: 500, letterSpacing: -2, lineHeight: 1 }}>
          debate
        </div>
        <div style={{ fontSize: 62, fontWeight: 500, letterSpacing: -2, lineHeight: 1, color: '#7A2528' }}>
          cv
        </div>
      </div>
    ),
    { ...size },
  );
}
