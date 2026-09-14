import { describe, expect, test } from 'vitest';
import { parseMotionsTab } from '@/lib/calicotab/parseMotions';

/**
 * Tabbycat 2.11 renders /motions/ as bootstrap cards, not a table and not a
 * Vue payload. The round label is an <h4> inside its own .list-group-item,
 * and the motions are SIBLINGS OF THAT DIV — not siblings of the heading —
 * which is why the existing heading-walk collected nothing: it looks at the
 * heading's own following siblings.
 *
 * Markup below is trimmed from https://mace.calicotab.com/bso2021/motions/.
 */
const CARD_PAGE = `
<html><body>
<div class="container-fluid">
  <div class="card mt-3">
    <div class="list-group list-group-flush">
      <div class="list-group-item pt-4">
        <h4 class="card-title mt-0 mb-2 d-inline-block">Round 1</h4>
      </div>
      <li class="list-group-item d-flex flex-column flex-md-row align-items-md-center">
        <div class="badge badge-info mr-3 d-none d-md-block">1</div>
        <div class="mr-auto pr-3 lead">THW abolish the monarchy.</div>
      </li>
      <li class="list-group-item d-flex flex-column flex-md-row align-items-md-center">
        <div class="badge badge-info mr-3 d-none d-md-block">2</div>
        <div class="mr-auto pr-3 lead">THBT sport should be apolitical.</div>
      </li>
    </div>
  </div>
  <div class="card mt-3">
    <div class="list-group list-group-flush">
      <div class="list-group-item pt-4">
        <h4 class="card-title mt-0 mb-2 d-inline-block">Grand Final</h4>
      </div>
      <li class="list-group-item d-flex flex-column flex-md-row align-items-md-center">
        <div class="badge badge-info mr-3 d-none d-md-block">1</div>
        <div class="mr-auto pr-3 lead">THW paint the full picture.</div>
        <button class="btn btn-sm btn-secondary btn-block">View Info Slide</button>
        <div class="modal">
          <div class="modal-body">Maya Angelou was a famous American poet.</div>
        </div>
      </li>
    </div>
  </div>
</div>
</body></html>`;

describe('parseMotionsTab — the 2.11 card layout', () => {
  const rows = parseMotionsTab(CARD_PAGE);

  test('finds every motion', () => {
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.text)).toEqual([
      'THW abolish the monarchy.',
      'THBT sport should be apolitical.',
      'THW paint the full picture.',
    ]);
  });

  test('attributes each motion to the round heading above it', () => {
    expect(rows.map((r) => r.roundLabel)).toEqual(['Round 1', 'Round 1', 'Grand Final']);
  });

  test('reads the prelim round number, and leaves outrounds null', () => {
    expect(rows[0]!.roundNumber).toBe(1);
    expect(rows[1]!.roundNumber).toBe(1);
    expect(rows[2]!.roundNumber).toBe(null);
  });

  test('keeps document order in seq', () => {
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 2]);
  });

  test('picks up an info slide when the motion has one', () => {
    expect(rows[0]!.infoSlide).toBe(null);
    expect(rows[2]!.infoSlide).toBe('Maya Angelou was a famous American poet.');
  });

  test('does not mistake the badge number for motion text', () => {
    for (const r of rows) expect(r.text).not.toMatch(/^\d+$/);
  });
});
