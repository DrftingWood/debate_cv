import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/**
 * 32×32 browser favicon. Display-grotesk "cv" glyph in tournament green on
 * ballot-paper background, matching the new wordmark.
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
          background: '#F2F6F2',
          color: '#15703D',
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: -1,
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        }}
      >
        cv
      </div>
    ),
    { ...size },
  );
}
