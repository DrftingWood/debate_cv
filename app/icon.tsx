import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/**
 * 32×32 browser favicon. Tab Sheet brand mark: the gold break-slash on
 * record ink. Replaces the editorial italic-serif "cv" glyph.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1C1B18',
        }}
      >
        <div
          style={{
            width: 8,
            height: 20,
            background: '#A06F22',
            transform: 'skewX(-12deg)',
          }}
        />
      </div>
    ),
    { ...size },
  );
}
