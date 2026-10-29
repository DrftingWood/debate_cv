import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The project's custom font-size scale, exactly as declared by
 * the `--text-*` tokens of the `@theme` block in app/globals.css.
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
 * Keep in sync with app/globals.css. A name here that is not in the
 * theme is harmless; a name in the theme but missing here re-opens the bug.
 */
const FONT_SIZES = [
  'kicker',
  'byline',
  'caption',
  'table',
  'ui',
  'body',
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

/**
 * The named spacing steps and page widths from the same `@theme` block.
 * tailwind-merge only knows the numeric spacing scale, so without these
 * `cn('p-4', 'p-panel')` would keep both classes and the winner would be
 * whichever Tailwind happens to emit last, not the one passed last.
 */
const SPACING = ['hair', 'inline', 'tight', 'stack', 'panel', 'group', 'section', 'page'] as const;
const CONTAINERS = ['content', 'wide'] as const;

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: [...SPACING],
      container: [...CONTAINERS],
    },
    classGroups: {
      'font-size': [{ text: [...FONT_SIZES] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
