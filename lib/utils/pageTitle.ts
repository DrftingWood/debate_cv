/**
 * Page titles follow the nav (UX-76): the label a visitor clicked is the
 * first thing the tab says. Top-level destinations use the nav label alone
 * ("Record", "Imports"); pages under a section put the most specific part
 * first ("Profile · Settings"). The root layout's title template appends the
 * site name, so it is not repeated here.
 */
export function pageTitle(page: string, section?: string): string {
  return section && section !== page ? `${page} · ${section}` : page;
}
