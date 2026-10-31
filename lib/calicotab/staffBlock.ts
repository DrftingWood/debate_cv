import * as cheerio from 'cheerio';
import { normalizePersonNameV2 } from '@/lib/calicotab/fingerprint';

/**
 * The "Tournament Staff" block on a tab's home page (the second source of an
 * adjudication core, beside the participants list's Adj Core column).
 *
 * It is free text typed by the tab director, so there is no markup to lean
 * on: the text is cut at its labels ("Tabulation:", "Core Adjudication
 * Panel:", "Chief Adjudicator:" ...) and the names under the core labels are
 * read.
 *
 * What counts as core is the owner's list (R10): CA, CAP, DCA, any "Core ..."
 * label, "Chief Adjudicator(s)", "Deputy Chief Adjudicator(s)" and plain
 * "Adjudication". Two rules keep a wrong role off a CV:
 *   - a core label must start a line or follow a separator, so a qualified
 *     label ("Non-Core Adjudication", "Equity Adjudication", "Appeals
 *     Adjudication Panel") is not read as the core; and
 *   - any other "Label:" ends a core list, on the same line or a later one,
 *     so "Core Adjudicators: [A, B] Equity Panel: [C, D]" gives A and B only.
 */

// Labels that name the adjudication core. Longest first, so "Core
// Adjudication Panel" is read whole and not as its tail "Adjudication".
const CORE_LABELS = [
  'deputy chief adjudicators?',
  'chief adjudicators?',
  'core adjudication panel',
  'core adjudicators?',
  'core adjudication',
  'adjudication core',
  'adjudication panel',
  'adjudication',
  'd?cap?s?',
  'core',
];

// Labels that are staff but not core; they only mark where a core list stops.
const OTHER_LABELS = [
  'tabulation team',
  'tabulation',
  'tab team',
  'tab directors?',
  'tab masters?',
  'organi[sz]ation',
  'organi[sz]ing committee',
  'org comm',
  'organi[sz]ers?',
  'equity panel',
  'equity team',
  'equity',
  'convenors?',
  'directors?',
  'technical',
  'volunteers?',
];

// Where a core label may start: the start of the text or of a line, or right
// after a separator (; | or an opening bracket). A label that follows other
// words is a qualified one and is not the core.
const CORE_START = new RegExp(
  String.raw`(?:^|[\n;|\[(])[ \t ]*(${CORE_LABELS.join('|')})[ \t ]*:`,
  'giud',
);
// A known non-core label ends a list wherever it stands.
const OTHER_ANYWHERE = new RegExp(String.raw`(?<![\p{L}])(${OTHER_LABELS.join('|')})\s*:`, 'giud');
// Any other "Label:" at a line start or after a separator or closing bracket
// also ends a list, known or not ("Organising Commitee:", "Catering:").
const ANY_LABEL = /(?:^|[\n;|\])])[ \t ]*([\p{L}][\p{L} /&'.-]{0,40}?)[ \t ]*:/dgiu;

/** Words that fill a staff line without naming anyone. */
const NOT_A_NAME = /^(?:tba|tbc|tbd|n\/?a|none|nil|-+|—+)$/iu;

export type StaffBlock = {
  /** Whether the page has a "Tournament Staff" block at all. */
  found: boolean;
  /** Names under the adjudication-core labels, in order, once each. */
  core: string[];
};

/** The block's text with line breaks kept; null when the page has none. */
export function staffBlockText(html: string): string | null {
  const $ = cheerio.load(html);
  $('script, style').remove();
  // Breaks and block ends become newlines before the text is read, so a
  // label on its own line stays on its own line.
  $('br').replaceWith('\n');
  $('p, div, li, dd, dt, tr, h1, h2, h3, h4, h5, h6').each((_, el) => {
    $(el).append('\n');
  });
  const heading = $('*')
    .filter((_, el) => {
      const own = $(el)
        .contents()
        .filter((_i, n) => n.nodeType === 3)
        .text();
      return /^\s*tournament staff\s*:?\s*$/i.test(own);
    })
    .first();
  if (heading.length > 0) {
    const card = heading.closest('.card, .panel, section, .list-group-item, .jumbotron, article');
    if (card.length > 0) {
      const rest = card.text().replace(/tournament staff\s*:?/i, '');
      if (rest.trim()) return rest;
    }
    // No enclosing card: the heading's following siblings, up to the next
    // heading, are the block.
    let text = '';
    for (const sib of heading.nextAll().toArray()) {
      if (/^h[1-6]$/i.test(sib.tagName)) break;
      text += `${$(sib).text()}\n`;
    }
    if (text.trim()) return text;
    return heading
      .parent()
      .text()
      .replace(/tournament staff\s*:?/i, '');
  }
  // A page that says it in running text: what follows the phrase.
  const body = $('body').text();
  const at = body.search(/tournament staff/i);
  return at < 0 ? null : body.slice(at + 'tournament staff'.length, at + 900);
}

/**
 * Splits a list of names on commas, "&", "and", semicolons and new lines,
 * unwraps a list set in square brackets and drops any role in brackets after
 * a name ("Ada Chief (CA)" gives "Ada Chief").
 */
export function splitStaffNames(raw: string): string[] {
  let text = raw.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  text = text.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,;&\n]|\band\b/iu)) {
    const name = part.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim().replace(/[.]+$/, '');
    if (name.length < 2 || NOT_A_NAME.test(name) || !/\p{L}/u.test(name)) continue;
    const key = normalizePersonNameV2(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

type Mark = { start: number; end: number; core: boolean };

/** Every label in the text: where it starts, where its colon ends, and whether it names the core. */
function labelMarks(text: string): Mark[] {
  const byStart = new Map<number, Mark>();
  const add = (m: RegExpExecArray, core: boolean) => {
    const start = m.indices?.[1]?.[0] ?? m.index;
    const have = byStart.get(start);
    // A label seen by two patterns keeps the core reading.
    if (!have || (core && !have.core)) {
      byStart.set(start, { start, end: m.index + m[0].length, core });
    }
  };
  for (const m of text.matchAll(CORE_START)) add(m, true);
  for (const m of text.matchAll(OTHER_ANYWHERE)) add(m, false);
  for (const m of text.matchAll(ANY_LABEL)) add(m, false);
  return [...byStart.values()].sort((x, y) => x.start - y.start);
}

/** The adjudication-core names in a staff block's text. */
export function parseStaffText(text: string): string[] {
  const marks = labelMarks(text);
  const core: string[] = [];
  marks.forEach((mark, i) => {
    if (!mark.core) return;
    core.push(...splitStaffNames(text.slice(mark.end, marks[i + 1]?.start ?? text.length)));
  });
  const seen = new Set<string>();
  return core.filter((n) => {
    const key = normalizePersonNameV2(n);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The staff block of a home page: whether it exists, and who it names as core. */
export function parseStaffBlock(html: string): StaffBlock {
  const text = staffBlockText(html);
  if (text == null) return { found: false, core: [] };
  return { found: true, core: parseStaffText(text) };
}
