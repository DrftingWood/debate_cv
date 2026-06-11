import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/**
 * 180×180 iOS home-screen icon. Tab Sheet brand mark: the gold break-slash
 * beside a bold "CV" on record ink — matches the in-app BrandMark.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          background: '#1C1B18',
        }}
      >
        <div
          style={{
            width: 26,
            height: 78,
            background: '#A06F22',
            transform: 'skewX(-12deg)',
          }}
        />
        <div
          style={{
            fontSize: 64,
            fontWeight: 800,
            letterSpacing: 2,
            color: '#FAF9F4',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          }}
        >
          CV
        </div>
      </div>
    ),
    { ...size },
  );
}
