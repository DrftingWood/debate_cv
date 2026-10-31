/**
 * Whether a tournament's name looks like a test or demo one, so the detail
 * page can offer to ignore it. A suggestion only: nothing ever ignores a
 * tournament by itself, because a real tournament can be called "Demo Day
 * Debate" and the admin knows which is which.
 *
 * The words match whole (a letter on either side rules them out), so
 * "Contest" and "Latest" do not read as "test"; "minimal8team" is the shape
 * the owner's own fixtures take, with or without spaces and the number.
 */
const TEST_NAME = /(?:^|[^a-z])(?:test|demo|sandbox)(?:[^a-z]|$)|minimal\s*\d*\s*teams?/i;

export function looksLikeTestTournament(name: string): boolean {
  const trimmed = name.trim();
  return trimmed === '' || TEST_NAME.test(trimmed);
}
