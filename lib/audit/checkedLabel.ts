const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "31 Oct 2026", in UTC. Spelled out rather than through Intl, whose short
 * month names differ between ICU versions ("Sep" against "Sept"), and this
 * sentence is stored.
 */
export function shortDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The part of an admin's email before the @: a name, without the address. */
export const nameOf = (email: string) => email.split('@')[0] || email;

/**
 * "Checked by owner on 31 Oct 2026": who vouched for a check and when. One
 * wording for the sentence the audit stores in a check's detail and for the
 * line the tournament's page shows beside Undo. Only the name leaves the
 * server, never the admin's address.
 */
export const checkedWords = (by: string, at: Date) =>
  `Checked by ${nameOf(by)} on ${shortDate(at)}`;
