/**
 * Erasure for people who are in the database but never signed up.
 *
 * The product scrapes public tournament tabs, which means it holds the
 * names, scores and team affiliations of thousands of debaters who have
 * never heard of it — and surfaces those names on other people's public
 * CVs as teammates. Account deletion covers users; this covers everyone
 * else, which on a European circuit is not optional.
 *
 * What erasure means here, and why it is masking rather than deletion:
 * a debate result is a public fact about a tournament, and deleting the
 * participation row would corrupt the event record, other users' teammate
 * lists, and the field statistics computed from the tab. What identifies a
 * person is the NAME. So a suppressed Person keeps its row and its results
 * but renders as a placeholder everywhere, cannot be claimed, and is never
 * refreshed by a later re-ingest.
 */

/** What a suppressed person is shown as, wherever a name would appear. */
export const SUPPRESSED_DISPLAY_NAME = '[name withdrawn]';

type PersonNameFields = {
  displayName: string;
  suppressedAt?: Date | null;
};

/**
 * The name to render for a person. Every display site should go through
 * this rather than reading `displayName` directly, so a suppression cannot
 * be defeated by one surface that forgot.
 */
export function displayNameFor(person: PersonNameFields): string {
  return person.suppressedAt ? SUPPRESSED_DISPLAY_NAME : person.displayName;
}

/** Mask a list of names, dropping any that resolve to the placeholder. */
export function visibleNames(people: PersonNameFields[]): string[] {
  return people.map(displayNameFor);
}
