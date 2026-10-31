// Which teams on a Tabbycat break tab actually broke, and at what rank.
//
// A team break tab has two rank-like columns: "Rk", the team's standing in
// the tab (withdrawn teams and teams that broke in another category still
// have one), and "Break", the break rank — or a remark such as
// "(withdrawn)" where the team did not break. Break is authoritative when
// the tab has it; Rk is read only on tabs that show no Break column, as the
// parser always did. Diliman Schools AP 2023 stored two withdrawn teams as
// breakers, ranked by Rk, before this.

/**
 * Remarks Tabbycat prints where a ranked team is not in this break. They are
 * BreakingTeam.Remark in tabbycat/breakqual/models.py (TabbycatDebate/tabbycat):
 * Capped (C), Ineligible (I), Different break (D), Disqualified (d), Lost coin
 * toss (t), Withdrawn (w), plus Reserve (R) and Absent (A).
 */
const NOT_BREAKING =
  /withdr[ae]w|ineligible|not eligible|different break|capped|disqualified|lost coin toss|reserve|absent|did not break/i;

type Head = { key?: string; title?: string };

/** Column whose key or title is exactly one of the names (header-name match). */
function columnExact(heads: Head[], ...names: string[]): number {
  return heads.findIndex((h) =>
    [h.key, h.title].some((v) => v != null && names.includes(v.trim().toLowerCase())),
  );
}

export type BreakCols = { breakCol: number; remarkCol: number; rkCol: number };

/**
 * The Break, Remark and Rk columns of a team break tab. Rk is matched by
 * exact name first: a loose "rk" match also hits "Remark". Older tabs with
 * neither name get the first other column whose header holds "rank" or "#".
 */
export function breakColumns(heads: Head[]): BreakCols {
  const breakCol = columnExact(heads, 'break');
  const remarkCol = columnExact(heads, 'remark', 'remarks');
  const exactRk = columnExact(heads, 'rk', 'rank', '#');
  const rkCol =
    exactRk >= 0
      ? exactRk
      : heads.findIndex(
          (h, i) =>
            i !== breakCol &&
            i !== remarkCol &&
            [h.key, h.title].some((v) => v != null && /rank|#/.test(v.toLowerCase())),
        );
  return { breakCol, remarkCol, rkCol };
}

/**
 * A team row's break rank, or 'out' when the row is not a breaker: a remark
 * ("(withdrawn)", "(different break)"), or a blank/dash Break cell. `read`
 * turns one of the row's cells into text or a rank.
 */
export function teamBreakRank<C>(
  cols: BreakCols,
  row: C[],
  read: { text: (cell: C | undefined) => string; rank: (cell: C | undefined) => number | null },
): number | null | 'out' {
  const { text, rank } = read;
  const rk = cols.rkCol >= 0 ? rank(row[cols.rkCol]) : null;
  if (cols.remarkCol >= 0 && NOT_BREAKING.test(text(row[cols.remarkCol]))) return 'out';
  if (cols.breakCol < 0) return rk;
  const brk = text(row[cols.breakCol]);
  // Blank, a dash or a parenthesised remark means "did not break".
  if (brk === '' || /^[-–—]+$/.test(brk) || /^\(.*\)$/.test(brk)) return 'out';
  if (NOT_BREAKING.test(brk)) return 'out';
  // Anything else that is not a number keeps the standing rank.
  return rank(row[cols.breakCol]) ?? rk;
}
