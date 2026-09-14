/**
 * Real-data test suite.
 *
 * The committed suite feeds every parser hand-written HTML, which means it
 * can only ever assert what we already imagined. This suite runs the same
 * code over a corpus of real Tabbycat pages (built once by
 * tests/__corpus.live.test.ts) and asserts properties that must hold for
 * ANY input — so the failures point at shapes nobody thought of.
 *
 * Offline: it reads the corpus off disk and makes no network calls. Skipped
 * when the corpus is absent so the normal suite stays hermetic.
 *
 *   CORPUS_DIR=<dir> npx vitest run tests/realdata.corpus.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { extractNavigation } from '@/lib/calicotab/parseNav';
import {
  extractVueData,
  parseTeamTab,
  parseSpeakerTab,
  parseBreakPage,
  parseParticipantsList,
  parseRoundResults,
} from '@/lib/calicotab/parseTabs';
import { classifyOutroundStage, normalizeStageLabel, outroundRank } from '@/lib/calicotab/judgeStats';
import { splitOutroundStage } from '@/lib/calicotab/breakCategoryResolve';
import { isPreRound, matchStage, splitStageLabel } from '@/lib/calicotab/stageLexicon';
import { formatStageForDisplay, formatBaseStageForDisplay } from '@/lib/cv/formatStage';
import { computeFingerprint, extractYearFromName } from '@/lib/calicotab/fingerprint';

const DIR = process.env.CORPUS_DIR ?? '';
const INDEX = DIR ? join(DIR, 'index.json') : '';
const HAVE = !!DIR && existsSync(INDEX);

type PageRef = { url: string; kind: string; status: number; file: string | null };
type Entry = { root: string; rootStatus: number; pages: PageRef[] };

const entries: Entry[] = HAVE ? JSON.parse(readFileSync(INDEX, 'utf-8')) : [];
const html = (f: string) => gunzipSync(readFileSync(join(DIR, 'pages', f))).toString('utf-8');

const live = entries.filter((e) => e.rootStatus === 200);
const pagesOf = (kind: string) =>
  live.flatMap((e) => e.pages.filter((p) => p.kind === kind && p.file).map((p) => ({ e, p })));
const deep = live.filter((e) => e.pages.length > 1);

/** Collect offenders and fail with a readable sample rather than on the first one. */
function expectNoViolations(name: string, bad: string[], sampleSize = 12) {
  if (bad.length === 0) return;
  const sample = bad.slice(0, sampleSize).join('\n   ');
  throw new Error(`${name}: ${bad.length} violation(s)\n   ${sample}${bad.length > sampleSize ? `\n   …and ${bad.length - sampleSize} more` : ''}`);
}

describe.skipIf(!HAVE)('real-data corpus', () => {
  it('corpus loaded', () => {
    console.log(
      `[corpus] tournaments=${entries.length} live=${live.length} deep=${deep.length} ` +
        `pages=${live.reduce((n, e) => n + e.pages.filter((p) => p.file).length, 0)}`,
    );
    expect(live.length).toBeGreaterThan(50);
  });

  // ── S1. Stage & break-category vocabulary ───────────────────────────
  // The CV renders these strings verbatim to the user. Anything the
  // classifier or the category splitter does not recognise degrades
  // silently into a wrong-looking label.
  describe('S1 stage vocabulary', () => {
    const roundLabels = new Set<string>();
    const breakCategories = new Set<string>();

    for (const { e, p } of pagesOf('home')) {
      let nav;
      try {
        nav = extractNavigation(html(p.file!), e.root);
      } catch {
        continue;
      }
      for (const l of Object.values(nav.resultsRoundLabels)) if (l?.trim()) roundLabels.add(l.trim());
      for (const u of nav.breakTabs) {
        const m = u.match(/\/break\/(?:teams|bracket)\/([^/]+)\//i);
        if (m) breakCategories.add(m[1]!);
      }
    }

    it('reports the real vocabulary', () => {
      console.log(`[S1] distinct round labels: ${roundLabels.size}`);
      console.log(`[S1] distinct break categories: ${[...breakCategories].sort().join(', ')}`);
      expect(roundLabels.size).toBeGreaterThan(0);
    });

    it('formatStageForDisplay never returns empty for a non-empty label', () => {
      const bad: string[] = [];
      for (const l of roundLabels) if (!formatStageForDisplay(l)) bad.push(JSON.stringify(l));
      expectNoViolations('empty display for non-empty label', bad);
    });

    it('formatStageForDisplay is idempotent', () => {
      // The CV can re-format an already-formatted label (re-render, export,
      // a value read back from the DB). A second pass must not change it.
      const bad: string[] = [];
      for (const l of roundLabels) {
        const once = formatStageForDisplay(l);
        const twice = formatStageForDisplay(once);
        if (once !== twice) bad.push(`${JSON.stringify(l)} → ${JSON.stringify(once)} → ${JSON.stringify(twice)}`);
      }
      expectNoViolations('not idempotent', bad);
    });

    it('never renders a doubled category prefix', () => {
      const bad: string[] = [];
      for (const cat of breakCategories) {
        // Some break URLs are named after the round rather than a category
        // (/break/bracket/semifinals/). Pairing those with a stage produces
        // input no tournament emits.
        if (matchStage(cat)) continue;
        for (const stage of ['Grand Final', 'Semifinals', 'Quarterfinals']) {
          const raw = `${cat} ${stage}`;
          const out = formatStageForDisplay(raw);
          const words = out.split(/\s+/);
          if (words.length > 1 && words[0]!.toLowerCase() === words[1]!.toLowerCase()) {
            bad.push(`${JSON.stringify(raw)} → ${JSON.stringify(out)}`);
          }
        }
      }
      expectNoViolations('doubled prefix', bad);
    });

    it('keeps a real break category visible on the displayed stage', () => {
      // Driven by REAL nav labels. The lexicon decides what counts as a
      // category — anything left after the stage phrase is removed — so this
      // asks it rather than checking against a word list, which would call a
      // Spanish stage name ("Cuartos") a dropped category.
      const bad: string[] = [];
      for (const l of roundLabels) {
        const { category } = splitStageLabel(l);
        if (!category || /^open$/i.test(category)) continue;
        const out = formatStageForDisplay(l);
        if (!out.toLowerCase().includes(category.toLowerCase())) {
          bad.push(`${JSON.stringify(l)} → ${JSON.stringify(out)}  (lost ${JSON.stringify(category)})`);
        }
      }
      expectNoViolations('category dropped from display', bad, 25);
    });

    it('reports which category tokens splitOutroundStage does not know', () => {
      // Informational: break-category URL slugs are free text chosen by each
      // tournament, so full coverage is not the goal — but the allowlist is
      // only Open|ESL|EFL|Novice, and the corpus shows how far that is from
      // what installs actually use.
      const unknown = [...breakCategories].filter(
        (c) => splitOutroundStage(`${c} Grand Final`).category === null,
      );
      console.log(
        `[S1] break-category slugs unrecognised by splitOutroundStage: ` +
          `${unknown.length}/${breakCategories.size}`,
      );
      console.log(`[S1]   ${unknown.slice(0, 40).join(', ')}`);
      expect(breakCategories.size).toBeGreaterThan(0);
    });

    it('outround round labels classify to a canonical stage', () => {
      // Prelims legitimately do not classify; outround-looking labels should.
      const outroundish = [...roundLabels].filter(
        (l) =>
          /final|semi|quarter|octo|elim|break|round of/i.test(l) &&
          // A play-in round ("Pre-Semifinals", "Pré-Final", "Pre-Grand
          // Finals") is neither the round it names nor the one before it,
          // so it stays unclassified on purpose. Asking the lexicon keeps
          // the accented and spaced spellings in step with it — this filter
          // had its own regex and missed all three.
          !isPreRound(l),
      );
      const bad: string[] = [];
      for (const l of outroundish) {
        if (!classifyOutroundStage(normalizeStageLabel(l))) bad.push(JSON.stringify(l));
      }
      expectNoViolations('outround label did not classify', bad, 20);
    });

    it('outroundRank orders the real stages consistently with classification', () => {
      const bad: string[] = [];
      for (const l of roundLabels) {
        const stage = classifyOutroundStage(normalizeStageLabel(l));
        if (!stage) continue;
        const rank = outroundRank({ roundLabel: l, roundNumber: null, isOutround: true });
        if (!Number.isFinite(rank) || rank <= 0) bad.push(`${JSON.stringify(l)} → rank ${rank}`);
      }
      expectNoViolations('classified stage with no usable rank', bad);
    });

    it('formatBaseStageForDisplay never leaks a category', () => {
      const bad: string[] = [];
      for (const cat of breakCategories) {
        if (matchStage(cat)) continue; // round-named break URL, not a category
        const out = formatBaseStageForDisplay(`${cat} Grand Final`);
        if (out.toLowerCase().includes(cat.toLowerCase()) && !/^open$/i.test(cat)) {
          bad.push(`${cat} Grand Final → ${JSON.stringify(out)}`);
        }
      }
      expectNoViolations('category leaked into base label', bad, 25);
    });
  });

  // ── S2. Parser output invariants ────────────────────────────────────
  describe('S2 parser invariants', () => {
    it('team tab rows have a non-empty name', () => {
      const bad: string[] = [];
      for (const { p } of pagesOf('teamTab')) {
        for (const r of parseTeamTab(html(p.file!))) {
          if (!r.teamName || !r.teamName.trim()) bad.push(`${p.url} → ${JSON.stringify(r)}`);
        }
      }
      expectNoViolations('empty team name', bad);
    });

    it('speaker tab rows have a non-empty name', () => {
      const bad: string[] = [];
      for (const { p } of pagesOf('speakerTab')) {
        for (const r of parseSpeakerTab(html(p.file!))) {
          if (!r.speakerName || !r.speakerName.trim()) bad.push(`${p.url} → ${JSON.stringify(r)}`);
        }
      }
      expectNoViolations('empty speaker name', bad);
    });

    it('no parsed cell still contains raw HTML or an unescaped entity', () => {
      // A tag or a stray &amp; in a name means the cell text was taken from
      // markup the extractor did not fully unwrap — it would render as
      // literal junk on the CV.
      const bad: string[] = [];
      // `<em>Redacted</em>` is not a leak: Tabbycat emits it for a speaker
      // who opted out of the public tab, and lib/calicotab/redactedSpeaker.ts
      // depends on the row surviving so it can still attribute the scores.
      const REDACTION = /^\s*<em>\s*redacted\s*<\/em>\s*$/i;
      const suspect = (s: string) =>
        !REDACTION.test(s) && /<[a-z/][^>]*>|&(amp|lt|gt|quot|#\d+);/i.test(s);
      for (const { p } of pagesOf('teamTab')) {
        for (const r of parseTeamTab(html(p.file!))) {
          if (suspect(r.teamName)) bad.push(`teamTab ${p.url} → ${JSON.stringify(r.teamName)}`);
        }
      }
      for (const { p } of pagesOf('speakerTab')) {
        for (const r of parseSpeakerTab(html(p.file!))) {
          if (suspect(r.speakerName)) bad.push(`speakerTab ${p.url} → ${JSON.stringify(r.speakerName)}`);
        }
      }
      for (const { p } of pagesOf('participants')) {
        for (const r of parseParticipantsList(html(p.file!))) {
          if (suspect(r.name)) bad.push(`participants ${p.url} → ${JSON.stringify(r.name)}`);
        }
      }
      expectNoViolations('markup leaked into a parsed cell', bad);
    });

    it('break rows are ordered by rank where ranks are present', () => {
      const bad: string[] = [];
      for (const { p } of pagesOf('breakTab')) {
        const ranks = parseBreakPage(html(p.file!), p.url)
          .map((r) => r.rank)
          .filter((r): r is number => typeof r === 'number');
        for (let i = 1; i < ranks.length; i += 1) {
          if (ranks[i]! < ranks[i - 1]!) {
            bad.push(`${p.url} → rank ${ranks[i - 1]} then ${ranks[i]}`);
            break;
          }
        }
      }
      expectNoViolations('break ranks out of order', bad);
    });

    it('every judge on a results page has a role, and each page has a chair', () => {
      // NOT "one chair per debate": a /results/round/N/ page lists EVERY
      // debate in that round, so many chairs on one page is correct. This
      // assertion used to pass only because panelRole came back null for
      // every judge in the corpus — it was green for the wrong reason.
      const bad: string[] = [];
      for (const { p } of pagesOf('roundResults')) {
        const d = parseRoundResults(html(p.file!), p.url, null);
        if (d.judgeAssignments.length === 0) continue;
        const roleless = d.judgeAssignments.filter((j) => j.panelRole === null).length;
        if (roleless > 0) {
          bad.push(`${p.url} → ${roleless}/${d.judgeAssignments.length} judges with no role`);
          continue;
        }
        if (!d.judgeAssignments.some((j) => j.panelRole === 'chair')) {
          bad.push(`${p.url} → ${d.judgeAssignments.length} judges, no chair among them`);
        }
      }
      expectNoViolations('judge role not resolved', bad, 10);
    });

    it('a speaker total equals the sum of their own round scores', () => {
      // totalScore and roundScores are read from different columns of the
      // same row. If they disagree, one of the two was taken from the wrong
      // column — and buildCvData derives the CV average from these.
      const bad: string[] = [];
      for (const { p } of pagesOf('speakerTab')) {
        for (const r of parseSpeakerTab(html(p.file!))) {
          const scores = r.roundScores.map((s) => s.score).filter((s): s is number => s != null);
          if (r.totalScore == null || scores.length === 0) continue;
          // Only meaningful when every round is present; a tab that hides
          // some rounds legitimately sums to less.
          if (scores.length !== r.roundScores.length) continue;
          const sum = scores.reduce((a, b) => a + b, 0);
          if (Math.abs(sum - r.totalScore) > 0.5) {
            bad.push(`${p.url} → ${r.speakerName}: total=${r.totalScore} sum(${scores.length})=${sum}`);
          }
        }
      }
      expectNoViolations('speaker total != sum of round scores', bad, 15);
    });

    it('speaker round labels are non-empty', () => {
      const bad: string[] = [];
      for (const { p } of pagesOf('speakerTab')) {
        for (const r of parseSpeakerTab(html(p.file!))) {
          for (const rs of r.roundScores) {
            if (!rs.roundLabel || !rs.roundLabel.trim()) {
              bad.push(`${p.url} → ${r.speakerName} has an unlabelled round`);
              break;
            }
          }
        }
      }
      expectNoViolations('unlabelled round score', bad);
    });
  });

  // ── S3. Cross-source consistency ────────────────────────────────────
  // Each page is parsed independently; the same entities appear on several.
  // Disagreement means one of the parsers is reading the wrong column.
  describe('S3 cross-source consistency', () => {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

    it('teams that broke also appear in the team tab', () => {
      const bad: string[] = [];
      for (const e of deep) {
        const tt = e.pages.find((p) => p.kind === 'teamTab' && p.file);
        const bts = e.pages.filter((p) => p.kind === 'breakTab' && p.file);
        if (!tt || bts.length === 0) continue;
        const teams = new Set(parseTeamTab(html(tt.file!)).map((r) => norm(r.teamName)));
        if (teams.size === 0) continue;
        for (const bt of bts) {
          const rows = parseBreakPage(html(bt.file!), bt.url).filter((r) => r.entityType === 'team');
          if (rows.length === 0) continue;
          const missing = rows.filter((r) => !teams.has(norm(r.entityName)));
          // Allow a little slack: some tabs redact or rename late.
          if (missing.length > rows.length * 0.25) {
            bad.push(
              `${bt.url} → ${missing.length}/${rows.length} broken teams absent from team tab` +
                ` (e.g. ${missing.slice(0, 2).map((m) => JSON.stringify(m.entityName)).join(', ')})`,
            );
          }
        }
      }
      expectNoViolations('break/team-tab disagreement', bad, 10);
    });

    it('round-result team names come from the same namespace as the team tab', () => {
      const bad: string[] = [];
      for (const e of deep) {
        const tt = e.pages.find((p) => p.kind === 'teamTab' && p.file);
        const rr = e.pages.filter((p) => p.kind === 'roundResults' && p.file);
        if (!tt || rr.length === 0) continue;
        const teams = new Set(parseTeamTab(html(tt.file!)).map((r) => norm(r.teamName)));
        if (teams.size === 0) continue;
        for (const r of rr) {
          const names = parseRoundResults(html(r.file!), r.url, null).teamResults.map((t) =>
            norm(t.teamName),
          );
          if (names.length === 0) continue;
          const missing = names.filter((n) => !teams.has(n));
          if (missing.length > names.length * 0.5) {
            bad.push(`${r.url} → ${missing.length}/${names.length} teams unknown to the team tab`);
          }
        }
      }
      expectNoViolations('round-result/team-tab disagreement', bad, 10);
    });
  });

  // ── S4. Robustness against malformed input ──────────────────────────
  // Real fetches get truncated by timeouts and proxies. A parser that
  // throws on a partial page takes down the whole ingest.
  describe('S4 robustness', () => {
    const mutations: Array<[string, (h: string) => string]> = [
      ['truncated at 50%', (h) => h.slice(0, Math.floor(h.length / 2))],
      ['truncated at 10%', (h) => h.slice(0, Math.floor(h.length / 10))],
      ['empty', () => ''],
      ['no markup', () => 'not html at all'],
      ['tags stripped', (h) => h.replace(/<[^>]+>/g, '')],
    ];

    it('no parser throws on truncated or malformed HTML', () => {
      const bad: string[] = [];
      const sample = [
        ...pagesOf('teamTab').slice(0, 12).map((x) => ['teamTab', x] as const),
        ...pagesOf('speakerTab').slice(0, 12).map((x) => ['speakerTab', x] as const),
        ...pagesOf('breakTab').slice(0, 12).map((x) => ['breakTab', x] as const),
        ...pagesOf('participants').slice(0, 12).map((x) => ['participants', x] as const),
        ...pagesOf('roundResults').slice(0, 12).map((x) => ['roundResults', x] as const),
        ...pagesOf('home').slice(0, 12).map((x) => ['home', x] as const),
      ];
      for (const [kind, { e, p }] of sample) {
        const original = html(p.file!);
        for (const [label, mutate] of mutations) {
          const h = mutate(original);
          try {
            switch (kind) {
              case 'teamTab': parseTeamTab(h); break;
              case 'speakerTab': parseSpeakerTab(h); break;
              case 'breakTab': parseBreakPage(h, p.url); break;
              case 'participants': parseParticipantsList(h); break;
              case 'roundResults': parseRoundResults(h, p.url, null); break;
              case 'home': extractNavigation(h, e.root); break;
            }
            extractVueData(h);
          } catch (err) {
            bad.push(`${kind} [${label}] ${p.url} → ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
          }
        }
      }
      expectNoViolations('parser threw on malformed input', bad, 15);
    });
  });

  // ── S5. Purity and determinism ──────────────────────────────────────
  // These parsers are cached against PARSER_VERSION and their output is
  // written to the database, so a non-deterministic parse is a data bug.
  describe('S5 determinism', () => {
    it('parsing the same page twice gives an identical result', () => {
      const bad: string[] = [];
      const check = (label: string, url: string, h: string, run: (h: string) => unknown) => {
        const a = JSON.stringify(run(h));
        const b = JSON.stringify(run(h));
        if (a !== b) bad.push(`${label} ${url}`);
      };
      for (const { p } of pagesOf('teamTab').slice(0, 25))
        check('teamTab', p.url, html(p.file!), (h) => parseTeamTab(h));
      for (const { p } of pagesOf('speakerTab').slice(0, 25))
        check('speakerTab', p.url, html(p.file!), (h) => parseSpeakerTab(h));
      for (const { p } of pagesOf('roundResults').slice(0, 25))
        check('roundResults', p.url, html(p.file!), (h) => parseRoundResults(h, p.url, null));
      for (const { e, p } of pagesOf('home').slice(0, 25))
        check('nav', p.url, html(p.file!), (h) => extractNavigation(h, e.root));
      expectNoViolations('non-deterministic parse', bad);
    });

    it('the tournament fingerprint is stable and distinguishes tournaments', () => {
      const seen = new Map<string, string>();
      const bad: string[] = [];
      for (const { e } of pagesOf('home')) {
        const u = new URL(e.root);
        const slug = u.pathname.split('/').filter(Boolean)[0] ?? null;
        const parts = {
          host: u.host,
          tournamentSlug: slug,
          tournamentName: slug,
          year: extractYearFromName(slug),
        };
        const a = computeFingerprint(parts);
        if (a !== computeFingerprint(parts)) bad.push(`unstable for ${e.root}`);
        const prior = seen.get(a);
        if (prior && prior !== e.root) bad.push(`collision: ${prior} vs ${e.root}`);
        seen.set(a, e.root);
      }
      expectNoViolations('fingerprint instability/collision', bad, 15);
    });
  });
});
