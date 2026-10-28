import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/**
 * 180×180 iOS home-screen icon: the BrandMark tile at full bleed. iOS rounds
 * the corners itself, so the square stays square here. Same Ledger emerald
 * (--primary, 166 76% 22%) and white "CV" as the favicon; it replaces the
 * retired italic-serif "debate cv" wordmark on cream.
 */
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0D634F',
        color: '#FFFFFF',
        fontSize: 76,
        fontWeight: 700,
        letterSpacing: 2,
      }}
    >
      CV
    </div>,
    { ...size },
  );
}
