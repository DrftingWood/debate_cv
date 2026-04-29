import { describe, expect, test } from 'vitest';
import { extractNavigation, parsePrivateUrlPage } from '@/lib/calicotab/parseNav';
import { collectRegistrationWarnings } from '@/lib/calicotab/provenance';

const BASE = 'https://example.calicotab.com/demo2026/privateurls/abcd1234/';
const HOST_BASE = 'https://example.calicotab.com/demo2026/';

// A realistic landing page: the visible labels are NOT the exact strings the
// old label-based matcher expected ("Team Tab" / "Speaker Tab"). Everyday
// Tabbycat deployments render "Team Standings" / "Speaker Standings" / "All
// Participants" etc., but the underlying href paths are the stable convention
// we now match on.
const REAL_LABELS_HTML = `
<html>
  <head><title>Demo Open 2026 | Private URL</title></head>
  <body>
    <nav>
      <a href="/demo2026/">Site Home</a>
      <a href="/demo2026/tab/team/">Team Standings</a>
      <a href="/demo2026/tab/speaker/">Speaker Standings</a>
      <a href="/demo2026/tab/motions/">Motions</a>
      <a href="/demo2026/results/round/1/">Round 1 results</a>
      <a href="/demo2026/results/round/2/">Round 2 results</a>
      <a href="/demo2026/results/round/3/">Round 3 results</a>
      <a href="/demo2026/results/round/4/">Round 4</a>
      <a href="/demo2026/results/round/5/">Round 5</a>
      <a href="/demo2026/break/teams/open/">Open break</a>
      <a href="/demo2026/break/adjudicators/">Judge break</a>
      <a href="/demo2026/participants/list/">All participants</a>
      <a href="/demo2026/participants/institutions/">Institutions</a>
    </nav>
    <h1>Private URL for A B</h1>
  </body>
</html>
`;

// A private page with zero nav links. The old parser would yield a nav with
// everything null and the ingest would write an empty tournament. The new
// parser constructs the canonical tab URLs from the tournament slug so the
// ingest can still try to fetch them — and records the fallback in the
// provenance warnings.
const BLANK_NAV_HTML = `
<html>
  <head><title>Demo Open 2026 | Private URL</title></head>
  <body>
    <h1>Private URL for A B</h1>
    <p>Team name: Some Team</p>
  </body>
</html>
`;

describe('extractNavigation — real-world labels', () => {
  const nav = extractNavigation(REAL_LABELS_HTML, BASE);

  test('discovers team and speaker tabs by href path', () => {
    expect(nav.teamTab).toBe(`${HOST_BASE}tab/team/`);
    expect(nav.speakerTab).toBe(`${HOST_BASE}tab/speaker/`);
    expect(nav.motionsTab).toBe(`${HOST_BASE}tab/motions/`);
  });

  test('collects every round URL regardless of label wording', () => {
    expect(nav.resultsRounds).toHaveLength(5);
    expect(nav.resultsRounds).toContain(`${HOST_BASE}results/round/1/`);
    expect(nav.resultsRounds).toContain(`${HOST_BASE}results/round/5/`);
  });

  test('collects both team-open and adjudicator break pages', () => {
    expect(nav.breakTabs).toHaveLength(2);
    expect(nav.breakTabs).toContain(`${HOST_BASE}break/teams/open/`);
    expect(nav.breakTabs).toContain(`${HOST_BASE}break/adjudicators/`);
  });

  test('finds participants list + institutions by path', () => {
    expect(nav.participants).toBe(`${HOST_BASE}participants/list/`);
    expect(nav.institutions).toBe(`${HOST_BASE}participants/institutions/`);
  });

  test('does not mark anything as constructed when every link was on the page', () => {
    expect(nav.meta.constructed).toEqual([]);
    expect(nav.meta.discovered).toContain('teamTab');
    expect(nav.meta.discovered).toContain('speakerTab');
    expect(nav.meta.discovered).toContain('participants');
  });
});

describe('extractNavigation — blank nav falls back to constructed URLs', () => {
  const nav = extractNavigation(BLANK_NAV_HTML, BASE);

  test('synthesises canonical paths for the three core tabs', () => {
    expect(nav.teamTab).toBe(`${HOST_BASE}tab/team/`);
    expect(nav.speakerTab).toBe(`${HOST_BASE}tab/speaker/`);
    expect(nav.participants).toBe(`${HOST_BASE}participants/list/`);
  });

  test('marks the fallback tabs as constructed so ParserRun can record it', () => {
    expect(nav.meta.constructed.sort()).toEqual(
      ['participants', 'speakerTab', 'teamTab'].sort(),
    );
    expect(nav.meta.discovered).toEqual([]);
  });

  test('leaves round/break URLs empty since we cannot construct them without N', () => {
    expect(nav.resultsRounds).toEqual([]);
    expect(nav.breakTabs).toEqual([]);
  });
});

describe('collectRegistrationWarnings reflects nav state', () => {
  test('real-labels page produces no nav warnings', () => {
    const snapshot = parsePrivateUrlPage(REAL_LABELS_HTML, BASE);
    const warnings = collectRegistrationWarnings(snapshot);
    expect(warnings.some((w) => w.includes('teamTab'))).toBe(false);
    expect(warnings.some((w) => w.includes('speakerTab'))).toBe(false);
    expect(warnings.some((w) => w.includes('participants'))).toBe(false);
  });

  test('blank-nav page records "constructed as fallback" for each core tab', () => {
    const snapshot = parsePrivateUrlPage(BLANK_NAV_HTML, BASE);
    const warnings = collectRegistrationWarnings(snapshot);
    expect(warnings).toContain('nav: teamTab constructed as fallback');
    expect(warnings).toContain('nav: speakerTab constructed as fallback');
    expect(warnings).toContain('nav: participants constructed as fallback');
    expect(warnings).toContain('nav: resultsRounds not found');
    expect(warnings).toContain('nav: breakTabs not found (optional)');
  });
});
