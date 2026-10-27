import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/**
 * 32×32 browser favicon: the BrandMark tile (components/BrandMark.tsx), a
 * squared emerald block with a white "CV". Replaces the retired editorial
 * mark (an italic serif "cv" in oxblood on cream). Colours are the Ledger
 * light-theme tokens as hex, because the image renderer cannot read CSS
 * variables: emerald is --primary (166 76% 22%), and white clears 7:1 on it.
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
          borderRadius: 6,
          background: '#0D634F',
          color: '#FFFFFF',
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: 0.5,
        }}
      >
        CV
      </div>
    ),
    { ...size },
  );
}
