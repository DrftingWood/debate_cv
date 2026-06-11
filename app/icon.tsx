import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/**
 * 32×32 browser favicon. Editorial brand mark: "cv" glyph in
 * record-green on cream paper. Replaces the previous indigo "DC" monogram.
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
          background: '#FAF6EC',
          color: '#7A2528',
          fontSize: 22,
          fontWeight: 600,
          fontStyle: 'italic',
          letterSpacing: -1,
          fontFamily: 'Georgia, "Times New Roman", serif',
        }}
      >
        cv
      </div>
    ),
    { ...size },
  );
}
