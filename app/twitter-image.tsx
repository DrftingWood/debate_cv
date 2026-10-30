import { ImageResponse } from 'next/og';
import { ShareCard } from '@/components/landing/ShareCard';

// Literals, not imports: Next reads these route-segment and image-metadata
// exports statically. The card itself lives in components/landing/ShareCard
// so the Open Graph and X/Twitter images cannot drift apart.
export const runtime = 'nodejs';
export const alt = 'debate cv: your debate record, built from your tabs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function TwitterImage() {
  return new ImageResponse(<ShareCard />, { ...size });
}
