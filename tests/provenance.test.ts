import { describe, expect, test } from 'vitest';
import { collectRegistrationWarnings } from '@/lib/calicotab/provenance';
import { parsePrivateUrlPage } from '@/lib/calicotab/parseNav';
import { PARSER_VERSION } from '@/lib/calicotab/version';

const COMPLETE_HTML = `
<html>
  <head><title>Example Open 2026 | Private URL</title></head>
  <body>
    <h1>Private URL for <strong>A B</strong></h1>
    <p>Team name: <strong>Team X</strong></p>
    <p>Speakers: A B, C D</p>
    <p>Institution: <strong>Foo U</strong></p>
    <a href="/eo2026/tab/team/">Team Tab</a>
    <a href="/eo2026/tab/speaker/">Speaker Tab</a>
    <a href="/eo2026/participants/list/">Participants</a>
    <a href="/eo2026/results/round/1/">Round 1</a>
    <a href="/eo2026/break/teams/open/">Open break</a>
  </body>
</html>
`;

const EMPTY_HTML = `<html><body><p>Hello world</p></body></html>`;

describe('collectRegistrationWarnings', () => {
  test('no warnings on a complete landing page', () => {
    const snapshot = parsePrivateUrlPage(COMPLETE_HTML, 'https://x.calicotab.com/eo2026/privateurls/a/');
    const warnings = collectRegistrationWarnings(snapshot);
    expect(warnings).toEqual([]);
  });

  test('emits warnings for every missing field on an empty page', () => {
    const snapshot = parsePrivateUrlPage(EMPTY_HTML, 'https://x.calicotab.com/eo2026/privateurls/a/');
    const warnings = collectRegistrationWarnings(snapshot);
    expect(warnings).toContain('missing: tournamentName');
    expect(warnings).toContain('missing: registration.personName');
    // The new nav matcher constructs canonical paths for the core tabs when
    // the page doesn't link to them. Those three fire the "constructed as
    // fallback" warning. Round and break pages cannot be constructed blindly
    // (we don't know how many rounds there are), so they stay "not found".
    expect(warnings).toContain('nav: teamTab constructed as fallback');
    expect(warnings).toContain('nav: speakerTab constructed as fallback');
    expect(warnings).toContain('nav: participants constructed as fallback');
    expect(warnings).toContain('nav: resultsRounds not found');
    expect(warnings).toContain('nav: breakTabs not found');
  });
});

describe('PARSER_VERSION', () => {
  test('follows the YYYYMMDD.N format', () => {
    expect(PARSER_VERSION).toMatch(/^\d{8}\.\d+$/);
  });
});
