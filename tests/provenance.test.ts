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
    <a href="/eo2026/results/round/1/">Round 1</a>
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
    expect(warnings).toContain('missing: navigation.teamTab');
    expect(warnings).toContain('missing: navigation.speakerTab');
    expect(warnings).toContain('missing: navigation.resultsRounds');
  });
});

describe('PARSER_VERSION', () => {
  test('follows the YYYYMMDD.N format', () => {
    expect(PARSER_VERSION).toMatch(/^\d{8}\.\d+$/);
  });
});
