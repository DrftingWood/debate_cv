#!/usr/bin/env node
/**
 * Report-only accessibility smoke check (`npm run a11y`).
 *
 * Renders the main routes at a phone and a desktop width, in light and dark,
 * runs axe-core on each, and also measures the three things axe does not:
 * whether the page scrolls sideways, how many pointer targets are under the
 * 24x24 px floor of WCAG 2.2 SC 2.5.8, and the console errors. It writes
 * screenshots and a JSON report to `.reports/a11y/` (git-ignored) and prints
 * a summary table. It ALWAYS exits 0: it is a report, not a gate, and it is
 * deliberately not part of the blocking `verify` job (docs/CI_PLAN-2026-10-27.md
 * explains how a check graduates). The rules it supports are in
 * docs/UI_UX_STANDARDS.md.
 *
 * Its two dependencies are NOT in package.json, so a normal `npm ci` (and CI)
 * never downloads a browser. Install them for a run without touching the
 * lockfile:
 *
 *   npm install --no-save playwright@1.64.0 @axe-core/playwright@4.13.0
 *   npx playwright install chromium
 *
 * Then, against a local seeded app (CLAUDE.md, "Local development against
 * real data"; `next dev`, because the session cookie is the non-__Secure one):
 *
 *   A11Y_BASE_URL=http://localhost:3000 A11Y_SESSION_TOKEN=<from seed:dev> npm run a11y
 *
 * A11Y_SLUG (default maya-rao, the seed user) names the public CV to check.
 * A11Y_ONLY=/cv,/dashboard limits the routes. A11Y_BEST_PRACTICE=1 adds axe's
 * best-practice rules (landmarks, heading order).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = (process.env.A11Y_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const TOKEN = process.env.A11Y_SESSION_TOKEN ?? '';
const SLUG = process.env.A11Y_SLUG ?? 'maya-rao';
const OUT = path.resolve('.reports/a11y');

const ROUTES = [
  { path: '/', auth: false },
  { path: '/sample', auth: false },
  { path: '/privacy', auth: false },
  { path: `/u/${SLUG}`, auth: false },
  { path: '/cv', auth: true },
  { path: '/cv/stats', auth: true },
  { path: '/cv/motions', auth: true },
  { path: '/dashboard', auth: true },
  { path: '/dashboard?filter=all', auth: true },
  { path: '/settings/profile', auth: true },
  { path: '/settings/sharing', auth: true },
  { path: '/settings/account', auth: true },
  { path: '/admin', auth: true },
];
const VIEWPORTS = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 900 },
];
const THEMES = ['light', 'dark'];
// WCAG 2.2 A + AA. 'best-practice' (landmarks, heading order, one h1, dialog
// names) is opt-in with A11Y_BEST_PRACTICE=1, so the default counts mean
// "fails a success criterion", not "differs from Deque's house style".
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
if (process.env.A11Y_BEST_PRACTICE === '1') TAGS.push('best-practice');

async function load() {
  try {
    const { chromium } = await import('playwright');
    const { default: AxeBuilder } = await import('@axe-core/playwright');
    return { chromium, AxeBuilder };
  } catch {
    console.log(
      'a11y: playwright / @axe-core/playwright are not installed. See the header of\n' +
        'scripts/a11y-smoke.mjs for the one-line install. Nothing was checked.',
    );
    process.exit(0);
  }
}

/** Measured in the page: sideways scroll and targets under 24x24 CSS px. */
function measure() {
  const doc = document.documentElement;
  const small = [];
  for (const el of document.querySelectorAll(
    'a[href], button, input, select, textarea, summary, [role="button"], [tabindex="0"]',
  )) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // A visually hidden (1 px) input that a visible button opens, such as the CSV
    // file picker, is not a target anyone clicks.
    if (r.width <= 1 && r.height <= 1) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    // Inline links inside a sentence are exempt from SC 2.5.8.
    if (el.tagName === 'A' && style.display === 'inline') continue;
    if (r.width < 24 || r.height < 24) {
      const label = (
        el.getAttribute('aria-label') ||
        el.textContent ||
        el.getAttribute('name') ||
        el.tagName
      )
        .trim()
        .slice(0, 40);
      small.push(
        `${el.tagName.toLowerCase()} "${label}" ${Math.round(r.width)}x${Math.round(r.height)}`,
      );
    }
  }
  // axe's nested-interactive rule looks inside widgets such as buttons, not
  // at a <button> inside a link, which is this codebase's common case.
  const nested = [...document.querySelectorAll('a button, a a, button a, button button')].map(
    (el) => (el.closest('a, button')?.textContent || '').trim().slice(0, 40),
  );
  return {
    nested,
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    overflowX: doc.scrollWidth > doc.clientWidth + 1,
    smallTargets: small,
    title: document.title,
  };
}

/** A hung page (a dev-server recompile, a runaway full-page screenshot) must not stall the run. */
function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    }),
  ]);
}

/**
 * One browser context for a theme and viewport, signed in or not. Signed-out
 * routes are checked WITHOUT the session cookie, because the landing page
 * redirects a signed-in visitor and would otherwise be measured as a blank
 * redirect.
 */
async function openContext(browser, { theme, vp, signedIn }) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    colorScheme: theme,
    hasTouch: vp.width < 768,
  });
  await context.addInitScript((t) => {
    try {
      window.localStorage.setItem('theme', t);
    } catch {
      /* storage blocked: the OS colour scheme set above still applies */
    }
  }, theme);
  if (signedIn) {
    const { hostname } = new URL(BASE);
    await context.addCookies([
      { name: 'authjs.session-token', value: TOKEN, domain: hostname, path: '/' },
    ]);
  }
  return context;
}

/** Load one route, screenshot it, run axe and the in-page measurements. */
async function checkPage(context, AxeBuilder, { route, id, base }) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  });
  try {
    // Not 'networkidle': the bell, the ingest tracker and the dev server's
    // HMR socket all poll, so the network is never idle. 'load' plus a short
    // settle is what a person would see.
    const res = await page.goto(BASE + route.path, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForTimeout(2_000);
    const m = await withTimeout(page.evaluate(measure), 30_000, 'measure');
    const shot = page.screenshot({ path: path.join(OUT, `${id}.png`), fullPage: true });
    await withTimeout(shot, 60_000, 'screenshot');
    const axe = await withTimeout(
      new AxeBuilder({ page }).withTags(TAGS).analyze(),
      120_000,
      'axe',
    );
    console.log(`checked ${id}: ${axe.violations.length} rule(s)`);
    const violations = axe.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
    const finalUrl = page.url().replace(BASE, '');
    return { ...base, finalUrl, status: res?.status() ?? null, ...m, consoleErrors, violations };
  } catch (e) {
    console.log(`failed ${id}: ${String(e).slice(0, 120)}`);
    return { ...base, error: String(e).slice(0, 300) };
  } finally {
    await page.close().catch(() => {});
  }
}

function printSummary(results) {
  console.log(
    'route | vp | theme | axe violations (rule:nodes) | overflowX | <24px targets | nested controls',
  );
  for (const r of results) {
    const head = `${r.route} | ${r.viewport} | ${r.theme}`;
    if (r.error) {
      console.log(`${head} | ERROR ${r.error}`);
      continue;
    }
    const v = r.violations.map((x) => `${x.id}:${x.nodes}`).join(' ') || '-';
    const overflow = r.overflowX ? `${r.scrollWidth}px` : 'no';
    console.log(`${head} | ${v} | ${overflow} | ${r.smallTargets.length} | ${r.nested.length}`);
  }
  console.log(`\nScreenshots and report.json in ${OUT}. Report only: exit 0.`);
}

async function main() {
  const { chromium, AxeBuilder } = await load();
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const only = process.env.A11Y_ONLY?.split(',');
  const routes = ROUTES.filter((r) => (!only || only.includes(r.path)) && (!r.auth || TOKEN));
  const results = [];
  for (const theme of THEMES) {
    for (const vp of VIEWPORTS) {
      const contexts = new Map();
      for (const signedIn of new Set(routes.map((r) => r.auth))) {
        contexts.set(signedIn, await openContext(browser, { theme, vp, signedIn }));
      }
      for (const route of routes) {
        const slug = route.path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home';
        const id = `${slug}-${vp.name}-${theme}`;
        const base = { id, route: route.path, viewport: vp.name, theme };
        results.push(await checkPage(contexts.get(route.auth), AxeBuilder, { route, id, base }));
      }
      for (const context of contexts.values()) await context.close();
    }
  }
  await browser.close();
  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(results, null, 2));
  printSummary(results);
}

main().catch((e) => {
  console.error('a11y smoke crashed (report only, exiting 0):', e);
  process.exit(0);
});
