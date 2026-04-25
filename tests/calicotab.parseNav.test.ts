import { describe, expect, test } from 'vitest';
import { parsePrivateUrlPage } from '@/lib/calicotab/parseNav';

// Matches the fixture in tests/test_calicotab_parser.py (the Python source on main).
const SAMPLE_PRIVATE_HTML = `
<html>
  <head><title>ILNU RR 2026 | Private URL</title></head>
  <body>
    <a href="/ilnurr2026/">Site Home</a>
    <a href="/ilnurr2026/tab/team/">Team Tab</a>
    <a href="/ilnurr2026/tab/speaker/">Speaker Tab</a>
    <a href="/ilnurr2026/tab/motions/">Motions Tab</a>
    <a href="/ilnurr2026/results/round/1/">Round 1</a>
    <a href="/ilnurr2026/results/round/2/">Round 2</a>
    <a href="/ilnurr2026/results/round/6/">Grand Final</a>
    <a href="/ilnurr2026/break/teams/open/">Open</a>
    <a href="/ilnurr2026/break/adjudicators/">Adjudicators</a>
    <a href="/ilnurr2026/participants/list/">Participants</a>
    <a href="/ilnurr2026/participants/institutions/">Institutions</a>

    <p>Private URL for Abhishek Acharya (Viral Adidas Jacket Owners)</p>
    <p>Team name: Viral Adidas Jacket Owners</p>
    <p>Speakers: Shishir Jha, Abhishek Acharya</p>
    <p>Institution: Indira Gandhi National Open University</p>
  </body>
</html>
`;

describe('parsePrivateUrlPage', () => {
  const snapshot = parsePrivateUrlPage(
    SAMPLE_PRIVATE_HTML,
    'https://ilnuroundrobin.calicotab.com/ilnurr2026/privateurls/rbo1rd0g/',
  );

  test('extracts tournament name', () => {
    expect(snapshot.tournamentName).toBe('ILNU RR 2026');
  });

  test('extracts registration fields', () => {
    expect(snapshot.registration.personName).toBe('Abhishek Acharya');
    expect(snapshot.registration.teamName).toBe('Viral Adidas Jacket Owners');
    expect(snapshot.registration.speakers).toEqual(['Shishir Jha', 'Abhishek Acharya']);
    expect(snapshot.registration.institution).toBe('Indira Gandhi National Open University');
  });

  test('resolves navigation links absolutely', () => {
    expect(snapshot.navigation.teamTab).toBe(
      'https://ilnuroundrobin.calicotab.com/ilnurr2026/tab/team/',
    );
    expect(snapshot.navigation.speakerTab).toBe(
      'https://ilnuroundrobin.calicotab.com/ilnurr2026/tab/speaker/',
    );
    expect(snapshot.navigation.resultsRounds).toContain(
      'https://ilnuroundrobin.calicotab.com/ilnurr2026/results/round/1/',
    );
    expect(snapshot.navigation.resultsRounds).toContain(
      'https://ilnuroundrobin.calicotab.com/ilnurr2026/results/round/6/',
    );
    expect(snapshot.navigation.breakTabs).toContain(
      'https://ilnuroundrobin.calicotab.com/ilnurr2026/break/adjudicators/',
    );
    expect(snapshot.navigation.participants).toBe(
      'https://ilnuroundrobin.calicotab.com/ilnurr2026/participants/list/',
    );
  });
});

// Tabbycat's default private_url_landing template wraps the name in <strong>.
// The old regex-on-raw-HTML extractor missed this entirely, which is why real
// tournament URLs produced orphan tournaments (see issue reported 2026-04-24).
const WRAPPED_NAME_HTML = `
<html>
  <head><title>ILNU RR 2026 | Private URL</title></head>
  <body>
    <h1>Private URL for <strong>Abhishek Acharya</strong></h1>
    <p>Team name: <strong>Viral Adidas Jacket Owners</strong></p>
    <p>Speakers: Shishir Jha, <em>Abhishek Acharya</em></p>
    <p>Institution: <strong>Indira Gandhi National Open University</strong></p>
  </body>
</html>
`;

describe('parsePrivateUrlPage with inline-tag-wrapped registration', () => {
  const snapshot = parsePrivateUrlPage(
    WRAPPED_NAME_HTML,
    'https://ilnuroundrobin.calicotab.com/ilnurr2026/privateurls/rbo1rd0g/',
  );

  test('extracts name even when wrapped in <strong>', () => {
    expect(snapshot.registration.personName).toBe('Abhishek Acharya');
  });

  test('extracts team name when the value is wrapped in <strong>', () => {
    expect(snapshot.registration.teamName).toBe('Viral Adidas Jacket Owners');
  });

  test('extracts speakers when mixed inline formatting is present', () => {
    expect(snapshot.registration.speakers).toEqual(['Shishir Jha', 'Abhishek Acharya']);
  });

  test('extracts institution when wrapped in <strong>', () => {
    expect(snapshot.registration.institution).toBe(
      'Indira Gandhi National Open University',
    );
  });
});

const HEADING_WITH_TEAM_HTML = `
<html>
  <body>
    <h2>Private URL for <strong>Abhishek Acharya</strong> (<em>Viral Adidas</em>)</h2>
  </body>
</html>
`;

describe('parsePrivateUrlPage with heading + team in parens', () => {
  const snapshot = parsePrivateUrlPage(
    HEADING_WITH_TEAM_HTML,
    'https://example.calicotab.com/t/privateurls/abc/',
  );

  test('extracts both name and team from heading with wrapped spans', () => {
    expect(snapshot.registration.personName).toBe('Abhishek Acharya');
    expect(snapshot.registration.teamName).toBe('Viral Adidas');
  });
});

// Modern Tabbycat layout — "Private URL" lives in the parent header, the
// name is in a child <small class="text-muted ...">. Real markup from the
// SIDO 2026 deployment the user reported was failing preflight.
const SMALL_FOR_NAME_HTML = `
<html>
  <head><title>SIDO 2026 | Private URL</title></head>
  <body>
    <header class="mb-4">
      <h1 class="mb-1 d-md-inline">SIDO 2026</h1>
      <small class="text-muted d-md-inline d-block">
        for Abhishek Acharya

      </small>
    </header>
  </body>
</html>
`;

describe('parsePrivateUrlPage with <small>for Name</small> layout', () => {
  const snapshot = parsePrivateUrlPage(
    SMALL_FOR_NAME_HTML,
    'https://sido2026.calicotab.com/sido2026/privateurls/aaf1dxnm/',
  );

  test('extracts name when only "for X" is present in a <small>', () => {
    expect(snapshot.registration.personName).toBe('Abhishek Acharya');
  });
});

// Should NOT false-positive on prose containing the substring "for ".
const FOR_PROSE_HTML = `
<html><body>
  <p>This URL is for tournament directors only.</p>
  <small>for Abhishek Acharya</small>
</body></html>
`;

describe('parsePrivateUrlPage <small>for Name</small> branch is conservative', () => {
  const snapshot = parsePrivateUrlPage(FOR_PROSE_HTML, 'https://x.calicotab.com/t/privateurls/abc/');

  test('only matches small whose entire text is "for X" — picks the small, not the p', () => {
    expect(snapshot.registration.personName).toBe('Abhishek Acharya');
  });
});
