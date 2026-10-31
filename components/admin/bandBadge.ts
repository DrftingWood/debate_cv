/**
 * The accuracy band in words beside the figure, so the colour is never the
 * only cue (UX-34): green for a score to keep, amber to look at, red to
 * re-scrape. A plain module, neither server nor client, so the overview's
 * client table and the server-rendered panels and lists share one copy: a
 * value exported from a 'use client' module is not readable on the server.
 */
export const BAND_BADGE = {
  good: { text: 'Good', variant: 'success' },
  check: { text: 'Check', variant: 'warning' },
  rescrape: { text: 'Re-scrape', variant: 'danger' },
} as const satisfies Record<
  'good' | 'check' | 'rescrape',
  { text: string; variant: 'success' | 'warning' | 'danger' }
>;
