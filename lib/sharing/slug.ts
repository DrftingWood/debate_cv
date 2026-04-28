import { randomBytes } from 'node:crypto';

/**
 * Slugs that would collide with existing top-level routes or reserved
 * paths. Custom slugs cannot match any of these (case-insensitive).
 */
export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'cv',
  'dashboard',
  'login',
  'logout',
  'onboarding',
  'privacy',
  'public',
  'settings',
  'signup',
  'support',
  'terms',
  'u',
]);

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/;

export type CustomSlugError =
  | { code: 'too_short' }
  | { code: 'too_long' }
  | { code: 'invalid_chars' }
  | { code: 'reserved' };

/**
 * Validate a user-supplied custom slug. Returns null on success, or an
 * error code the API surfaces to the user. Lowercase, 3–30 chars, [a-z0-9-],
 * no leading/trailing/double hyphens, not in RESERVED_SLUGS.
 */
export function validateCustomSlug(raw: string): CustomSlugError | null {
  const slug = raw.trim().toLowerCase();
  if (slug.length < 3) return { code: 'too_short' };
  if (slug.length > 30) return { code: 'too_long' };
  if (!SLUG_PATTERN.test(slug) || /--/.test(slug)) return { code: 'invalid_chars' };
  if (RESERVED_SLUGS.has(slug)) return { code: 'reserved' };
  return null;
}

const ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789'; // skip easily-confused 0/o/1/l
const RANDOM_LEN = 6;

/**
 * Generate a random base-32-ish slug. Uses an alphabet that drops visually
 * ambiguous chars (0, o, 1, l) so a debater verbally sharing a URL
 * doesn't have to disambiguate. ~5 billion combinations at length 6.
 */
export function generateRandomSlug(): string {
  const bytes = randomBytes(RANDOM_LEN);
  let out = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}
