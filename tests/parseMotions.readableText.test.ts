import { describe, expect, test } from 'vitest';
import { parseMotionsTab } from '@/lib/calicotab/parseMotions';

/**
 * 2.11's card layout. Organisers paste rich text into the info slide, and
 * Tabbycat escapes it, so the page's own text reads "<div>Under a…" —
 * cjdo2026 — or carries a double-escaped "&amp;" — bristolopen24.
 */
function cardsPage(info: string): string {
  return `<html><body>
    <div class="list-group">
      <div class="list-group-item"><h4 class="card-title">Round 1</h4></div>
      <div class="list-group-item">
        <span class="badge">1</span>
        <p class="lead">THW pay lawyers by merit</p>
        <button>View Info Slide</button>
        <div class="modal"><div class="modal-body">${info}</div></div>
      </div>
    </div>
  </body></html>`;
}

describe('motion text as the audience reads it', () => {
  test('pasted markup in an info slide is not shown', () => {
    const [m] = parseMotionsTab(
      cardsPage('&lt;div&gt;Under a seniority-based compensation system&lt;/div&gt;'),
    );
    expect(m!.infoSlide).toBe('Under a seniority-based compensation system');
  });

  test('a double-escaped entity is shown once decoded', () => {
    const [m] = parseMotionsTab(cardsPage('Nuts &amp;amp; Taylor Swift'));
    expect(m!.infoSlide).toBe('Nuts & Taylor Swift');
  });

  test('the motion itself is untouched', () => {
    const [m] = parseMotionsTab(cardsPage('Plain slide'));
    expect(m!.text).toBe('THW pay lawyers by merit');
    expect(m!.roundLabel).toBe('Round 1');
  });
});
