import { Check } from '@/components/ui/icons';

/**
 * The pressed state of a toggle chip on /cv/stats (filter chips, cross-tab
 * grid and metric toggles).
 *
 * Pressed used to be `bg-card` on a `bg-surface-2` track: about 1.04:1, so a
 * sighted user could not tell which filters were on (SC 1.4.11). Now it is
 * the dashboard filter chip's inverted ink, plus a check glyph so the state
 * is not carried by colour alone (SC 1.4.1). `aria-pressed` on the button
 * carries it for assistive tech; the glyph is hidden from it.
 */
export function pressedClasses(pressed: boolean): string {
  return pressed ? 'bg-ink text-paper shadow-xs' : 'text-ink-soft hover:text-ink';
}

export function PressedMark() {
  return <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />;
}
