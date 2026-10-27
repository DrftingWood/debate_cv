import { formatWait } from '@/lib/utils/formatWait';

/** Words for the whole-mailbox scan on Imports, in one place so tests can pin them. */
export const FULL_SCAN_LABEL = 'Scan whole mailbox';

export const FULL_SCAN_CONFIRM_TEXT =
  'Re-read all your mail? This looks through your whole mailbox for private URLs, may take a while, and can be done once every 24 hours.';

export const FULL_SCAN_CONFIRM_ACTION = 'Start full scan';

/** Visible reason shown while the button is aria-disabled. */
export function fullScanUnavailableText(availableAtMs: number, nowMs: number): string {
  const sec = Math.max(1, Math.ceil((availableAtMs - nowMs) / 1000));
  return `Available again in ${formatWait(sec)}. The whole-mailbox scan is limited to once every 24 hours.`;
}

export function fullScanResultText(found: number, scanned: number, truncated: boolean): string {
  const base = `Found ${found} new private ${found === 1 ? 'URL' : 'URLs'} in ${scanned} messages read.`;
  return truncated
    ? `${base} Your mailbox is large, so some mail was left for the next full scan.`
    : base;
}
