import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Found in the R7 browser check: TournamentsTable is a Server Component that
 * renders TabStatus, which hands Tooltip a render-prop (a function child).
 * React refuses a function across the server-to-client boundary, so the whole
 * Tournaments tab fell into the error boundary. A component that passes
 * Tooltip a function child therefore has to be a client component itself.
 * (The unit render tests run everything on one side of the boundary and cannot
 * see this, so the rule is pinned at the source.)
 */
describe('components that give Tooltip a function child', () => {
  it('are client components', () => {
    const source = readFileSync('components/admin/TabStatus.tsx', 'utf8');
    expect(source).toMatch(/^(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/)*\s*['"]use client['"]/);
  });
});
