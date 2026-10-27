import { describe, expect, it } from 'vitest';
import {
  FULL_SCAN_CONFIRM_ACTION,
  FULL_SCAN_CONFIRM_TEXT,
  FULL_SCAN_LABEL,
  fullScanResultText,
  fullScanUnavailableText,
} from '@/lib/ingest/fullScanCopy';

describe('full scan copy', () => {
  it('labels the action and warns in the confirm step', () => {
    expect(FULL_SCAN_LABEL).toBe('Scan whole mailbox');
    expect(FULL_SCAN_CONFIRM_ACTION).toBe('Start full scan');
    expect(FULL_SCAN_CONFIRM_TEXT).toMatch(/re-read all your mail/i);
    expect(FULL_SCAN_CONFIRM_TEXT).toMatch(/may take a while/);
    expect(FULL_SCAN_CONFIRM_TEXT).toMatch(/once every 24 hours/);
  });
  it('states when it is available again', () => {
    expect(fullScanUnavailableText(5 * 3600_000 + 60_000, 0)).toBe(
      'Available again in 5 hours 1 minute. The whole-mailbox scan is limited to once every 24 hours.',
    );
  });
  it('reports results and truncation', () => {
    expect(fullScanResultText(1, 40, false)).toBe('Found 1 new private URL in 40 messages read.');
    expect(fullScanResultText(0, 600, true)).toContain('left for the next full scan');
  });
});
