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
  /**
   * Which links were discovered on the page (by URL path) vs which were
   * constructed from the tournament slug as a fallback. Writers of ParserRun
   * warnings consume this to distinguish "nav not linked" from "nav present".
   */
  meta: {
    discovered: string[]; // e.g. ["teamTab", "speakerTab", "resultsRounds"]
    constructed: string[]; // e.g. ["teamTab"] when the landing page had no nav
  };
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

/**
 * Extract Tabbycat navigation from a private-URL landing page.
 *
 * Strategy (in order, most-reliable first):
 *   1. **URL-path match** on every `<a href>`. Tabbycat's routes
 *      (`/tab/team/`, `/tab/speaker/`, `/results/round/<N>/`, `/break/...`,
 *      `/participants/list/`, `/participants/institutions/`) are stable
 *      across versions and themes — far more reliable than the visible link
 *      text which deployments freely rename ("Team Standings", "All
 *      Participants", etc.).
 *   2. **Label match** as a fallback — kept for exotic deployments that
 *      route tabs through intermediate landing pages.
 *   3. **Constructed fallback** when a core tab still has no link —
 *      synthesise `${baseTournamentUrl}<known-path>`. `safeFetch` in the
 *      ingest orchestrator returns null on 404, so a wrong guess costs one
 *      HTTP request; a right guess unblocks the entire ingest.
 */
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
    meta: { discovered: [], constructed: [] },
  };
  const baseHost = new URL(base).host;
  const discovered = new Set<string>();

  $('a').each((_i, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const absolute = absolutize(base, href);

    // Scope to the same tournament slug so external links don't leak in.
    let pathname: string;
    try {
      const u = new URL(absolute);
      if (u.host !== baseHost) return;
      pathname = u.pathname;
    } catch {
      return;
    }

    // --- URL-path matching (primary signal) ---
    if (/\/tab\/team(-standings)?\/?$/.test(pathname) || /\/tab\/overall\/?$/.test(pathname)) {
      if (!nav.teamTab) { nav.teamTab = absolute; discovered.add('teamTab'); }
    } else if (/\/tab\/speaker(-standings)?\/?$/.test(pathname)) {
      if (!nav.speakerTab) { nav.speakerTab = absolute; discovered.add('speakerTab'); }
    } else if (/\/tab\/motions\/?$/.test(pathname)) {
      if (!nav.motionsTab) { nav.motionsTab = absolute; discovered.add('motionsTab'); }
    } else if (/\/results\/round\/\d+\/?(?:by-team\/|by-debate\/)?$/.test(pathname)) {
      nav.resultsRounds.push(absolute);
      discovered.add('resultsRounds');
    } else if (/\/break\/[^/]+\/?/.test(pathname)) {
      nav.breakTabs.push(absolute);
      discovered.add('breakTabs');
    } else if (/\/participants\/list\/?$/.test(pathname)) {
      if (!nav.participants) { nav.participants = absolute; discovered.add('participants'); }
    } else if (/\/participants\/institutions\/?$/.test(pathname)) {
      if (!nav.institutions) { nav.institutions = absolute; discovered.add('institutions'); }
    } else {
      // --- Label matching (fallback for non-conforming URLs) ---
      const label = cleanWhitespace($(el).text()).toLowerCase();
      if (!label) return;
      if (label === 'site home') nav.home = absolute;
      else if (label === 'team tab') {
        if (!nav.teamTab) { nav.teamTab = absolute; discovered.add('teamTab'); }
      } else if (label === 'speaker tab') {
        if (!nav.speakerTab) { nav.speakerTab = absolute; discovered.add('speakerTab'); }
      } else if (label === 'motions tab') {
        if (!nav.motionsTab) { nav.motionsTab = absolute; discovered.add('motionsTab'); }
      } else if (label === 'participants') {
        if (!nav.participants) { nav.participants = absolute; discovered.add('participants'); }
      } else if (label === 'institutions') {
        if (!nav.institutions) { nav.institutions = absolute; discovered.add('institutions'); }
      }
    }
  });

  nav.resultsRounds = Array.from(new Set(nav.resultsRounds)).sort();
  nav.breakTabs = Array.from(new Set(nav.breakTabs)).sort();

  // --- Constructed fallbacks (last resort) ---
  // For the three canonical tabs, synthesise the URL even when the landing
  // page didn't link to it. Tabbycat routes these paths consistently, so a
  // blank nav still yields a fetchable ingest.
  const constructed: string[] = [];
  if (!nav.teamTab) { nav.teamTab = `${base}tab/team/`; constructed.push('teamTab'); }
  if (!nav.speakerTab) { nav.speakerTab = `${base}tab/speaker/`; constructed.push('speakerTab'); }
  if (!nav.participants) { nav.participants = `${base}participants/list/`; constructed.push('participants'); }

  nav.meta = {
    discovered: Array.from(discovered),
    constructed,
  };
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

export type AdjudicatorRound = {
  /** Full stage label as Tabbycat shows it: "Round 1", "Quarterfinals", etc. */
  stage: string;
  /** Numeric prelim round number when the stage is "Round N"; null for outrounds. */
  roundNumber: number | null;
  /** Role the URL owner held on this debate, derived from the adj-symbol marker. */
  role: 'chair' | 'panellist' | 'trainee';
  /** 1-based document order of the row in the "Debates" table. */
  sequenceIndex: number;
};

/**
 * Pull the URL owner's per-round judging history from the "Debates" card on
 * the private-URL landing page.
 *
 * The card looks like:
 *   <h4 class="card-title">Debates</h4>
 *   <table>
 *     <tbody>
 *       <tr>
 *         <td><div data-original-title="Round 1"><span>R1</span>…</div></td>
 *         <td class="team-name">…OG…</td> … <td class="team-name">…CO…</td>
 *         <td class="adjudicator-name">
 *           <strong><span>Abhishek<i class="adj-symbol">Ⓒ</i></span></strong>,
 *           <span>Bea Legaspi</span>
 *         </td>
 *         <td>…motion…</td>
 *         <td>…ballot link…</td>
 *       </tr>
 *
 * Tabbycat wraps the URL owner's name in <strong> (so they can spot
 * themselves in the panel) and marks chairs with <i class="adj-symbol">Ⓒ</i>
 * appended to the name. Trainees use Ⓣ; everything else is a panellist.
 *
 * Rows are returned in document order, which equals the prelim sequence
 * (R1 → R2 → … → R6 → QF → SF → F).
 */
export function extractAdjudicatorRounds(html: string): AdjudicatorRound[] {
  const $ = cheerio.load(html);

  // Locate the "Debates" card by its card-title heading. Be lenient about
  // h-level and exact wording so newer Tabbycat versions don't quietly break.
  let table: ReturnType<typeof $> | null = null;
  $('h1.card-title, h2.card-title, h3.card-title, h4.card-title, h5.card-title').each(
    (_i, el) => {
      const text = cleanWhitespace($(el).text());
      if (
        /^debates$/i.test(text) ||
        /^your\s+debates$/i.test(text) ||
        /^your\s+rounds$/i.test(text)
      ) {
        const card = $(el).closest('.card-body, .card');
        const t = card.find('table').first();
        if (t.length > 0) table = t;
      }
    },
  );
  if (!table) return [];

  const rows: AdjudicatorRound[] = [];
  (table as ReturnType<typeof $>).find('tbody > tr').each((idx, tr) => {
    const $tr = $(tr);

    // Round cell — first <td>. The full stage name is in the
    // data-original-title attribute of the inner tooltip div; fall back to
    // the visible "R1"/"QF" abbreviation if that attribute is missing.
    const roundCell = $tr.find('td').first();
    const tooltipDiv = roundCell.find('[data-original-title]').first();
    let stage = '';
    if (tooltipDiv.length > 0) {
      stage = cleanWhitespace(tooltipDiv.attr('data-original-title') ?? '');
    }
    if (!stage) {
      stage = cleanWhitespace(roundCell.find('.tooltip-trigger').first().text());
    }
    if (!stage) return;

    const roundMatch = stage.match(/^Round\s+(\d+)$/i);
    const roundNumber = roundMatch ? Number(roundMatch[1]) : null;

    // Adjudicator cell — the <td class="adjudicator-name"> that lists the
    // panel. <strong> wraps the URL owner's own name; the chair marker is an
    // <i class="adj-symbol"> child.
    const adjCell = $tr.find('td.adjudicator-name').first();
    if (adjCell.length === 0) return;
    const userStrong = adjCell.find('strong').first();
    if (userStrong.length === 0) return; // owner not on this panel — skip

    const symbolText = cleanWhitespace(userStrong.find('.adj-symbol').text());
    let role: 'chair' | 'panellist' | 'trainee' = 'panellist';
    if (symbolText.includes('Ⓒ') || /chair/i.test(symbolText)) role = 'chair';
    else if (symbolText.includes('Ⓣ') || /trainee/i.test(symbolText)) role = 'trainee';

    rows.push({ stage, roundNumber, role, sequenceIndex: idx + 1 });
  });

  return rows;
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
