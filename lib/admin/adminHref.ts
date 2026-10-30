/**
 * An /admin address with some parameters changed and every other one kept.
 * The overview pages two ledgers on one URL (?reportsPage, ?reportsStatus,
 * ?warningsPage, Task 5d), so moving one must not reset the other: Next on
 * the parser warnings keeps the CV reports where they were. `null` removes
 * a parameter (page 1 is the address without one). The hash lands the
 * reader back on the section they paged, not at the top of the page.
 *
 * A value with a private-URL path in it is not carried over: whatever is in
 * the request would otherwise be written into every pager link's href.
 */
export type SearchValues = Record<string, string | string[] | undefined>;

export function adminHref(
  current: SearchValues,
  changes: Record<string, string | null>,
  hash?: string,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) {
      if (!/privateurls/i.test(one)) sp.append(k, one);
    }
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v == null) sp.delete(k);
    else sp.set(k, v);
  }
  const q = sp.toString();
  return `/admin${q ? `?${q}` : ''}${hash ? `#${hash}` : ''}`;
}
