// Same card as opengraph-image.tsx, including its privacy rules (only
// publicCvEnabled profiles get a name; everything else gets the generic card).
// Next reads the config exports statically, so they are literals here, not
// re-exports.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const alt = 'A public debate record on debate cv';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export { default } from './opengraph-image';
