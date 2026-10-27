/**
 * Typography for the legal pages (/privacy and /terms), mapped onto the
 * Ledger tokens.
 *
 * These pages used `prose prose-stone`, whose fixed stone greys were chosen
 * for a white page. On the graphite dark canvas the body text measured about
 * 2:1 and the headings and links nearly vanished (axe flagged 46 contrast
 * failures on /privacy in dark). The typography plugin reads every colour
 * from `--tw-prose-*` variables, so pointing those at the theme tokens makes
 * one set of rules right in both themes: `--foreground` is ~16:1 on either
 * canvas, `--muted-foreground` clears 4.5:1 on both, and `--primary` is the
 * emerald the rest of the product uses for links.
 *
 * Arbitrary-property utilities land in Tailwind's utilities layer, after the
 * plugin's component rules, so they override `.prose`'s own defaults without
 * touching globals.css. Body copy is the sans face: Ledger keeps the display
 * grotesk for headings only (DESIGN_INSTRUCTIONS §6).
 */
export const LEGAL_PROSE = [
  'prose max-w-none font-sans',
  '[--tw-prose-body:hsl(var(--foreground))]',
  '[--tw-prose-headings:hsl(var(--foreground))]',
  '[--tw-prose-lead:hsl(var(--muted-foreground))]',
  '[--tw-prose-links:hsl(var(--primary))]',
  '[--tw-prose-bold:hsl(var(--foreground))]',
  '[--tw-prose-counters:hsl(var(--muted-foreground))]',
  '[--tw-prose-bullets:hsl(var(--muted-foreground))]',
  '[--tw-prose-hr:hsl(var(--border)/0.2)]',
  '[--tw-prose-quotes:hsl(var(--foreground))]',
  '[--tw-prose-quote-borders:hsl(var(--border)/0.3)]',
  '[--tw-prose-code:hsl(var(--foreground))]',
  'prose-headings:font-display prose-headings:font-medium prose-headings:tracking-tight',
].join(' ');
