import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The project's custom font-size scale, exactly as declared under
 * `theme.extend.fontSize` in tailwind.config.ts.
 *
 * This list is not decoration — it fixes a silent, app-wide rendering bug.
 *
 * tailwind-merge resolves conflicts by class GROUP, and it identifies a
 * font-size class by matching a known scale (`text-xs`…`text-9xl`) or an
 * arbitrary value. None of the names below look like either, so every one
 * of them was classified as a text COLOUR instead. That put `text-ui` and
 * `text-primary-foreground` in the same group, and since the size class is
 * appended last in every component, the size silently deleted the colour.
 *
 * The visible result: every primary button in the product rendered its
 * label in `ink` on an emerald background — near-black on dark green, 2.4:1,
 * well under AA — because `text-primary-foreground` never survived `cn()`.
 * The same trap applies to any `text-<custom-size>` + `text-<colour>` pair,
 * so it is fixed once here rather than by reordering call sites.
 *
 * Keep in sync with tailwind.config.ts. A name here that is not in the
 * config is harmless; a name in the config but missing here re-opens the bug.
 */
const FONT_SIZES = [
  'kicker',
  'byline',
  'caption',
  'table',
  'ui',
  'body',
  'body-serif',
  'h4',
  'h3',
  'h2',
  'h1',
  'stat',
  'figure-sm',
  'figure-md',
  'figure-lg',
  'display',
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZES] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
