import { describe, expect, it } from 'vitest';
import { scanErrorMessage } from '@/lib/ingest/scanErrorMessage';

describe('scanErrorMessage', () => {
  it('explains the cooldown instead of showing the bare code', () => {
    for (const msg of [scanErrorMessage(429, 'rate_limited'), scanErrorMessage(200, 'rate_limited'), scanErrorMessage(429, 'anything')]) {
      expect(msg).toMatch(/5 minutes/);
      expect(msg).not.toBe('rate_limited');
    }
  });

  it('passes every other error through unchanged', () => {
    expect(scanErrorMessage(401, 'unauthorized')).toBe('unauthorized');
    expect(scanErrorMessage(500, 'HTTP 500')).toBe('HTTP 500');
  });
});
