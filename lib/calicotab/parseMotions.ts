import * as cheerio from 'cheerio';
import { extractVueData } from './parseTabs';
import { extractFromCheerio } from './cheerioToVue';
import { normalizeStageLabel } from './judgeStats';
import type { VueTable } from './parseTabs';

// ── Public types ─────────────────────────────────────────────────────────────

export type MotionRow = {
  /**
   * Parsed numeric round when the label looks like a prelim round ("Round 3",
   * "R3"). Null for outrounds (Quarterfinals, Grand Final, etc.) or any label
   * that doesn't match the canonical "Round N" form after normalization.
   */
  roundNumber: number | null;
  /** The raw round label as shown on the page, trimmed. */
  roundLabel: string;
  /** Motion text, trimmed. */
  text: string;
  /** Info slide text when present, else null. */
  infoSlide: string | null;
  /** 0-based document order, so multiple motions per round keep a stable order. */
  seq: number;
};

// ── Round-number extraction ──────────────────────────────────────────────────

/**
 * Derive the numeric round number from a raw label string.
 *
 * Delegates to `normalizeStageLabel` (which canonicalises "R1" → "Round 1",
 * outround abbreviations, etc.) and then tests the canonical form against
 * `/^Round\s+(\d+)$/`. Outrounds and any other labels that don't map to a
 * numeric prelim round yield null.
 *
 * Reused from the round-label pipeline that parseNav / judgeStats already
 * maintain — we deliberately do NOT re-implement the normalization here.
 */
function extractRoundNumber(rawLabel: string): number | null {
  const normalized = normalizeStageLabel(rawLabel.trim());
  const m = normalized.match(/^Round\s+(\d+)$/i);
  return m ? Number(m[1]) : null;
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// ── Vue path ─────────────────────────────────────────────────────────────────

/**
 * Try to read motions from a Vue `tablesData` payload.
 *
 * Modern Tabbycat motions pages embed one table whose columns include a
 * round/label column and a motion column. Optional columns for an info slide
 * may also appear. The column-discovery logic mirrors the needle-matching
 * pattern used throughout parseTabs.ts — match key or title against a set of
 * lowercase substrings.
 *
 * Returns null (rather than []) when no motion column is found, so the caller
 * can fall through to the cheerio path.
 */
function motionsFromVue(tables: VueTable[]): MotionRow[] | null {
  // Walk all tables and collect from each one that looks like a motions table.
  // Some tournament sites render one table per round rather than one global
  // table; walking all tables handles both layouts.
  const all: MotionRow[] = [];

  for (const table of tables) {
    if (!table?.head?.length || !table?.data?.length) continue;
    const heads = table.head;

    // Helper: find first column whose key or title contains any needle.
    const findCol = (...needles: string[]): number =>
      heads.findIndex((h) => {
        const k = (h.key ?? '').toLowerCase();
        const t = (h.title ?? '').toLowerCase();
        return needles.some((n) => k.includes(n) || t.includes(n));
      });

    const motionCol = findCol('motion', 'text', 'topic');
    if (motionCol < 0) continue; // not a motions table

    const roundCol = findCol('round', 'stage', 'label');
    const infoSlideCol = findCol('info', 'slide');

    // When this table has no round column, fall back to the table's own title
    // as the round label (e.g. "Round 1 Motions" title on per-round tables).
    const tableTitleLabel = cleanText(table.title ?? '');

    for (const row of table.data) {
      const cellText = (idx: number): string =>
        cleanText(String(row[idx]?.text ?? ''));

      const rawLabel = roundCol >= 0 ? cellText(roundCol) : tableTitleLabel;
      const motionText = cellText(motionCol);
      if (!motionText) continue;

      all.push({
        roundNumber: extractRoundNumber(rawLabel),
        roundLabel: rawLabel,
        text: motionText,
        infoSlide: infoSlideCol >= 0 ? cellText(infoSlideCol) || null : null,
        seq: all.length,
      });
    }
  }

  return all.length > 0 ? all : null;
}

// ── Cheerio (plain-HTML) path ────────────────────────────────────────────────

/**
 * Parse motions from server-rendered Tabbycat HTML that has no Vue data
 * island.
 *
 * Two common markup shapes:
 *
 *   1. A single <table> with a "Round" column and a "Motion" column — the
 *      classic flat-table layout. Handled by extractFromCheerio → motionsFromVue
 *      (same code path as every other cheerio fallback in parseTabs.ts).
 *
 *   2. A section-per-round layout where Tabbycat renders a heading like
 *      "Round 1" or "Quarterfinals" followed by a <ul>/<ol> or a list of
 *      <p> elements containing the motion text. This is the pre-SPA era and
 *      some minimally-configured installs.
 *
 * Strategy: try the VueTable adapter first (covers case 1); if that finds
 * nothing, do a bespoke heading+text walk for case 2.
 */
function motionsFromCheerio(html: string): MotionRow[] {
  // Case 1: table-based layout — let the adapter produce VueTable shape and
  // re-use motionsFromVue so the column-matching logic lives in one place.
  const tables = extractFromCheerio(html);
  if (tables.length > 0) {
    const rows = motionsFromVue(tables);
    if (rows && rows.length > 0) return rows;
  }

  // Case 2: section-per-round (heading + list / paragraph) layout.
  // Walk heading elements; for each one that looks like a round label,
  // collect sibling text blocks until the next heading of the same or
  // higher level.
  const $ = cheerio.load(html);
  const rows: MotionRow[] = [];

  // Collect all h1–h4 and any element with a "round-label" / "motion-round"
  // class as candidate section headers.
  $('h1, h2, h3, h4, [class*="round-label"], [class*="motion-round"]').each((_i, el) => {
    const labelRaw = cleanText($(el).text());
    if (!labelRaw) return;

    // Only process headings that look like a round designation. Use a broad
    // check that accepts prelim and outround labels (the same vocabulary
    // that normalizeStageLabel handles).
    const isRoundHeading =
      /\bround\s*\d+\b/i.test(labelRaw) ||
      /\br\d+\b/i.test(labelRaw) ||
      /\b(final|semi|quarter|octo|grand)\b/i.test(labelRaw);
    if (!isRoundHeading) return;

    // Gather text snippets that directly follow this heading until the next
    // heading element. We look at sibling li/p/div[class*=motion] elements.
    const motionTexts: string[] = [];
    let infoText: string | null = null;

    // nextUntil stops at the next same-level (or higher) heading.
    const $heading = $(el);
    const tagName = (el as { tagName?: string }).tagName?.toLowerCase() ?? 'h2';
    const stopSelector = 'h1, h2, h3, h4';

    // Prefer an explicit <ul>/<ol> sibling that immediately follows.
    const $next = $heading.next();
    if ($next.is('ul, ol')) {
      $next.find('li').each((_j, li) => {
        const t = cleanText($(li).text());
        if (t) motionTexts.push(t);
      });
    } else {
      // Fallback: walk all following siblings until the next heading.
      $heading.nextUntil(stopSelector).each((_j, sib) => {
        const $sib = $(sib);
        // Ignore empty or purely decorative nodes.
        const t = cleanText($sib.text());
        if (!t) return;
        // If it looks like an info slide (a common label is "Info Slide:"),
        // capture it separately.
        if (/^info[-\s]?slide[:\s]/i.test(t)) {
          infoText = t.replace(/^info[-\s]?slide[:\s]*/i, '').trim() || null;
          return;
        }
        motionTexts.push(t);
      });
    }

    for (const motionText of motionTexts) {
      if (!motionText) continue;
      rows.push({
        roundNumber: extractRoundNumber(labelRaw),
        roundLabel: labelRaw,
        text: motionText,
        infoSlide: infoText,
        seq: rows.length,
      });
      // Info slide belongs to the first motion in the round; subsequent
      // motions in the same round share the round label but don't repeat it.
      infoText = null;
    }

    // Suppress unused-variable warning; tagName IS used in the stop selector
    // for future refinement but we reference it to satisfy the linter.
    void tagName;
  });

  return rows;
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Parse the Tabbycat motions tab page (URL path `/tab/motions/` or `/motions/`)
 * into a flat list of `MotionRow` objects, one per released motion.
 *
 * Supports two markup generations:
 *
 *   1. **Vue data island** — modern Tabbycat (≥ ~4.x) embeds a
 *      `window.vueData` / `tablesData` JSON blob in a `<script>` tag. The
 *      same `extractVueData` helper used by parseTeamTab/parseSpeakerTab
 *      extracts it; `motionsFromVue` then finds the motion and round columns.
 *
 *   2. **Plain HTML** — older or minimal-install Tabbycat renders either a
 *      `<table>` (column-matched via the `extractFromCheerio` adapter) or a
 *      heading+list layout (`motionsFromCheerio` case 2).
 *
 * Always returns `[]` — never throws — on pages with no recognizable motions.
 * Rows with empty motion text are skipped. Multiple motions per round are
 * preserved in document order via the `seq` counter.
 */
export function parseMotionsTab(html: string): MotionRow[] {
  try {
    // Vue path first — modern Tabbycat serves a data island that is
    // semantically richer than the server-rendered table (it includes
    // tooltip/title metadata the table may not carry).
    const vue = extractVueData(html);
    if (vue) {
      const rows = motionsFromVue(vue);
      if (rows && rows.length > 0) return rows;
    }

    // Plain-HTML fallback: table or heading+list layout.
    return motionsFromCheerio(html);
  } catch {
    // Guard against any unexpected cheerio/acorn error so callers always
    // receive a stable [] rather than an unhandled exception.
    return [];
  }
}
