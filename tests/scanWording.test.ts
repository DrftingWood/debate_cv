import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// C78: the owner ruled the background Gmail scan is best-effort, not a
// promise. No user-facing page may state a fixed interval.
describe('background scan wording (C78)', () => {
  const privacy = readFileSync('app/(app)/privacy/page.tsx', 'utf8');
  it('does not promise a fixed scan interval', () => {
    expect(privacy).not.toMatch(/every 30\s+minutes/i);
  });
  it('says the background scan is best-effort', () => {
    expect(privacy).toMatch(/best-effort/i);
  });
});
