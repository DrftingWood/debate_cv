/**
 * End-to-end scrape test — runs the full pipeline against a real Tabbycat
 * private URL using the same fetch logic and parsers the app uses.
 *
 * Usage:
 *   node scripts/test-scrape.mjs <private-url>
 *
 * Example:
 *   node scripts/test-scrape.mjs https://ilnuroundrobin.calicotab.com/ilnurr2026/privateurls/rbo1rd0g/
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const PRIVATE_URL = process.argv[2];
if (!PRIVATE_URL) {
  console.error('Usage: node scripts/test-scrape.mjs <private-url>');
  process.exit(1);
}

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const cookieStore = new Map(); // host → Map<name, value>

function storeCookies(host, response) {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  if (!setCookies.length) return;
  const jar = cookieStore.get(host) ?? new Map();
  for (const raw of setCookies) {
    const pair = raw.split(';')[0] ?? '';
    const eqIdx = pair.indexOf('=');
    if (eqIdx < 1) continue;
    jar.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
  }
  cookieStore.set(host, jar);
}

function getCookieHeader(host) {
  const jar = cookieStore.get(host);
  if (!jar?.size) return undefined;
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function isCloudflareChallenge(html) {
  return html.includes('__cf_chl_') || (html.includes('Just a moment') && html.includes('cloudflare'));
}

async function fetchPage(url, referer) {
  const host = new URL(url).host;
  const cookie = getCookieHeader(host);
  const headers = {
    'User-Agent': DEFAULT_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
    'Sec-Fetch-User': '?1',
    ...(referer ? { Referer: referer } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
  };

  const res = await fetch(url, { headers, redirect: 'follow' });
  storeCookies(host, res);
  const html = await res.text();

  if (!res.ok) return { ok: false, status: res.status, html, url };
  if (isCloudflareChallenge(html)) return { ok: false, status: 503, html: '[Cloudflare JS challenge]', url };
  return { ok: true, status: res.status, html, url };
}

// ── window.vueData extractor (mirrors parseTabs.ts) ──────────────────────────

function extractVueData(html) {
  const marker = 'window.vueData = ';
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const rest = html.slice(idx + marker.length);
  let depth = 0, inString = false, escaped = false, endIdx = -1;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
  }
  if (endIdx < 0) return null;
  try {
    const parsed = JSON.parse(rest.slice(0, endIdx));
    if (Array.isArray(parsed?.tablesData)) return parsed.tablesData;
  } catch {}
  return null;
}

function cellText(cell) {
  return String(cell?.text ?? '').replace(/\s+/g, ' ').trim();
}

function vueCol(heads, ...needles) {
  return heads.findIndex(h => {
    const k = (h.key ?? '').toLowerCase();
    const t = (h.title ?? '').toLowerCase();
    return needles.some(n => k.includes(n) || t.includes(n));
  });
}

function parseNum(s) {
  if (!s) return null;
  const t = s.replace(/[, ]+/g, '').trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

// ── Cheerio fallback helpers ──────────────────────────────────────────────────

const cheerio = await import('cheerio');
const load = cheerio.load ?? cheerio.default?.load;

function cleanText(s) { return s.replace(/\s+/g, ' ').trim(); }

function findTableByHeader($, matcher) {
  let found = null;
  $('table').each((_, el) => {
    if (found) return;
    const headers = $(el).find('thead tr').first().find('th')
      .map((_, th) => cleanText($(th).text()).toLowerCase()).get();
    if (headers.length && matcher(headers)) found = $(el);
  });
  return found;
}

// ── Parsers: try vueData, fall back to cheerio ────────────────────────────────

function parseTeamTab(html) {
  const vue = extractVueData(html);
  if (vue?.length) {
    const table = vue[0];
    if (table?.head?.length && table?.data?.length) {
      const heads = table.head;
      const teamCol = vueCol(heads, 'team');
      if (teamCol >= 0) {
        const rankCol = vueCol(heads, 'rk', 'rank', '#');
        const winsCol = vueCol(heads, 'win');
        let ptsCol = vueCol(heads, 'pts', 'point', 'total');
        if (ptsCol < 0) ptsCol = vueCol(heads, 'spk', 'speak', 'score');
        const rows = [];
        for (const row of table.data) {
          const teamName = cellText(row[teamCol]);
          if (!teamName) continue;
          rows.push({
            teamName,
            rank: rankCol >= 0 ? parseNum(cellText(row[rankCol])) : null,
            wins: winsCol >= 0 ? parseNum(cellText(row[winsCol])) : null,
            totalPoints: ptsCol >= 0 ? parseNum(cellText(row[ptsCol])) : null,
          });
        }
        if (rows.length > 0) return { rows, source: 'vueData', heads: heads.map(h => h.key ?? h.title ?? '?') };
      }
    }
  }
  const $ = load(html);
  const table = findTableByHeader($, h => h.some(x => x.includes('team'))) ?? $('table').first();
  const headers = table.find('thead th').map((_, th) => cleanText($(th).text()).toLowerCase()).get();
  const idx = (...n) => headers.findIndex(h => n.some(x => h.includes(x)));
  const teamCol = idx('team'), winsCol = idx('win', 'record'), pointsCol = idx('total', 'points');
  const rows = [];
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td').map((_, td) => cleanText($(td).text())).get();
    if (!cells.length) return;
    const teamName = teamCol >= 0 ? cells[teamCol] : cells[0];
    if (!teamName) return;
    rows.push({ teamName, wins: winsCol >= 0 ? parseNum(cells[winsCol]) : null, totalPoints: pointsCol >= 0 ? parseNum(cells[pointsCol]) : null });
  });
  return { rows, source: 'cheerio', heads: headers };
}

function parseSpeakerTab(html) {
  const vue = extractVueData(html);
  if (vue?.length) {
    const table = vue[0];
    if (table?.head?.length && table?.data?.length) {
      const heads = table.head;
      const nameCol = vueCol(heads, 'name', 'speaker');
      if (nameCol >= 0) {
        const totalCol = vueCol(heads, 'total', 'spk', 'score');
        const rows = [];
        for (const row of table.data) {
          const name = cellText(row[nameCol]);
          if (!name) continue;
          rows.push({ speakerName: name, totalScore: totalCol >= 0 ? parseNum(cellText(row[totalCol])) : null });
        }
        if (rows.length > 0) return { rows, source: 'vueData', heads: heads.map(h => h.key ?? h.title ?? '?') };
      }
    }
  }
  const $ = load(html);
  const table = findTableByHeader($, h => h.some(x => x.includes('name') || x.includes('speaker'))) ?? $('table').first();
  const headers = table.find('thead th').map((_, th) => cleanText($(th).text())).get();
  const lowered = headers.map(h => h.toLowerCase());
  const nameCol = lowered.findIndex(h => h.includes('name') || h.includes('speaker'));
  const totalCol = lowered.findIndex(h => h.includes('total') || h.includes('score'));
  const rows = [];
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td').map((_, td) => cleanText($(td).text())).get();
    const name = nameCol >= 0 ? cells[nameCol] : cells[0];
    if (!name) return;
    rows.push({ speakerName: name, totalScore: totalCol >= 0 ? parseNum(cells[totalCol]) : null });
  });
  return { rows, source: 'cheerio', heads: lowered };
}

function parseRoundResults(html, url) {
  const vue = extractVueData(html);
  const m = url.match(/\/results\/round\/(\d+)/);
  const roundNumber = m ? Number(m[1]) : null;
  if (vue?.length) {
    const table = vue[0];
    if (table?.head?.length && table?.data?.length) {
      const heads = table.head;
      const teamCol = vueCol(heads, 'team');
      if (teamCol >= 0) {
        const winCol = vueCol(heads, 'win', 'result');
        const teamResults = [];
        for (const row of table.data) {
          const teamName = cellText(row[teamCol]);
          if (!teamName) continue;
          const winText = winCol >= 0 ? cellText(row[winCol]).toLowerCase() : '';
          teamResults.push({ teamName, won: winCol >= 0 ? /won|win|✓|\b1\b/.test(winText) : null });
        }
        if (teamResults.length > 0) return { roundNumber, teamResults, source: 'vueData', heads: heads.map(h => h.key ?? h.title ?? '?') };
      }
    }
  }
  const $ = load(html);
  const teamResults = [];
  $('table').each((_, table) => {
    const headers = $(table).find('thead tr').first().find('th')
      .map((_, th) => cleanText($(th).text()).toLowerCase()).get();
    const teamCol = headers.findIndex(h => h.includes('team'));
    const winCol = headers.findIndex(h => h === 'win' || h.includes('result'));
    if (teamCol < 0) return;
    $(table).find('tbody tr').each((_, tr) => {
      const cells = $(tr).find('td').map((_, td) => cleanText($(td).text())).get();
      if (cells[teamCol]) teamResults.push({ teamName: cells[teamCol], won: winCol >= 0 ? /won|win|✓|\b1\b/.test((cells[winCol] || '').toLowerCase()) : null });
    });
  });
  return { roundNumber, teamResults, source: 'cheerio' };
}

function parseBreakPage(html, url) {
  const vue = extractVueData(html);
  const isAdj = /adjudicators/.test(url);
  if (vue?.length) {
    const table = vue[0];
    if (table?.head?.length && table?.data?.length) {
      const heads = table.head;
      const nameCol = vueCol(heads, 'team', 'adjudicator', 'name');
      const rankCol = vueCol(heads, 'rk', 'rank', '#');
      const rows = [];
      for (const row of table.data) {
        const name = nameCol >= 0 ? cellText(row[nameCol]) : cellText(row[0]);
        if (!name) continue;
        rows.push({ rank: rankCol >= 0 ? parseNum(cellText(row[rankCol])) : null, entityName: name, entityType: isAdj ? 'adjudicator' : 'team' });
      }
      if (rows.length > 0) return { rows, source: 'vueData', heads: heads.map(h => h.key ?? h.title ?? '?') };
    }
  }
  const $ = load(html);
  const rows = [];
  const table = $('table').first();
  const headers = table.find('thead th').map((_, th) => cleanText($(th).text()).toLowerCase()).get();
  const nameCol = headers.findIndex(h => h.includes('team') || h.includes('adjudicator') || h.includes('name'));
  const rankCol = headers.findIndex(h => h.includes('rank') || h === '#');
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td').map((_, td) => cleanText($(td).text())).get();
    const name = nameCol >= 0 ? cells[nameCol] : cells[0];
    if (!name) return;
    rows.push({ rank: rankCol >= 0 ? parseNum(cells[rankCol]) : null, entityName: name });
  });
  return { rows, source: 'cheerio' };
}

function parseParticipants(html) {
  const vue = extractVueData(html);
  if (vue?.length) {
    const allRows = [];
    for (const table of vue) {
      if (!table?.head?.length || !table?.data?.length) continue;
      const heads = table.head;
      const nameCol = vueCol(heads, 'name');
      if (nameCol < 0) continue;
      const teamCol = vueCol(heads, 'team');
      const roleCol = vueCol(heads, 'role');
      const isSpeakerTable = teamCol >= 0;
      for (const row of table.data) {
        const name = cellText(row[nameCol]);
        if (!name) continue;
        let role = 'other';
        if (roleCol >= 0) {
          const rt = cellText(row[roleCol]).toLowerCase();
          if (/adjud|judge/.test(rt)) role = 'adjudicator';
          else if (/speak|debat/.test(rt)) role = 'speaker';
        } else if (isSpeakerTable) {
          role = 'speaker';
        }
        allRows.push({ name, role });
      }
    }
    if (allRows.length > 0) return { rows: allRows, source: 'vueData' };
  }
  const $ = load(html);
  const rows = [];
  $('table').each((_, table) => {
    const headers = $(table).find('thead th').map((_, th) => cleanText($(th).text()).toLowerCase()).get();
    const nameCol = headers.findIndex(h => h.includes('name'));
    const roleCol = headers.findIndex(h => h.includes('role'));
    if (nameCol < 0) return;
    $(table).find('tbody tr').each((_, tr) => {
      const cells = $(tr).find('td').map((_, td) => cleanText($(td).text())).get();
      const name = cells[nameCol]; if (!name) return;
      const roleText = roleCol >= 0 ? (cells[roleCol] || '').toLowerCase() : '';
      const role = /adjud|judge/.test(roleText) ? 'adjudicator' : /speak|debat/.test(roleText) ? 'speaker' : 'other';
      rows.push({ name, role });
    });
  });
  return { rows, source: 'cheerio' };
}

function extractNav(html, sourceUrl) {
  const $ = load(html);
  const base = (() => {
    const u = new URL(sourceUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    return `${u.protocol}//${u.host}/${parts[0]}/`;
  })();
  const nav = { teamTab: null, speakerTab: null, participants: null, resultsRounds: [], breakTabs: [] };
  $('a').each((_, el) => {
    const href = $(el).attr('href'); if (!href) return;
    try {
      const abs = new URL(href, base).toString();
      const p = new URL(abs).pathname;
      if (/\/tab\/team/.test(p) && !nav.teamTab) nav.teamTab = abs;
      else if (/\/tab\/speaker/.test(p) && !nav.speakerTab) nav.speakerTab = abs;
      else if (/\/results\/round\/\d+/.test(p)) nav.resultsRounds.push(abs);
      else if (/\/break\/[^/]+\//.test(p)) nav.breakTabs.push(abs);
      else if (/\/participants\/list/.test(p) && !nav.participants) nav.participants = abs;
    } catch {}
  });
  nav.resultsRounds = [...new Set(nav.resultsRounds)].sort();
  nav.breakTabs = [...new Set(nav.breakTabs)].sort();
  if (!nav.teamTab) nav.teamTab = `${base}tab/team/`;
  if (!nav.speakerTab) nav.speakerTab = `${base}tab/speaker/`;
  if (!nav.participants) nav.participants = `${base}participants/list/`;
  return nav;
}

function extractTournamentName(html) {
  const $ = load(html);
  const title = $('title').first().text();
  if (!title) return null;
  return title.includes('|') ? title.split('|')[0].trim() : title.trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────

const SEP = '─'.repeat(60);
console.log(`\n${SEP}`);
console.log(`  Scrape test: ${PRIVATE_URL}`);
console.log(SEP);

process.stdout.write('\n[1/6] Fetching landing page... ');
const landing = await fetchPage(PRIVATE_URL);
if (!landing.ok) {
  console.log(`FAIL (HTTP ${landing.status})`);
  console.log(landing.html.slice(0, 300));
  process.exit(1);
}
console.log(`OK (${landing.html.length} bytes)`);

const tournamentName = extractTournamentName(landing.html);
console.log(`     Tournament: ${tournamentName ?? '(not found)'}`);

const nav = extractNav(landing.html, PRIVATE_URL);
console.log(`     Team tab:    ${nav.teamTab}`);
console.log(`     Speaker tab: ${nav.speakerTab}`);
console.log(`     Rounds:      ${nav.resultsRounds.length} (${nav.resultsRounds.map(u => u.match(/\/round\/(\d+)/)?.[1]).join(', ')})`);
console.log(`     Break tabs:  ${nav.breakTabs.length}`);
console.log(`     Participants:${nav.participants}`);
console.log(`     Cookies set: ${[...cookieStore.values()].flatMap(j => [...j.keys()]).join(', ') || 'none'}`);

// Step 2: Team tab
process.stdout.write(`\n[2/6] Fetching team tab... `);
const teamRes = await fetchPage(nav.teamTab, PRIVATE_URL);
if (!teamRes.ok) {
  console.log(`FAIL (HTTP ${teamRes.status})`);
  console.log(teamRes.html.slice(0, 300));
} else {
  const { rows: teams, source, heads } = parseTeamTab(teamRes.html);
  console.log(`OK → ${teams.length} teams (source: ${source})`);
  if (teams.length > 0) {
    console.log(`     Columns: ${(heads ?? []).slice(0, 8).join(', ')}${(heads ?? []).length > 8 ? '...' : ''}`);
    console.log(`     First 3: ${teams.slice(0, 3).map(t => `${t.teamName} (${t.wins}W, ${t.totalPoints}pts)`).join(', ')}`);
  } else {
    console.log(`     ⚠ Zero teams — vueData present: ${!!extractVueData(teamRes.html)}`);
  }
}

// Step 3: Speaker tab
process.stdout.write(`\n[3/6] Fetching speaker tab... `);
const speakerRes = await fetchPage(nav.speakerTab, PRIVATE_URL);
if (!speakerRes.ok) {
  console.log(`FAIL (HTTP ${speakerRes.status})`);
} else {
  const { rows: speakers, source } = parseSpeakerTab(speakerRes.html);
  console.log(`OK → ${speakers.length} speakers (source: ${source})`);
  if (speakers.length > 0) {
    console.log(`     Top 3: ${speakers.slice(0, 3).map(s => `${s.speakerName} (${s.totalScore})`).join(', ')}`);
  } else {
    console.log(`     ⚠ Zero speakers — vueData present: ${!!extractVueData(speakerRes.html)}`);
  }
}

// Step 4: Round 1 results
process.stdout.write(`\n[4/6] Fetching round 1 results... `);
const r1url = nav.resultsRounds.find(u => /\/round\/1\//.test(u));
if (!r1url) {
  console.log('SKIP (no round 1 URL found)');
} else {
  const r1 = await fetchPage(r1url, PRIVATE_URL);
  if (!r1.ok) {
    console.log(`FAIL (HTTP ${r1.status})`);
  } else {
    const { roundNumber, teamResults, source } = parseRoundResults(r1.html, r1url);
    console.log(`OK → round ${roundNumber}, ${teamResults.length} team results (source: ${source})`);
    if (teamResults.length > 0) {
      console.log(`     Sample: ${teamResults.slice(0, 2).map(t => `${t.teamName}=${t.won ? 'W' : 'L'}`).join(', ')}`);
    } else {
      console.log(`     ⚠ Zero results — vueData present: ${!!extractVueData(r1.html)}`);
    }
  }
}

// Step 5: Break page
process.stdout.write(`\n[5/6] Fetching break page... `);
const breakUrl = nav.breakTabs.find(u => /teams/.test(u)) ?? nav.breakTabs[0];
if (!breakUrl) {
  console.log('SKIP (no break tab URL found)');
} else {
  const br = await fetchPage(breakUrl, PRIVATE_URL);
  if (!br.ok) {
    console.log(`FAIL (HTTP ${br.status})`);
  } else {
    const { rows: breaking, source } = parseBreakPage(br.html, breakUrl);
    console.log(`OK → ${breaking.length} breaking teams (source: ${source})`);
    if (breaking.length > 0) {
      console.log(`     Top 3: ${breaking.slice(0, 3).map(t => `#${t.rank} ${t.entityName}`).join(', ')}`);
    } else {
      console.log(`     ⚠ Zero — vueData present: ${!!extractVueData(br.html)}`);
    }
  }
}

// Step 6: Participants
process.stdout.write(`\n[6/6] Fetching participants... `);
const pRes = await fetchPage(nav.participants, PRIVATE_URL);
if (!pRes.ok) {
  console.log(`FAIL (HTTP ${pRes.status})`);
} else {
  const { rows: people, source } = parseParticipants(pRes.html);
  const speakers = people.filter(p => p.role === 'speaker');
  const judges = people.filter(p => p.role === 'adjudicator');
  console.log(`OK → ${people.length} people: ${speakers.length} speakers, ${judges.length} judges (source: ${source})`);
}

console.log(`\n${SEP}\n`);
