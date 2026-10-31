/**
 * Reads a tournament's year out of its name, for the tournaments stored with
 * no year at all ("Fill years from names"). Tabbycat names usually carry it
 * ("Preworlds24", "Vienna IV 24", "WUDC 2023"), and a tab's own text is a
 * better source than a guess. A wrong year is worse than none (the owner's
 * rule on every fill), so the function answers only when exactly one year is
 * plainly meant and returns null for anything it would have to guess at.
 *
 * Accepted: a stand-alone four-digit number from 2000 to next year, or a
 * two-digit number from 15 to next year's last two digits (the earliest
 * tournament the app holds is 2015). Next year is allowed because a tab is
 * often named for the season it opens.
 *
 * Refused, so the answer is null:
 *   - a count rather than a year: "Round 16", "Top 24", "U19", "Under 18",
 *     "16 teams", "24th" (the number sits after round/top/rd/r/under/u, or
 *     before teams/rounds/speakers/judges/st/nd/rd/th);
 *   - a number inside a longer figure, a decimal or a time ("2024001",
 *     "1.24", "10:24");
 *   - a season that spans years ("IV 2019-20", "2019/2020", "2019-2020"):
 *     which of the two is the tournament's year is the owner's to say, and a
 *     tab whose name names two years has not named one;
 *   - two different years in one name ("Open 2023 vs 2024").
 * The same year written twice ("WUDC 2023 (23)") is still that year.
 */

/** The earliest two-digit year read as 20yy. */
const FIRST_SHORT_YEAR = 15;
const FIRST_FULL_YEAR = 2000;

/** Words that make the number after them a count ("Round 16", "Top 32", "U19"). */
const COUNT_BEFORE =
  /(?:^|[^a-z])(?:round|rounds|rd|r|top|under|u|ro|group|pool|room|day|pt|part)\s*#?$/i;
/** Words that make the number before them a count ("16 teams", "24th"). */
const COUNT_AFTER =
  /^\s*(?:teams?|rounds?|speakers?|judges?|adjs?|rooms?|st\b|nd\b|rd\b|th\b|%|min)/i;

type Hit = { value: number; start: number; end: number };

/** Every stand-alone run of exactly two or four digits, with where it sits. */
function digitRuns(name: string): Hit[] {
  const out: Hit[] = [];
  for (const m of name.matchAll(/\d+/g)) {
    if (m[0].length !== 2 && m[0].length !== 4) continue;
    const start = m.index;
    out.push({ value: Number(m[0]), start, end: start + m[0].length });
  }
  return out;
}

/** A decimal point or a clock colon touching the number makes it part of another figure. */
function insideOtherFigure(name: string, hit: Hit): boolean {
  const before = name[hit.start - 1] ?? '';
  const after = name[hit.end] ?? '';
  const afterNext = name[hit.end + 1] ?? '';
  const beforePrev = name[hit.start - 2] ?? '';
  if ((before === '.' && /\d/.test(beforePrev)) || (after === '.' && /\d/.test(afterNext))) {
    return true;
  }
  return before === ':' || after === ':';
}

/** The year a run stands for, or null when it is out of range or reads as a count. */
function yearOf(name: string, hit: Hit, maxYear: number): number | null {
  const four = hit.end - hit.start === 4;
  const year = four ? hit.value : 2000 + hit.value;
  const low = four ? FIRST_FULL_YEAR : 2000 + FIRST_SHORT_YEAR;
  if (year < low || year > maxYear) return null;
  if (insideOtherFigure(name, hit)) return null;
  if (COUNT_BEFORE.test(name.slice(0, hit.start))) return null;
  if (COUNT_AFTER.test(name.slice(hit.end))) return null;
  return year;
}

/** "2019-20", "2019/2020", "2019 - 2020": a run joined to a year-sized number by a dash or slash. */
function inSeasonRange(name: string, hit: Hit): boolean {
  const before = name.slice(0, hit.start);
  const after = name.slice(hit.end);
  return /\d{2,4}\s*[-/–]\s*$/.test(before) || /^\s*[-/–]\s*\d{2,4}/.test(after);
}

/**
 * The one year the name states, or null when there is none or it is not
 * certain. `now` is injectable so the table of cases does not rot.
 */
export function yearFromName(name: string, now: Date = new Date()): number | null {
  const maxYear = now.getFullYear() + 1;
  const years = new Set<number>();
  for (const hit of digitRuns(name)) {
    const year = yearOf(name, hit, maxYear);
    if (year == null) continue;
    if (inSeasonRange(name, hit)) return null;
    years.add(year);
  }
  return years.size === 1 ? [...years][0] : null;
}
