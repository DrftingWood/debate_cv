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
  const snapshot: RegistrationSnapshot = {
    personName: null,
    teamName: null,
    speakers: [],
    institution: null,
  };

  const personMatch = html.match(/Private URL\s+for\s+([^<(]+?)\s*\(([^)]+)\)/i);
  if (personMatch) {
    snapshot.personName = cleanWhitespace(personMatch[1]!);
    snapshot.teamName = cleanWhitespace(personMatch[2]!);
  }

  const teamMatch = html.match(/Team name:\s*([^<\n\r]+)/i);
  if (teamMatch) snapshot.teamName = cleanWhitespace(teamMatch[1]!);

  const speakersMatch = html.match(/Speakers:\s*([^<\n\r]+)/i);
  if (speakersMatch) {
    snapshot.speakers = speakersMatch[1]!
      .split(',')
      .map((x) => cleanWhitespace(x))
      .filter(Boolean);
  }

  const instMatch = html.match(/Institution:\s*([^<\n\r]+)/i);
  if (instMatch) snapshot.institution = cleanWhitespace(instMatch[1]!);

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
