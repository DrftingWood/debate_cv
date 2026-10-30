import { useId } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Tooltip } from '@/components/ui/Tooltip';

const EXPLANATION = "Some pages of this tournament's tab didn't load. We retry them automatically.";

/**
 * The mark on a tournament whose scrape left a tab or round page failed.
 * The tournament still counts on the record (owner decision 2026-10-30);
 * this says its figures may be incomplete until the retry lands.
 *
 * The badge text is the headline and colour is not the only cue (UX-34).
 * The sentence behind it must reach keyboard and screen-reader users too
 * (UX-36), and the visual tooltip cannot: it is `aria-hidden` and opens on
 * hover or focus only. So the badge takes focus (tabIndex 0) and points
 * `aria-describedby` at an sr-only copy of the sentence.
 *
 * Inside a table the `Tooltip` would be clipped: the panel around every
 * ledger table scrolls (`TableScroll`), and `Tooltip` is absolutely
 * positioned (its own notes say a scrolling table would need a portal).
 * There the same copy rides on a native `title` as well.
 */
export function PartlyLoadedBadge({ inTable = false }: { inTable?: boolean }) {
  const descId = useId();
  const badge = (
    <Badge
      variant="warning"
      tabIndex={0}
      aria-describedby={descId}
      title={inTable ? EXPLANATION : undefined}
      className="focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      Partly loaded
    </Badge>
  );
  // Outside the badge, so the description is not part of its own content.
  const description = (
    <span id={descId} className="sr-only">
      {EXPLANATION}
    </span>
  );
  if (inTable) {
    return (
      <>
        {badge}
        {description}
      </>
    );
  }
  // The badge sits at the card's left edge, so the label grows rightwards
  // and wraps inside 16rem rather than running off a 390px screen.
  return (
    <>
      <Tooltip content={EXPLANATION} side="top" align="start" wrap>
        {badge}
      </Tooltip>
      {description}
    </>
  );
}
