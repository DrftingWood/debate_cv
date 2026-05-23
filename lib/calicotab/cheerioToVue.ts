import * as cheerio from 'cheerio';
import type { VueCell, VueHead, VueTable } from './parseTabs';

/**
 * Converts every <table> in `html` into the VueTable shape that Tabbycat's
 * Vue data island uses. Bridge for the parser Vue/cheerio collapse
 * (sub-project 8): one parser body per data type consumes VueTable[]
 * regardless of whether the source was a real Vue payload or this adapter's
 * output.
 *
 * Encodes Tabbycat-specific HTML conventions:
 *   - table.title: hoisted from a preceding `.card-title` heading inside the
 *     same `.card` / `.card-body` container (Tabbycat's participants-list and
 *     similar pages use these headings to differentiate sections like
 *     "Adjudicators" vs "Speakers" — without this, downstream parsers can't
 *     tell which table is which).
 *   - VueHead.key: prefers `data-original-title` (the tooltip carries the
 *     full label like "Member of the Adjudication Core" where the visible
 *     <th> text is just "Adj Core"); falls back to lower-cased visible text.
 *   - VueHead.title: visible <th> text as-is.
 *   - VueCell.text: prefers `span[hidden]` text (Tabbycat's sortable canonical
 *     value, used to escape from team-name cells crammed with emoji icons,
 *     tooltip triggers, and popovers); falls back to `.tooltip-trigger` text;
 *     final fallback is the cleaned full cell text.
 *   - VueCell.html: raw inner HTML of the <td>. Used by parseNav's HTML-aware
 *     consumers for icon-based win detection. Always populated.
 *   - VueCell.class: the <td>'s class attribute. Used by parseNav consumers
 *     to find `team-name` cells.
 *   - VueCell.tooltip: first descendant `data-original-title` attribute on
 *     the <td>. Tabbycat embeds canonical stage labels here (e.g. the
 *     "Round 1" full label sitting on a wrapper div with abbreviated visible
 *     text "R1" inside) — surfacing it as cell.tooltip lets parseNav
 *     consumers read stage labels the same way for Vue and cheerio sources.
 *
 * Returns tables in DOM order. Empty array if no tables found.
 */
export function extractFromCheerio(html: string): VueTable[] {
  const $ = cheerio.load(html);
  const tables: VueTable[] = [];

  $('table').each((_i, tableEl) => {
    const $table = $(tableEl);

    // Headers: prefer <thead tr:first>; fall back to the first <tr> if no <thead>.
    // Cheerio's HTML parser auto-wraps loose <tr> elements in a synthesized
    // <tbody>, so "no <thead>" still presents the header <tr> inside <tbody>.
    // We track that case to exclude the header row from the data rows below.
    const hasExplicitThead = $table.find('thead tr').first().length > 0;
    const $headerRow = hasExplicitThead
      ? $table.find('thead tr').first()
      : $table.find('tr').first();
    const head: VueHead[] = $headerRow.find('th').map((_j, th) => {
      const $th = $(th);
      const visibleText = cleanText($th.text());
      const tooltip = ($th.attr('data-original-title') ?? '').trim();
      const key = (tooltip || visibleText).toLowerCase();
      return { key, title: visibleText };
    }).get();

    // Data rows: prefer <tbody tr>; fall back to all <tr> when there's no
    // <tbody>. When there was no explicit <thead>, drop the synthesized-or-loose
    // header row from the result — but only when it really was a header row
    // (had <th> cells). Some Tabbycat themes ship the Debates card with no
    // <thead> at all and rows of <td>s under <tbody>; in that case head is
    // empty and every <tr> is data.
    const headerEl = $headerRow.get(0);
    const headerHadTh = $headerRow.find('th').length > 0;
    const dataRowEls = ($table.find('tbody tr').length
      ? $table.find('tbody tr').toArray()
      : $table.find('tr').toArray()
    ).filter((tr) => hasExplicitThead || !headerHadTh || tr !== headerEl);

    const data: VueCell[][] = dataRowEls.map((tr) => {
      const $tr = $(tr);
      return $tr.find('td').map((_j, td) => {
        const $td = $(td);
        const hidden = $td.find('span[hidden]').first().text();
        const trigger = $td.find('.tooltip-trigger').first().text();
        const text = cleanText(
          (hidden && hidden.trim()) ? hidden :
          (trigger && trigger.trim()) ? trigger :
          $td.text(),
        );
        // Surface the first descendant `data-original-title` as cell.tooltip.
        // Tabbycat embeds canonical stage labels here (e.g. data-original-title=
        // "Round 1" on a wrapper div) — without this lift, parseNav consumers
        // can't recover the full stage label from cheerio-adapted tables.
        const tooltip = ($td.find('[data-original-title]').first().attr('data-original-title') ?? '').trim() || undefined;
        return {
          text,
          html: $td.html() ?? '',
          class: ($td.attr('class') ?? '').trim() || undefined,
          ...(tooltip ? { tooltip } : {}),
        };
      }).get();
    });

    // Title: hoisted from a preceding .card-title heading inside the same
    // .card / .card-body container. Tabbycat marks section roles
    // (Adjudicators / Speakers) this way; without it the participants-list
    // parser can't distinguish the two tables on a single page.
    const $cardBody = $table.closest('.card-body, .card');
    const cardTitle = $cardBody.length
      ? cleanText($cardBody.find('.card-title').first().text())
      : '';
    const title = cardTitle || undefined;

    tables.push({ head, data, ...(title ? { title } : {}) });
  });

  return tables;
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
