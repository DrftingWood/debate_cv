/**
 * Which tab a URL selects (UX-60): the `?param=` value when it names one of
 * the tabs, else the default. Lives outside the Tabs component (a client
 * module) so a Server Component page can resolve it from `searchParams` and
 * render the right panel first, with no flash of the default tab.
 */
export function resolveTab<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  const v = Array.isArray(value) ? value[0] : value;
  return (allowed as readonly string[]).includes(v ?? '') ? (v as T) : fallback;
}

/**
 * The URL after selecting `value` for `param`, keeping every other query
 * parameter. The default tab removes the parameter, so the plain page URL
 * stays the canonical one.
 */
export function urlWithTab(
  location: { pathname: string; search: string; hash?: string },
  tab: { param: string; value: string; fallback: string },
): string {
  const { pathname, search, hash = '' } = location;
  const { param, value, fallback } = tab;
  const params = new URLSearchParams(search);
  if (value === fallback) params.delete(param);
  else params.set(param, value);
  const qs = params.toString();
  // The hash survives: a chart link (#j2025) switches tab on its way to
  // the year, and dropping it lost the link's target.
  return `${qs ? `${pathname}?${qs}` : pathname}${hash}`;
}
