import { Badge } from '@/components/ui/Badge';
import { Tooltip } from '@/components/ui/Tooltip';

const EXPLANATION = "Some pages of this tournament's tab didn't load. We retry them automatically.";

/**
 * The mark on a tournament whose scrape left a tab or round page failed.
 * The tournament still counts on the record (owner decision 2026-10-30);
 * this says its figures may be incomplete until the retry lands.
 *
 * The badge text is the whole message, so nothing depends on hover (UX-36)
 * and colour is not the only cue (UX-34). The tooltip only adds the "why".
 * Inside a table the `Tooltip` would be clipped: the panel around every
 * ledger table scrolls (`TableScroll`), and `Tooltip` is absolutely
 * positioned (its own notes say a scrolling table would need a portal).
 * There the same copy rides on a native `title` instead.
 */
export function PartlyLoadedBadge({ inTable = false }: { inTable?: boolean }) {
  if (inTable) {
    return (
      <Badge variant="warning" title={EXPLANATION}>
        Partly loaded
      </Badge>
    );
  }
  return (
    <Tooltip content={EXPLANATION} side="top">
      <Badge variant="warning">Partly loaded</Badge>
    </Tooltip>
  );
}
