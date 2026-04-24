import * as cheerio from 'cheerio';

export type NavigationStructure = {
  home: string | null;
  teamTab: string | null;
  speakerTab: string | null;
  motionsTab: string | null;
  resultsRounds: string[];
  breakTabs: string[];
  participants: string | null;
  institutions: string | null;
};

export type RegistrationSnapshot = {
  personName: string | null;
  teamName: string | null;
  speakers: string[];
  institution: string | null;
};

export type PrivateUrlSnapshot = {
  sourceUrl: string;
  tournamentName: string | null;
  navigation: NavigationStructure;
  registration: RegistrationSnapshot;
};

function baseTournamentUrl(sourceUrl: string): string {
  const u = new URL(sourceUrl);
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length === 0) return `${u.protocol}//${u.host}/`;
  return `${u.protocol}//${u.host}/${parts[0]}/`;
}

function cleanWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function extractTournamentName(title: string | null): string | null {
  if (!title) return null;
  const cleaned = cleanWhitespace(title);
  if (cleaned.includes('|')) return cleaned.split('|')[0]!.trim();
  return cleaned;
}

function absolutize(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

export function extractNavigation(html: string, sourceUrl: string): NavigationStructure {
  const $ = cheerio.load(html);
  const base = baseTournamentUrl(sourceUrl);
  const nav: NavigationStructure = {
    home: null,
    teamTab: null,
    speakerTab: null,
    motionsTab: null,
    resultsRounds: [],
    breakTabs: [],
    participants: null,
    institutions: null,
  };

  $('a').each((_i, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const label = cleanWhitespace($(el).text()).toLowerCase();
    const absolute = absolutize(base, href);

    if (label === 'site home') nav.home = absolute;
    else if (label === 'team tab') nav.teamTab = absolute;
    else if (label === 'speaker tab') nav.speakerTab = absolute;
    else if (label === 'motions tab') nav.motionsTab = absolute;
    else if (/^round\s+\d+/.test(label) || label.includes('final')) nav.resultsRounds.push(absolute);
    else if (label === 'open' || label === 'adjudicators') nav.breakTabs.push(absolute);
    else if (label === 'participants') nav.participants = absolute;
    else if (label === 'institutions') nav.institutions = absolute;
  });

  nav.resultsRounds = Array.from(new Set(nav.resultsRounds)).sort();
  nav.breakTabs = Array.from(new Set(nav.breakTabs)).sort();
  return nav;
}

export function extractRegistration(html: string): RegistrationSnapshot {
  const $ = cheerio.load(html);
  const snapshot: RegistrationSnapshot = {
    personName: null,
    teamName: null,
    speakers: [],
    institution: null,
  };

  // 1. Find "Private URL for <Name>" (with or without a team in parens) in any
  //    heading or paragraph. Using cheerio's .text() flattens inline children
  //    like <strong>Name</strong> so Tabbycat's default markup works.
  const candidates = $('h1, h2, h3, h4, h5, p').toArray();
  for (const el of candidates) {
    const text = cleanWhitespace($(el).text());
    if (!/Private URL\s+for\b/i.test(text)) continue;

    const withTeam = text.match(/^Private URL\s+for\s+(.+?)\s*\(([^)]+)\)\s*\.?\s*$/i);
    if (withTeam) {
      snapshot.personName = cleanWhitespace(withTeam[1]!);
      snapshot.teamName = cleanWhitespace(withTeam[2]!);
      break;
    }
    const nameOnly = text.match(/^Private URL\s+for\s+(.+?)\s*\.?\s*$/i);
    if (nameOnly) {
      snapshot.personName = cleanWhitespace(nameOnly[1]!);
      break;
    }
  }

  // 2. Greeting fallback ("Hi Abhishek", "Welcome, Abhishek!")
  if (!snapshot.personName) {
    for (const el of candidates) {
      const text = cleanWhitespace($(el).text());
      const m = text.match(/^(?:Hi|Hello|Welcome,?)\s+([A-Z][^,!.]{0,80}?)\s*[,!.]?\s*$/);
      if (m) {
        snapshot.personName = cleanWhitespace(m[1]!);
        break;
      }
    }
  }

  // 3. Label-value pairs ("Team name: X", "Speakers: X, Y", "Institution: X")
  //    each typically live in their own <p> / <li> / <dt> / <dd>, so we can
  //    scan those containers and flatten their text to sidestep inline tags.
  $('p, li, dd').each((_i, el) => {
    const text = cleanWhitespace($(el).text());
    if (!snapshot.teamName) {
      const m = text.match(/^Team name:\s*(.+)$/i);
      if (m) snapshot.teamName = cleanWhitespace(m[1]!);
    }
    if (snapshot.speakers.length === 0) {
      const m = text.match(/^Speakers?:\s*(.+)$/i);
      if (m) {
        snapshot.speakers = m[1]!
          .split(',')
          .map((x) => cleanWhitespace(x))
          .filter(Boolean);
      }
    }
    if (!snapshot.institution) {
      const m = text.match(/^Institution:\s*(.+)$/i);
      if (m) snapshot.institution = cleanWhitespace(m[1]!);
    }
  });

  return snapshot;
}

export function parsePrivateUrlPage(html: string, sourceUrl: string): PrivateUrlSnapshot {
  const $ = cheerio.load(html);
  const title = $('title').first().text();
  return {
    sourceUrl,
    tournamentName: extractTournamentName(title || null),
    navigation: extractNavigation(html, sourceUrl),
    registration: extractRegistration(html),
  };
}
