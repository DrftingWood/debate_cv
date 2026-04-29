import * as cheerio from 'cheerio';
import { extractVueData, type VueCell, type VueTable } from './parseTabs';

export type NavigationStructure = {
  home: string | null;
  teamTab: string | null;
  speakerTab: string | null;
  motionsTab: string | null;
  resultsRounds: string[];
  /**
   * URL → human round label as it appears in the landing-page navigation.
   * The link text in the nav (e.g. "Round 1", "Quarterfinals", "U16
   * Semifinals") is the authoritative source for what each `/results/round/N/`
   * URL is actually called by the tournament — Tabbycat installs route both
   * prelims and outrounds through the same URL pattern, so the page heading
   * alone can't tell us. Parsers that fetch round results read this map to
   * canonically label the round.
   */
  resultsRoundLabels: Record<string, string>;
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
    resultsRoundLabels: {},
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
      // Capture the link text as the round's authoritative label. Same URL
      // can appear in multiple nav sections (e.g. dropdown + sidebar) — keep
      // the first non-empty label so we don't lose a "Quarterfinals" in
      // favour of a later empty link.
      const linkText = cleanWhitespace($(el).text());
      if (linkText && !nav.resultsRoundLabels[absolute]) {
        nav.resultsRoundLabels[absolute] = linkText;
      }
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

  // 3. <small>for Name</small> form — modern Tabbycat splits the heading
  //    so "Private URL" lives in a parent <h1>/<header>/<div class="card-header">
  //    and the participant name lives in a child or sibling
  //    <small class="text-muted ...">for Abhishek Acharya</small>. Branches 1
  //    and 2 don't catch this when the parent isn't an h-tag whose flattened
  //    text contains "Private URL for X". Match any <small> whose text is
  //    exactly "for Name" (with optional period). When the small includes a
  //    "(Team Name)" suffix — "for Abhishek Acharya (Some Team)" — strip it
  //    out of the name and use it as the team if we don't have one yet.
  if (!snapshot.personName) {
    $('small').each((_i, el) => {
      if (snapshot.personName) return;
      const text = cleanWhitespace($(el).text());
      const m = text.match(/^for\s+(.+?)\s*\.?$/i);
      if (!m) return;
      let name = cleanWhitespace(m[1]!);
      const teamMatch = name.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (teamMatch) {
        name = cleanWhitespace(teamMatch[1]!);
        if (!snapshot.teamName) snapshot.teamName = cleanWhitespace(teamMatch[2]!);
      }
      snapshot.personName = name;
    });
  }

  // 4. Label-value pairs ("Team name: X", "Speakers: X, Y", "Institution: X")
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
 * Map a Tabbycat stage cell — possibly already canonical ("Round 1",
 * "Quarterfinals"), possibly an abbreviation ("R1", "QF") — to a canonical
 * form so every downstream consumer (classifier, dedup keys, schema rows,
 * UI labels) sees one vocabulary regardless of which Tabbycat HTML variant
 * produced it.
 *
 * The "R\d+" form arises when the round cell is just
 *   <span class="tooltip-trigger">R1</span>
 * with no enclosing `<div data-original-title="Round 1">`. Without
 * normalization the bare "R1" makes `roundNumber` null (so prelims look
 * like outrounds) and bypasses `classifyRoundLabel`'s inround patterns
 * (so chair counts come out 0).
 *
 * Inputs that already match the canonical form pass through unchanged —
 * the test fixtures with `data-original-title="Round 1"` keep working.
 */
export function normalizeStageLabel(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  const rMatch = t.match(/^R(\d+)$/i);
  if (rMatch) return `Round ${Number(rMatch[1])}`;
  const lower = t.toLowerCase();
  // Order matters: longer prefixes first so "DOF" doesn't match "F" first.
  if (/^gf$/i.test(t)) return 'Grand Final';
  if (/^sf$/i.test(t) || lower === 'semis') return 'Semifinals';
  if (/^qf$/i.test(t) || lower === 'quarters') return 'Quarterfinals';
  if (/^dof$/i.test(t) || lower === 'doubles') return 'Double Octofinals';
  if (/^tof$/i.test(t) || lower === 'triples') return 'Triple Octofinals';
  if (/^of$/i.test(t) || lower === 'octos') return 'Octofinals';
  if (/^f$/i.test(t)) return 'Final';
  return t;
}

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
type CheerioRoot = ReturnType<typeof cheerio.load>;
type CheerioSel = ReturnType<CheerioRoot>;

/**
 * Locate the "Debates" card's <table>. Tabbycat names the surrounding card
 * inconsistently across themes ("Debates", "My Debates", "Schedule",
 * "Panels"…) so we accept several headings; structural fallback finds any
 * table whose <tbody> has the trademark `<td class="adjudicator-name">` cell
 * — the same table that lists rooms for both the speaker and judge views.
 */
function findDebatesTable($: CheerioRoot): CheerioSel | null {
  let table: CheerioSel | null = null;
  $('h1.card-title, h2.card-title, h3.card-title, h4.card-title, h5.card-title').each(
    (_i, el) => {
      if (table) return;
      const text = cleanWhitespace($(el).text()).toLowerCase();
      if (
        /^(?:my\s+|your\s+)?debates?$/.test(text) ||
        /^(?:my\s+|your\s+)?rounds?$/.test(text) ||
        /^schedule$/.test(text) ||
        /^panel(?:s|\s+history)?$/.test(text) ||
        /round\s+assignments?/.test(text)
      ) {
        const card = $(el).closest('.card-body, .card');
        const t = card.find('table').first();
        if (t.length > 0) table = t;
      }
    },
  );
  if (!table) {
    $('table').each((_i, t) => {
      if (table) return;
      const $t = $(t);
      if (
        $t.find('tbody td.adjudicator-name').length > 0 ||
        $t.find('tbody td.team-name').length > 0
      ) table = $t;
    });
  }
  return table;
}

function tableHeaderTexts($: CheerioRoot, table: CheerioSel): string[] {
  return table
    .find('thead th')
    .toArray()
    .map((th) => cleanWhitespace($(th).text()).toLowerCase());
}

function isSpeakerPrivateHtmlDebatesTable($: CheerioRoot, table: CheerioSel): boolean {
  const headers = tableHeaderTexts($, table);
  if (headers.length === 0) return false;
  const hasHeader = (needle: string) => headers.some((header) => header.includes(needle));
  const hasSpeakerColumns = hasHeader('result') && hasHeader('speak') && hasHeader('side');
  if (!hasSpeakerColumns) return false;

  const hasTeamPositionColumns = headers.some((header) =>
    /^(og|oo|cg|co|prop|opp|aff|neg|team)\b/i.test(header),
  );
  const hasSpeakerBallot = table.find('tbody a[href*="/speaker/"]').length > 0;
  return hasSpeakerBallot || !hasTeamPositionColumns;
}

/**
 * Pull the canonical stage label + numeric round (if applicable) from the
 * leftmost cell of a Debates-table row. Returns null when the row has no
 * recognisable stage marker (header rows, separators).
 */
function extractRowStage(
  $: CheerioRoot,
  $tr: CheerioSel,
): { stage: string; roundNumber: number | null } | null {
  const roundCell = $tr.find('td').first();
  const tooltipDiv = roundCell.find('[data-original-title]').first();
  let stage = '';
  if (tooltipDiv.length > 0) {
    stage = cleanWhitespace(tooltipDiv.attr('data-original-title') ?? '');
  }
  if (!stage) {
    stage = cleanWhitespace(roundCell.find('.tooltip-trigger').first().text());
  }
  if (!stage) return null;
  stage = normalizeStageLabel(stage);
  const roundMatch = stage.match(/^Round\s+(\d+)$/i);
  return { stage, roundNumber: roundMatch ? Number(roundMatch[1]) : null };
}

function stageInfoFromLabel(raw: string | null | undefined): { stage: string; roundNumber: number | null } | null {
  const text = cleanWhitespace(raw ?? '');
  if (!text) return null;
  const stage = normalizeStageLabel(text);
  const roundMatch = stage.match(/^Round\s+(\d+)$/i);
  return { stage, roundNumber: roundMatch ? Number(roundMatch[1]) : null };
}

function findDebatesVueTable(html: string): VueTable | null {
  const tables = extractVueData(html);
  if (!tables) return null;
  return (
    tables.find((table) => cleanWhitespace(table.title ?? '').toLowerCase() === 'debates') ??
    tables.find((table) =>
      table.head?.some((h) => (h.key ?? h.title ?? '').toLowerCase().includes('adjudicator')),
    ) ??
    null
  );
}

function vueColumn(table: VueTable, ...needles: string[]): number {
  return table.head.findIndex((h) => {
    const key = (h.key ?? '').toLowerCase();
    const title = (h.title ?? '').toLowerCase();
    const tooltip = (h.tooltip ?? '').toLowerCase();
    return needles.some((n) => key.includes(n) || title.includes(n) || tooltip.includes(n));
  });
}

function vueCellText(cell: VueCell | undefined): string {
  return String(cell?.text ?? '').replace(/\s+/g, ' ').trim();
}

function extractOwnerRoleFromAdjHtml(
  adjHtml: string,
  knownPersonName?: string | null,
): 'chair' | 'panellist' | 'trainee' | null {
  const $ = cheerio.load(`<div>${adjHtml}</div>`);
  const wantedNorm = knownPersonName
    ? cleanWhitespace(knownPersonName).toLowerCase()
    : '';

  let ownerEl = $('strong').first();
  let ownerSymbolText = '';
  if (ownerEl.length > 0) {
    ownerSymbolText = cleanWhitespace(ownerEl.find('.adj-symbol').text());
  } else if (wantedNorm) {
    const wantedTokens = wantedNorm.split(/\s+/).filter(Boolean);
    const wantedTokenSet = new Set(wantedTokens);
    const candidates = $('span.d-inline').toArray();
    const fallbackCandidates = candidates.length > 0 ? candidates : $('span').toArray();
    for (const el of fallbackCandidates) {
      const $el = $(el);
      const symbol = $el.find('.adj-symbol');
      const symbolText = cleanWhitespace(symbol.text());
      const plainText = cleanWhitespace(
        $el
          .clone()
          .find('.adj-symbol')
          .remove()
          .end()
          .text(),
      ).toLowerCase();
      if (!plainText) continue;

      let matched = plainText === wantedNorm;
      if (!matched && wantedTokens.length >= 2) {
        matched = plainText.includes(wantedNorm) || wantedNorm.includes(plainText);
        if (!matched) {
          const cellTokens = plainText.split(/\s+/).filter(Boolean);
          if (cellTokens.length >= 2) {
            const cellTokenSet = new Set(cellTokens);
            const wantedAllInCell = wantedTokens.every((t) => cellTokenSet.has(t));
            const cellAllInWanted = cellTokens.every((t) => wantedTokenSet.has(t));
            matched = wantedAllInCell || cellAllInWanted;
          }
        }
      }
      if (matched) {
        ownerEl = $el;
        ownerSymbolText = symbolText;
        break;
      }
    }
  }
  if (ownerEl.length === 0) return null;

  if (ownerSymbolText.includes('Ⓒ') || ownerSymbolText.includes('â’¸') || /chair/i.test(ownerSymbolText)) {
    return 'chair';
  }
  if (ownerSymbolText.includes('Ⓣ') || ownerSymbolText.includes('â“‰') || /trainee/i.test(ownerSymbolText)) {
    return 'trainee';
  }
  return 'panellist';
}

function extractAdjudicatorRoundsFromVue(
  html: string,
  knownPersonName?: string | null,
): AdjudicatorRound[] | null {
  const table = findDebatesVueTable(html);
  if (!table?.data?.length) return null;
  const roundCol = vueColumn(table, 'round');
  const adjCol = vueColumn(table, 'adjudicator', 'judge');
  if (adjCol < 0) return null;

  const rows: AdjudicatorRound[] = [];
  table.data.forEach((row, idx) => {
    const stageCell = roundCol >= 0 ? row[roundCol] : row[0];
    const stageInfo = stageInfoFromLabel(stageCell?.tooltip ?? stageCell?.text ?? null);
    if (!stageInfo) return;
    const role = extractOwnerRoleFromAdjHtml(vueCellText(row[adjCol]), knownPersonName);
    if (!role) return;
    rows.push({
      stage: stageInfo.stage,
      roundNumber: stageInfo.roundNumber,
      role,
      sequenceIndex: idx + 1,
    });
  });
  return rows.length > 0 ? rows : null;
}

/**
 * Pull the URL owner's per-round judging history from the "Debates" card.
 *
 * Identifies the URL owner in each row's `<td class="adjudicator-name">` via
 * one of two strategies, in order of confidence:
 *   1. `<strong>` wrapper around their name — Tabbycat's default markup,
 *      which doubles as the chair-symbol container.
 *   2. Text match against `knownPersonName` (typically the registration
 *      person's name from the same landing page). Themes that don't bold
 *      the URL owner — or partial private-URL pages without `<strong>` at
 *      all — still produce data this way. Falls through silently when
 *      `knownPersonName` isn't supplied.
 *
 * Role detection (chair / panellist / trainee) requires the `<i class="adj-symbol">`
 * marker, which Tabbycat appends to the owner's own name. Path 2 picks up
 * the symbol the same way as path 1 — chair detection works in both.
 */
export function extractAdjudicatorRounds(
  html: string,
  knownPersonName?: string | null,
): AdjudicatorRound[] {
  const vueRows = extractAdjudicatorRoundsFromVue(html, knownPersonName);
  if (vueRows) return vueRows;

  const $ = cheerio.load(html);
  const table = findDebatesTable($);
  if (!table) return [];

  const wantedNorm = knownPersonName
    ? cleanWhitespace(knownPersonName).toLowerCase()
    : '';

  const rows: AdjudicatorRound[] = [];
  table.find('tbody > tr').each((idx, tr) => {
    const $tr = $(tr);
    const stageInfo = extractRowStage($, $tr);
    if (!stageInfo) return;

    // Adjudicator cell — the <td class="adjudicator-name"> that lists the
    // panel. <strong> wraps the URL owner's own name; the chair marker is an
    // <i class="adj-symbol"> child.
    const adjCell = $tr.find('td.adjudicator-name').first();
    if (adjCell.length === 0) return;

    // Path 1: Tabbycat's <strong> marker. Path 2: name-substring match
    // against the registration name. We do path 2 only when path 1 misses
    // so the existing behavior is preserved for tournaments where the
    // marker is present.
    let ownerEl = adjCell.find('strong').first();
    let ownerSymbolText = '';
    if (ownerEl.length > 0) {
      ownerSymbolText = cleanWhitespace(ownerEl.find('.adj-symbol').text());
    } else if (wantedNorm) {
      // Walk each separator-delimited adjudicator entry inside the cell —
      // typically each is its own <span class="d-inline">. Match strategies,
      // most-confident first:
      //   1. Exact equality after lowercasing/whitespace-collapse.
      //   2. Substring containment in either direction (handles trailing
      //      institution suffixes like "Name (Inst.)" trimmed inconsistently).
      //   3. Token-set match: when both names have at least two tokens and
      //      every token of one appears in the other, accept. Catches the
      //      "Abhishek Acharya" ↔ "Abhishek Lalatendu Acharya" middle-name
      //      gap that strict-substring misses, without false-matching judges
      //      who only share a first name.
      const wantedTokens = wantedNorm.split(/\s+/).filter(Boolean);
      const wantedTokenSet = new Set(wantedTokens);
      const candidates = adjCell.find('span.d-inline').toArray();
      const fallbackCandidates = candidates.length > 0
        ? candidates
        : adjCell.find('span').toArray();
      for (const el of fallbackCandidates) {
        const $el = $(el);
        const symbol = $el.find('.adj-symbol');
        const symbolText = cleanWhitespace(symbol.text());
        const plainText = cleanWhitespace(
          $el
            .clone()
            .find('.adj-symbol')
            .remove()
            .end()
            .text(),
        ).toLowerCase();
        if (!plainText) continue;

        // Equality is always safe. Substring + token-set both require at
        // least 2 tokens in the wanted name so a bare first name doesn't
        // false-match a different judge's full name.
        let matched = plainText === wantedNorm;
        if (!matched && wantedTokens.length >= 2) {
          matched =
            plainText.includes(wantedNorm) ||
            wantedNorm.includes(plainText);
          if (!matched) {
            const cellTokens = plainText.split(/\s+/).filter(Boolean);
            if (cellTokens.length >= 2) {
              const cellTokenSet = new Set(cellTokens);
              const wantedAllInCell = wantedTokens.every((t) => cellTokenSet.has(t));
              const cellAllInWanted = cellTokens.every((t) => wantedTokenSet.has(t));
              matched = wantedAllInCell || cellAllInWanted;
            }
          }
        }
        if (matched) {
          ownerEl = $el;
          ownerSymbolText = symbolText;
          break;
        }
      }
    }
    if (ownerEl.length === 0) return; // owner not on this panel — skip

    let role: 'chair' | 'panellist' | 'trainee' = 'panellist';
    if (ownerSymbolText.includes('Ⓒ') || /chair/i.test(ownerSymbolText)) role = 'chair';
    else if (ownerSymbolText.includes('Ⓣ') || /trainee/i.test(ownerSymbolText)) role = 'trainee';

    rows.push({
      stage: stageInfo.stage,
      roundNumber: stageInfo.roundNumber,
      role,
      sequenceIndex: idx + 1,
    });
  });

  return rows;
}

export type SpeakerRound = {
  /** Full stage label as Tabbycat shows it: "Round 1", "Quarterfinals", etc. */
  stage: string;
  /** Numeric prelim round number when the stage is "Round N"; null for outrounds. */
  roundNumber: number | null;
  /** 1-based document order of the row in the "Debates" table. */
  sequenceIndex: number;
  /**
   * Whether the user's team won this round. Detected from win indicators
   * Tabbycat renders next to the team name on the user's own Debates card
   * (green up-arrow icon, `text-success` modifier, "winner" / "won" class,
   * or trophy/check icons). Null when no signal could be read either way
   * — e.g. on stages that don't render an indicator at all, or older
   * Tabbycat versions whose markup we don't recognise.
   */
  won: boolean | null;
};

/**
 * Detect a win indicator on the user's team cell from a Tabbycat Debates
 * card. On outround stages Tabbycat adds a directional icon
 * (`.bi-arrow-up-square` for advancement, `.bi-arrow-down-square` for
 * elimination, occasionally a trophy/check) next to the team that won
 * that debate. Only icon-class signals count: bare colour classes
 * (`text-success`, `bg-danger`) and bare words (`won`, `winner`,
 * `lost`, `eliminated`) used to count too, but those produced
 * false-positive Champion markers when the team-name cell had
 * non-result styling — a green-coloured wins/losses badge, an
 * "advanced N teams" tooltip, etc. Tightened to icons only so a stray
 * `text-success` on the cell can't flip a runner-up to a champion.
 * Returns true on a positive signal, false on an explicit loss signal,
 * null when neither is present (caller treats null as "unknown").
 */
function detectWonFromCellHtml(cellHtml: string): boolean | null {
  const lower = cellHtml.toLowerCase();
  if (
    /\b(bi-arrow-up|fa-arrow-up|bi-trophy|fa-trophy|bi-check-circle|fa-check-circle)/.test(lower)
  ) {
    return true;
  }
  if (
    /\b(bi-arrow-down|fa-arrow-down|bi-x-circle|fa-x-circle|bi-x-square|fa-x)/.test(lower)
  ) {
    return false;
  }
  return null;
}

/**
 * Pull the URL owner's per-round speaking history from the "Debates" card on
 * a speaker's private-URL landing page.
 *
 * Same table as `extractAdjudicatorRounds` — Tabbycat reuses one card on
 * every private URL; the only difference is which cell highlights the owner.
 * For speakers, the owner's TEAM name appears in one of the team-name cells
 * (`<td class="team-name">`). Two ways to identify it, in order:
 *   1. `<strong>` wrapper inside a team-name cell — Tabbycat's convention,
 *      mirrors how it bolds the adjudicator's name in the panel.
 *   2. Text match against `knownTeamName` (typically pulled from the
 *      registration snippet on the same landing page). This is the fallback
 *      for themes that omit the bold marker.
 *
 * Returns one entry per debate row the team was in, in document order.
 */
/**
 * Decide whether a team-name cell text refers to the URL owner's team.
 *
 * Tabbycat sometimes renders team names with a trailing team-number suffix
 * to disambiguate multiple teams from the same institution: registration
 * says "MIT Debate A" while the Debates table shows "MIT Debate A 1".
 * Strict equality misses this.
 *
 * Match strategy, in order of confidence:
 *   1. Exact equality (whitespace + case-normalised).
 *   2. One name is a prefix of the other followed by " <digits>" — the
 *      Tabbycat team-number convention. Anything else (extra letters,
 *      punctuation, alternate suffix) is rejected as a different team.
 *
 * We deliberately DON'T attempt institution-prefix normalisation
 * ("MIT Debate A" ↔ "MIT A"); that requires a token-level rewrite that
 * risks false positives across teams with overlapping prefixes.
 */
function teamCellMatches(cellText: string, wantedTeam: string): boolean {
  if (!cellText || !wantedTeam) return false;
  if (cellText === wantedTeam) return true;
  const [shorter, longer] =
    cellText.length < wantedTeam.length
      ? [cellText, wantedTeam]
      : [wantedTeam, cellText];
  if (!longer.startsWith(shorter)) return false;
  // The trailing portion past the prefix must be exactly " <digits>" — the
  // team-number suffix. Anything else is a distinct team.
  const suffix = longer.slice(shorter.length);
  return /^\s+\d+\s*$/.test(suffix);
}

function isSpeakerPrivateVueDebatesTable(table: VueTable): boolean {
  const resultCol = vueColumn(table, 'result');
  const speaksCol = vueColumn(table, 'speaks', 'speaker score');
  const sideCol = vueColumn(table, 'side');
  const ballotCol = vueColumn(table, 'ballot');
  if (resultCol < 0 || speaksCol < 0 || sideCol < 0) return false;

  const hasSpeakerBallot =
    ballotCol >= 0 &&
    table.data.some((row) => {
      const link = row[ballotCol]?.link ?? '';
      return /\/speaker\/[^/]+\/?$/i.test(link) || /\/speaker\/[^/]+\/view\/?$/i.test(link);
    });

  const hasTeamPositionColumns = table.head.some((head) => {
    const label = `${head.key ?? ''} ${head.title ?? ''}`.toLowerCase();
    return /^(og|oo|cg|co|prop|opp|aff|neg|team)\b/i.test(label.trim());
  });

  return hasSpeakerBallot || !hasTeamPositionColumns;
}

function extractSpeakerRoundsFromVue(
  html: string,
  knownTeamName?: string | null,
): SpeakerRound[] | null {
  const table = findDebatesVueTable(html);
  if (!table?.data?.length) return null;
  const roundCol = vueColumn(table, 'round');
  const adjCol = vueColumn(table, 'adjudicator', 'judge');
  const wantedTeam = (knownTeamName ?? '').trim().toLowerCase();
  const speakerPrivateRowsAreOwned = isSpeakerPrivateVueDebatesTable(table);
  const rows: SpeakerRound[] = [];

  table.data.forEach((row, idx) => {
    const stageCell = roundCol >= 0 ? row[roundCol] : row[0];
    const stageInfo = stageInfoFromLabel(stageCell?.tooltip ?? stageCell?.text ?? null);
    if (!stageInfo) return;

    let ownedCellRaw: string | null = null;
    let ownedCellClass: string | null = null;
    const owned =
      speakerPrivateRowsAreOwned ||
      row.some((cell, cellIdx) => {
        if (cellIdx === roundCol || cellIdx === adjCol) return false;
        const cls = (cell?.class ?? '').toLowerCase();
        const header = (table.head[cellIdx]?.key ?? table.head[cellIdx]?.title ?? '').toLowerCase();
        if (!cls.includes('team-name') && !/^(og|oo|cg|co|prop|opp|aff|neg|team)/i.test(header)) return false;
        const raw = vueCellText(cell);
        if (/<strong\b/i.test(raw)) {
          ownedCellRaw = raw;
          ownedCellClass = cls;
          return true;
        }
        if (!wantedTeam) return false;
        const plain = cleanWhitespace(cheerio.load(`<div>${raw}</div>`).text()).toLowerCase();
        if (teamCellMatches(plain, wantedTeam)) {
          ownedCellRaw = raw;
          ownedCellClass = cls;
          return true;
        }
        return false;
      });
    if (!owned) return;

    // Win detection inspects both the cell html (icon classes, inline
    // win/loss markers) and the cell-wrapper class (some Tabbycat
    // versions paint `text-success` on the <td> itself rather than an
    // inner <i>). Either signal counts.
    const won = ownedCellRaw
      ? detectWonFromCellHtml(`${ownedCellRaw} ${ownedCellClass ?? ''}`)
      : null;

    rows.push({
      stage: stageInfo.stage,
      roundNumber: stageInfo.roundNumber,
      sequenceIndex: idx + 1,
      won,
    });
  });
  return rows.length > 0 ? rows : null;
}

export function extractSpeakerRounds(
  html: string,
  knownTeamName?: string | null,
): SpeakerRound[] {
  const vueRows = extractSpeakerRoundsFromVue(html, knownTeamName);
  if (vueRows) return vueRows;

  const $ = cheerio.load(html);
  const table = findDebatesTable($);
  if (!table) return [];

  const wantedTeam = (knownTeamName ?? '').trim().toLowerCase();
  const speakerPrivateRowsAreOwned = isSpeakerPrivateHtmlDebatesTable($, table);
  const rows: SpeakerRound[] = [];
  table.find('tbody > tr').each((idx, tr) => {
    const $tr = $(tr);
    const stageInfo = extractRowStage($, $tr);
    if (!stageInfo) return;

    const teamCells = $tr.find('td.team-name');
    if (teamCells.length === 0 && !speakerPrivateRowsAreOwned) return;

    let owned = speakerPrivateRowsAreOwned;
    let ownedCellHtml: string | null = null;
    if (!owned) {
      teamCells.each((_j, td) => {
        if (owned) return;
        const $td = $(td);
        if ($td.find('strong').length > 0) {
          owned = true;
          ownedCellHtml = $.html($td);
          return;
        }
        if (wantedTeam) {
          const cellText = cleanWhitespace($td.text()).toLowerCase();
          if (teamCellMatches(cellText, wantedTeam)) {
            owned = true;
            ownedCellHtml = $.html($td);
          }
        }
      });
    }
    if (!owned) return;
    // If the row was claimed via "speakerPrivateRowsAreOwned" (Tabbycat's
    // private-URL Debates table marks every row as owned implicitly), we
    // still need to find the team cell to read the win indicator. Fall
    // back to the first cell with a strong tag in that case.
    if (!ownedCellHtml) {
      const strongCells = $tr.find('td:has(strong)');
      if (strongCells.length > 0) ownedCellHtml = $.html(strongCells.first());
    }
    const won = ownedCellHtml ? detectWonFromCellHtml(ownedCellHtml) : null;

    rows.push({
      stage: stageInfo.stage,
      roundNumber: stageInfo.roundNumber,
      sequenceIndex: idx + 1,
      won,
    });
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
